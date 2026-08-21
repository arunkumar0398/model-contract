import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectWithRetry } from "../../apps/web/lib/collection";
import { createFakeDb } from "../helpers/fake-prisma";
import type { FakeDb } from "../helpers/fake-prisma";
import { BrightDataError } from "../../packages/brightdata/src/errors";

// --- Mock Bright Data runCollectorAndWait (keep real exports for errors) ---
vi.mock("@modelcontract/brightdata", async () => {
  const actual = await vi.importActual<typeof import("@modelcontract/brightdata")>(
    "@modelcontract/brightdata",
  );
  return {
    ...actual,
    runCollectorAndWait: vi.fn(),
  };
});

import { runCollectorAndWait } from "@modelcontract/brightdata";
const mockRun = vi.mocked(runCollectorAndWait);

/** Fresh valid row each call — never shared across tests or mock calls. */
function validRow(): Record<string, unknown> {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
    sourceUrl: "https://model-contract.vercel.app/provider-demo/model-x",
    collectorId: "c_test",
    collectorVersion: "1.0",
  };
}

/** Fresh broken row each call. */
function brokenRow(): Record<string, unknown> {
  return { sourceUrl: "https://model-contract.vercel.app/provider-demo/model-x" };
}

function runResult(rows: Record<string, unknown>[]) {
  return {
    runId: `j_test_${Math.random().toString(36).slice(2, 8)}`,
    rows,
  };
}

describe("collectWithRetry", () => {
  let db: FakeDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createFakeDb();
  });

  it("A — first run valid: ingest once, no retry", async () => {
    mockRun.mockImplementation(async () => runResult([validRow()]));

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(result.driftType).not.toBe("EXTRACTION_DRIFT");
    expect(result.retryExhausted).toBe(false);
    expect(result.retryCount).toBe(0);
  });

  it("B — first invalid, retry valid: no quarantine, no RETRY_EXHAUSTED", async () => {
    let callCount = 0;
    mockRun.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return runResult([brokenRow()]);
      return runResult([validRow()]);
    });

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(result.driftType).not.toBe("EXTRACTION_DRIFT");
    expect(result.retryExhausted).toBe(false);
    expect(result.retryCount).toBe(1);
    expect(result.recovered).toBe(true);
  });

  it("C — first invalid, retry invalid: EXTRACTION_DRIFT + RETRY_EXHAUSTED", async () => {
    mockRun.mockImplementation(async () => runResult([brokenRow()]));

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.retryExhausted).toBe(true);
    expect(result.retryCount).toBe(1);
  });

  it("D — collection failure: recordCollectionFailure, no fake RawObservation", async () => {
    mockRun.mockRejectedValueOnce(new BrightDataError("TIMEOUT", "collection timed out"));

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.retryExhausted).toBe(false);
    // No observation should be created for collection failures
    expect(db.__observations).toHaveLength(0);
  });

  it("E — exactly one retry: no third attempt", async () => {
    mockRun.mockImplementation(async () => runResult([brokenRow()]));

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(result.retryCount).toBe(1);
  });

  it("D2 — collection failure on retry: TRANSIENT_FAILURE", async () => {
    mockRun
      .mockResolvedValueOnce(runResult([brokenRow()]))
      .mockRejectedValueOnce(new BrightDataError("TIMEOUT", "retry timed out"));

    const result = await collectWithRetry({
      db,
      collectorId: "c_test",
      inputs: [{ url: "https://example.com" }],
      provider: "demo-ai",
      modelId: "model-x",
    });

    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.retryCount).toBe(1);
  });
});
