/**
 * Types for the Bright Data Scraper Studio batch-collection flow:
 *
 *   POST /dca/trigger?collector=<c_...>&queue_next=1   (JSON array body)
 *   GET  /dca/dataset?id=<j_...>
 *
 * `collection_id` (j_...) is the run/snapshot ID for a collection.
 */

/** Input objects must match the collector's input schema (e.g. { url }). */
export type TriggerCollectorInput = {
  collectorId: string;
  inputs: Array<Record<string, unknown>>;
};

export type TriggerCollectorResult = {
  /** collection_id (j_...) — the run/snapshot identifier. */
  runId: string;
  startEta?: string;
};

export type DatasetState =
  | { status: "ready"; rows: Array<Record<string, unknown>> }
  | { status: "running" }
  | { status: "failed"; reason: string };

export type CollectorRunResult = {
  runId: string;
  rows: Array<Record<string, unknown>>;
};

export type PollOptions = {
  /** Maximum number of dataset polls before TIMEOUT. Default 12. */
  maxAttempts?: number;
  /** Delay between dataset polls. Default 5000ms. */
  pollIntervalMs?: number;
  /** Additional attempts for transient (5xx/network) trigger errors. Default 2. */
  maxTransientRetries?: number;
  /** Base backoff delay for transient retries. Default 500ms. */
  transientBaseDelayMs?: number;
};

export type ScraperStudioOptions = {
  /** API token. Defaults to BRIGHT_DATA_API_TOKEN. */
  token?: string;
  /** API base URL (default https://api.brightdata.com). Injectable for tests. */
  baseUrl?: string;
  /** fetch implementation (injectable for tests). */
  fetchImpl?: typeof fetch;
  /** Additional attempts for transient (5xx/network) trigger errors. Default 2. */
  maxTransientRetries?: number;
  /** Base backoff delay for transient retries. Default 500ms. */
  transientBaseDelayMs?: number;
};
