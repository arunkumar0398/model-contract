import { describe, expect, it, vi } from "vitest";
import { getDataset, runCollectorAndWait, triggerCollector } from "@modelcontract/brightdata";

/** Build a minimal fetch mock: passes the callback's Response through. */
function fetchMock(respond: (url: string, init?: RequestInit) => Promise<Response | unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const result = await respond(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTS = { token: "test-token" };

describe("triggerCollector", () => {
  it("POSTs the collector id and input array, returns collection_id as runId", async () => {
    const { fn, calls } = fetchMock(async () => ({ collection_id: "j_abc123", start_eta: "2026-08-17T00:00:00Z" }));
    const result = await triggerCollector(
      { collectorId: "c_demo", inputs: [{ url: "https://example.test/x" }] },
      { ...OPTS, fetchImpl: fn },
    );
    expect(result.runId).toBe("j_abc123");
    expect(result.startEta).toBeTruthy();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/dca/trigger");
    expect(url.searchParams.get("collector")).toBe("c_demo");
    expect(url.searchParams.get("queue_next")).toBe("1");
    expect(calls[0]!.init!.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual([{ url: "https://example.test/x" }]);
  });

  it("maps 401 to AUTH_ERROR without retrying", async () => {
    const { fn, calls } = fetchMock(async () => jsonResponse(401, { message: "unauthorized" }));
    await expect(
      triggerCollector({ collectorId: "c_x", inputs: [{}] }, { ...OPTS, fetchImpl: fn }),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
    expect(calls).toHaveLength(1);
  });

  it("maps 404 to COLLECTOR_NOT_FOUND", async () => {
    const { fn } = fetchMock(async () => jsonResponse(404, {}));
    await expect(
      triggerCollector({ collectorId: "c_missing", inputs: [{}] }, { ...OPTS, fetchImpl: fn }),
    ).rejects.toMatchObject({ code: "COLLECTOR_NOT_FOUND" });
  });

  it("maps 422 to INPUT_SCHEMA_ERROR", async () => {
    const { fn } = fetchMock(async () => jsonResponse(422, {}));
    await expect(
      triggerCollector({ collectorId: "c_x", inputs: [{ url: 42 }] }, { ...OPTS, fetchImpl: fn }),
    ).rejects.toMatchObject({ code: "INPUT_SCHEMA_ERROR" });
  });

  it("retries transient 5xx errors with backoff, then succeeds", async () => {
    let n = 0;
    const { fn, calls } = fetchMock(async () => {
      n += 1;
      return n < 3 ? jsonResponse(500, {}) : { collection_id: "j_retry" };
    });
    const result = await triggerCollector(
      { collectorId: "c_x", inputs: [{}] },
      { ...OPTS, fetchImpl: fn, maxTransientRetries: 2, transientBaseDelayMs: 1 },
    );
    expect(result.runId).toBe("j_retry");
    expect(calls).toHaveLength(3);
  });

  it("raises TRANSIENT_API_ERROR after transient retries are exhausted", async () => {
    const { fn } = fetchMock(async () => jsonResponse(503, {}));
    await expect(
      triggerCollector(
        { collectorId: "c_x", inputs: [{}] },
        { ...OPTS, fetchImpl: fn, maxTransientRetries: 1, transientBaseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "TRANSIENT_API_ERROR" });
  });

  it("treats network-level fetch failures as transient and retries", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 2) throw new TypeError("fetch failed: ECONNRESET");
      return jsonResponse(200, { collection_id: "j_net" });
    });
    const result = await triggerCollector(
      { collectorId: "c_x", inputs: [{}] },
      { ...OPTS, fetchImpl: fn, maxTransientRetries: 1, transientBaseDelayMs: 1 },
    );
    expect(result.runId).toBe("j_net");
  });

  it("throws AUTH_ERROR when no token is configured", async () => {
    await expect(
      triggerCollector({ collectorId: "c_x", inputs: [{}] }, { fetchImpl: fetchMock(async () => ({})).fn }),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });
});

describe("getDataset", () => {
  it("returns ready rows for a JSON array response", async () => {
    const { fn } = fetchMock(async () => [{ model: "model-x", inputPrice: "$4" }]);
    const state = await getDataset("j_1", { ...OPTS, fetchImpl: fn });
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.rows).toHaveLength(1);
  });

  it("treats a 404 as still running while the collection is in progress", async () => {
    const { fn } = fetchMock(async () => jsonResponse(404, {}));
    const state = await getDataset("j_1", { ...OPTS, fetchImpl: fn });
    expect(state.status).toBe("running");
  });

  it("surfaces an explicit failed status", async () => {
    const { fn } = fetchMock(async () => ({ status: "failed", reason: "page blocked" }));
    const state = await getDataset("j_1", { ...OPTS, fetchImpl: fn });
    expect(state.status).toBe("failed");
  });

  it("raises UNKNOWN_ERROR for a 200 response that is not JSON", async () => {
    const fn = vi.fn(async () => new Response("<html>gateway error</html>", { status: 200 }));
    await expect(getDataset("j_1", { ...OPTS, fetchImpl: fn })).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
    });
  });
});

describe("runCollectorAndWait", () => {
  it("triggers, polls until ready, and returns the rows", async () => {
    let polls = 0;
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dca/trigger")) return jsonResponse(200, { collection_id: "j_poll" });
      polls += 1;
      return polls < 2 ? jsonResponse(200, []) : jsonResponse(200, [{ model: "model-x" }]);
    });
    const result = await runCollectorAndWait(
      { collectorId: "c_x", inputs: [{}] },
      { maxAttempts: 5, pollIntervalMs: 1 },
      { ...OPTS, fetchImpl: fn },
    );
    expect(result.runId).toBe("j_poll");
    expect(result.rows).toEqual([{ model: "model-x" }]);
    expect(polls).toBe(2);
  });

  it("raises TIMEOUT when the collection never completes", async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dca/trigger")) return jsonResponse(200, { collection_id: "j_slow" });
      return jsonResponse(200, { status: "running" });
    });
    await expect(
      runCollectorAndWait(
        { collectorId: "c_x", inputs: [{}] },
        { maxAttempts: 3, pollIntervalMs: 1 },
        { ...OPTS, fetchImpl: fn },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("raises EMPTY_DATASET when the collection completes with no rows", async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dca/trigger")) return jsonResponse(200, { collection_id: "j_empty" });
      return jsonResponse(200, []);
    });
    await expect(
      runCollectorAndWait(
        { collectorId: "c_x", inputs: [{}] },
        { maxAttempts: 3, pollIntervalMs: 1 },
        { ...OPTS, fetchImpl: fn },
      ),
    ).rejects.toMatchObject({ code: "EMPTY_DATASET" });
  });

  it("retries a transient 5xx during polling, then succeeds", async () => {
    let polls = 0;
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dca/trigger")) return jsonResponse(200, { collection_id: "j_5xx" });
      polls += 1;
      if (polls === 1) return jsonResponse(500, {});
      return jsonResponse(200, [{ model: "model-x" }]);
    });
    const result = await runCollectorAndWait(
      { collectorId: "c_x", inputs: [{}] },
      { maxAttempts: 3, pollIntervalMs: 1, maxTransientRetries: 1, transientBaseDelayMs: 1 },
      { ...OPTS, fetchImpl: fn },
    );
    expect(result.rows).toEqual([{ model: "model-x" }]);
    expect(polls).toBe(2);
  });
});
