import { BrightDataError, brightDataErrorFromStatus, isRetryableError } from "./errors";
import type { DatasetState, ScraperStudioOptions, TriggerCollectorInput, TriggerCollectorResult } from "./types";

export const SCRAPER_STUDIO_BASE_URL = "https://api.brightdata.com";

export function resolveToken(opts: ScraperStudioOptions): string {
  const token = opts.token ?? process.env.BRIGHT_DATA_API_TOKEN;
  if (!token || token === "") {
    throw new BrightDataError("AUTH_ERROR", "BRIGHT_DATA_API_TOKEN is not configured");
  }
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * POST /dca/trigger?collector=<id>&queue_next=1 with a JSON-array body.
 * Retries transient (5xx / network) errors with exponential backoff.
 * Authentication and schema errors are never retried.
 */
export async function triggerCollector(
  input: TriggerCollectorInput,
  opts: ScraperStudioOptions = {},
): Promise<TriggerCollectorResult> {
  const token = resolveToken(opts);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? SCRAPER_STUDIO_BASE_URL;
  const maxRetries = opts.maxTransientRetries ?? 2;
  const baseDelay = opts.transientBaseDelayMs ?? 500;

  const url = new URL(`${baseUrl}/dca/trigger`);
  url.searchParams.set("collector", input.collectorId);
  url.searchParams.set("queue_next", "1");

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseDelay * 2 ** (attempt - 1));
    try {
      const res = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.inputs),
      });
      if (!res.ok) {
        const err = brightDataErrorFromStatus(res.status, await responseDetail(res));
        if (isRetryableError(err) && attempt < maxRetries) {
          lastError = err;
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as { collection_id?: string; start_eta?: string };
      if (!data.collection_id) {
        throw new BrightDataError("UNKNOWN_ERROR", "trigger response did not include collection_id");
      }
      return { runId: data.collection_id, startEta: data.start_eta };
    } catch (err) {
      if (err instanceof BrightDataError) {
        if (isRetryableError(err) && attempt < maxRetries) {
          lastError = err;
          continue;
        }
        throw err;
      }
      const networkError = new BrightDataError(
        "TRANSIENT_API_ERROR",
        `Bright Data request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt < maxRetries) {
        lastError = networkError;
        continue;
      }
      throw networkError;
    }
  }
  throw lastError instanceof BrightDataError
    ? lastError
    : new BrightDataError("TRANSIENT_API_ERROR", "trigger failed after retries");
}

/**
 * GET /dca/dataset?id=<j_...>. Returns the collected rows when ready.
 * A 404/409 while the collection is still in progress is treated as
 * "running" so callers can keep polling.
 */
export async function getDataset(runId: string, opts: ScraperStudioOptions = {}): Promise<DatasetState> {
  const token = resolveToken(opts);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? SCRAPER_STUDIO_BASE_URL;

  const url = new URL(`${baseUrl}/dca/dataset`);
  url.searchParams.set("id", runId);

  const res = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404 || res.status === 409) {
      return { status: "running" };
    }
    throw brightDataErrorFromStatus(res.status, await responseDetail(res));
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new BrightDataError(
      "UNKNOWN_ERROR",
      `dataset response for ${runId} was not valid JSON: ${await responseDetail(res)}`,
    );
  }

  if (Array.isArray(data)) {
    return { status: "ready", rows: data as Array<Record<string, unknown>> };
  }

  if (data !== null && typeof data === "object") {
    const obj = data as { status?: unknown; reason?: unknown; rows?: unknown };
    if (obj.status === "failed" || obj.status === "error") {
      return { status: "failed", reason: typeof obj.reason === "string" ? obj.reason : `collection failed (${String(obj.status)})` };
    }
    if (obj.status === "ready" && Array.isArray(obj.rows)) {
      return { status: "ready", rows: obj.rows as Array<Record<string, unknown>> };
    }
  }

  // Any other shape (running/queued/processing, or unknown) — keep polling.
  return { status: "running" };
}
