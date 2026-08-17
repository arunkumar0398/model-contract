import { getDataset, triggerCollector } from "./client";
import { BrightDataError, isRetryableError } from "./errors";
import type { CollectorRunResult, DatasetState, PollOptions, ScraperStudioOptions, TriggerCollectorInput } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll once, retrying bounded transient (5xx/network) errors with backoff. */
async function pollDatasetWithRetry(
  runId: string,
  clientOpts: ScraperStudioOptions,
): Promise<DatasetState> {
  const maxRetries = clientOpts.maxTransientRetries ?? 2;
  const baseDelay = clientOpts.transientBaseDelayMs ?? 500;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseDelay * 2 ** (attempt - 1));
    try {
      return await getDataset(runId, clientOpts);
    } catch (err) {
      if (isRetryableError(err) && attempt < maxRetries) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Trigger a collector and poll its dataset until rows are available.
 *
 * - TIMEOUT when the collection never completes within maxAttempts polls.
 * - EMPTY_DATASET when the collection completes with no rows.
 * - UNKNOWN_ERROR when Bright Data reports an explicit collection failure.
 */
export async function runCollectorAndWait(
  input: TriggerCollectorInput,
  options: PollOptions = {},
  clientOpts: ScraperStudioOptions = {},
): Promise<CollectorRunResult> {
  const maxAttempts = options.maxAttempts ?? 12;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;

  const { runId } = await triggerCollector(input, clientOpts);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(pollIntervalMs);
    const state = await pollDatasetWithRetry(runId, clientOpts);
    if (state.status === "failed") {
      throw new BrightDataError("UNKNOWN_ERROR", `collection ${runId} failed: ${state.reason}`);
    }
    if (state.status === "ready") {
      if (state.rows.length > 0) return { runId, rows: state.rows };
      if (attempt === maxAttempts - 1) {
        throw new BrightDataError("EMPTY_DATASET", `collection ${runId} completed with no rows`);
      }
    }
  }

  throw new BrightDataError(
    "TIMEOUT",
    `collection ${runId} did not complete within ${maxAttempts} dataset polls`,
  );
}
