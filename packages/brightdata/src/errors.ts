/**
 * Explicit error model for Bright Data interactions. External failures are
 * represented distinctly so downstream stages never mistake an API problem
 * for extraction or semantic drift.
 */
export const BRIGHT_DATA_ERROR_CODES = [
  "AUTH_ERROR",
  "COLLECTOR_NOT_FOUND",
  "INPUT_SCHEMA_ERROR",
  "TRANSIENT_API_ERROR",
  "TIMEOUT",
  "EMPTY_DATASET",
  "UNKNOWN_ERROR",
] as const;

export type BrightDataErrorCode = (typeof BRIGHT_DATA_ERROR_CODES)[number];

export class BrightDataError extends Error {
  readonly code: BrightDataErrorCode;
  readonly status?: number;

  constructor(code: BrightDataErrorCode, message: string, status?: number) {
    super(message);
    this.name = "BrightDataError";
    this.code = code;
    this.status = status;
  }
}

/** Map documented HTTP statuses to explicit error codes. */
export function brightDataErrorFromStatus(status: number, detail?: string): BrightDataError {
  const suffix = detail ? `: ${detail}` : "";
  switch (status) {
    case 401:
    case 403:
      return new BrightDataError("AUTH_ERROR", `Bright Data authentication failed (HTTP ${status})${suffix}`, status);
    case 404:
      return new BrightDataError("COLLECTOR_NOT_FOUND", `Collector not found (HTTP 404)${suffix}`, status);
    case 422:
      return new BrightDataError("INPUT_SCHEMA_ERROR", `Input does not match collector schema (HTTP 422)${suffix}`, status);
    default:
      if (status >= 500) {
        return new BrightDataError("TRANSIENT_API_ERROR", `Bright Data API error (HTTP ${status})${suffix}`, status);
      }
      return new BrightDataError("UNKNOWN_ERROR", `Unexpected Bright Data response (HTTP ${status})${suffix}`, status);
  }
}

export function isRetryableError(err: unknown): err is BrightDataError {
  return err instanceof BrightDataError && err.code === "TRANSIENT_API_ERROR";
}
