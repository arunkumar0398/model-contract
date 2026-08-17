import type { ModelStatus } from "./contract";

/**
 * Result of a normalization attempt. `ok: false` means the value could NOT
 * be safely normalized — callers must never guess, fabricate, or default.
 */
export type NormalizeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function ok<T>(value: T): NormalizeResult<T> {
  return { ok: true, value };
}

function fail(reason: string): NormalizeResult<never> {
  return { ok: false, reason };
}

const K_FORM = /^(\d+(?:\.\d+)?)\s*k$/i;
const PLAIN_CONTEXT = /^(\d+(?:\.\d+)?)(?:\s*tokens?)?$/i;

/** "128k" → 128000, "128,000 tokens" → 128000. Rejects anything ambiguous. */
export function normalizeContextWindow(input: unknown): NormalizeResult<number> {
  if (typeof input !== "string") return fail("context window must be a string");
  const trimmed = input.trim();
  if (trimmed === "") return fail("context window is empty");

  const kMatch = K_FORM.exec(trimmed);
  if (kMatch) {
    // Round to avoid cross-engine float artifacts (e.g. 12.8 * 1000);
    // context windows are integers by definition.
    const value = Math.round(Number.parseFloat(kMatch[1]!) * 1000);
    if (!Number.isFinite(value) || value <= 0) {
      return fail(`cannot safely normalize context window from ${JSON.stringify(input)}`);
    }
    return ok(value);
  }

  const plain = PLAIN_CONTEXT.exec(trimmed.replace(/,/g, ""));
  if (plain) {
    const value = Number.parseFloat(plain[1]!);
    if (!Number.isInteger(value) || value <= 0) {
      return fail(`cannot safely normalize context window from ${JSON.stringify(input)}`);
    }
    return ok(value);
  }

  return fail(`cannot safely normalize context window from ${JSON.stringify(input)}`);
}

const PLAIN_PRICE = /^\$?\s*(\d+(?:\.\d+)?)\s*$/;
const PER_M_TOKENS =
  /^\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*|\s*per\s+|\s+)?1\s?m(?:illion)?\s*tokens?\s*$/i;

/**
 * "$4" → 4, "$4.00" → 4, "$4 / 1M tokens" → 4.
 * "Contact sales" and any other unparseable text return `ok: false` —
 * never 0, NaN, or a fabricated number.
 */
export function normalizePrice(input: unknown): NormalizeResult<number> {
  if (typeof input !== "string") return fail("price must be a string");
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "") return fail("price is empty");

  const plain = PLAIN_PRICE.exec(trimmed);
  if (plain) {
    return ok(Number.parseFloat(plain[1]!));
  }

  const perM = PER_M_TOKENS.exec(trimmed);
  if (perM) {
    return ok(Number.parseFloat(perM[1]!));
  }

  return fail(`cannot safely normalize price from ${JSON.stringify(input)}`);
}

/** "Active" → "active", "DEPRECATED" → "deprecated". Unknown text → fail. */
export function normalizeStatus(input: unknown): NormalizeResult<ModelStatus> {
  if (typeof input !== "string") return fail("status must be a string");
  const value = input.trim().toLowerCase();
  if (value === "active" || value === "deprecated" || value === "unknown") {
    return ok(value);
  }
  return fail(`cannot safely normalize status from ${JSON.stringify(input)}`);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAME_DATE = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** "March 1, 2027" → "2027-03-01". ISO dates pass through when valid. */
export function normalizeDate(input: unknown): NormalizeResult<string> {
  if (typeof input !== "string") return fail("date must be a string");
  const trimmed = input.trim();
  if (trimmed === "") return fail("date is empty");

  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (isValidDate(year, month, day)) return ok(trimmed);
    return fail(`invalid date ${JSON.stringify(input)}`);
  }

  const named = MONTH_NAME_DATE.exec(trimmed);
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (!month) return fail(`cannot safely normalize date from ${JSON.stringify(input)}`);
    const day = Number(named[2]);
    const year = Number(named[3]);
    if (!isValidDate(year, month, day)) {
      return fail(`invalid date ${JSON.stringify(input)}`);
    }
    const monthPadded = String(month).padStart(2, "0");
    const dayPadded = String(day).padStart(2, "0");
    return ok(`${year}-${monthPadded}-${dayPadded}`);
  }

  return fail(`cannot safely normalize date from ${JSON.stringify(input)}`);
}
