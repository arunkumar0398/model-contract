import { describe, expect, it } from "vitest";
import {
  normalizeContextWindow,
  normalizeDate,
  normalizePrice,
  normalizeStatus,
} from "@modelcontract/core";

describe("normalizeContextWindow", () => {
  it('normalizes "128k" to 128000', () => {
    expect(normalizeContextWindow("128k")).toEqual({ ok: true, value: 128000 });
  });

  it('normalizes "128,000 tokens" to 128000', () => {
    expect(normalizeContextWindow("128,000 tokens")).toEqual({
      ok: true,
      value: 128000,
    });
  });

  it("is case-insensitive for the k suffix", () => {
    expect(normalizeContextWindow("128K")).toEqual({ ok: true, value: 128000 });
  });

  it("handles decimal k values exactly", () => {
    expect(normalizeContextWindow("1.5k")).toEqual({ ok: true, value: 1500 });
    expect(normalizeContextWindow("12.8k")).toEqual({ ok: true, value: 12800 });
  });

  it("handles '1M tokens' format (Anthropic) to 1000000", () => {
    expect(normalizeContextWindow("1M tokens")).toEqual({ ok: true, value: 1000000 });
  });

  it("handles '1M' format to 1000000", () => {
    expect(normalizeContextWindow("1M")).toEqual({ ok: true, value: 1000000 });
  });

  it("handles '200k tokens' format (Anthropic) to 200000", () => {
    expect(normalizeContextWindow("200k tokens")).toEqual({ ok: true, value: 200000 });
  });

  it("rejects values it cannot safely normalize", () => {
    for (const bad of ["", "unknown", "~128k", "128k-256k", "128 MB", "-128k", "0", "0k"]) {
      expect(normalizeContextWindow(bad).ok, `expected ${JSON.stringify(bad)} to fail`).toBe(false);
    }
  });
});

describe("normalizePrice", () => {
  it('normalizes "$4" to 4', () => {
    expect(normalizePrice("$4")).toEqual({ ok: true, value: 4 });
  });

  it('normalizes "$4.00" to 4', () => {
    expect(normalizePrice("$4.00")).toEqual({ ok: true, value: 4 });
  });

  it('normalizes "$4 / 1M tokens" to 4', () => {
    expect(normalizePrice("$4 / 1M tokens")).toEqual({ ok: true, value: 4 });
  });

  it('normalizes "$12 / 1M tokens" to 12', () => {
    expect(normalizePrice("$12 / 1M tokens")).toEqual({ ok: true, value: 12 });
  });

  it('normalizes "$10 / input MTok" to 10 (Anthropic format)', () => {
    expect(normalizePrice("$10 / input MTok")).toEqual({ ok: true, value: 10 });
  });

  it('normalizes "$50 / output MTok" to 50 (Anthropic format)', () => {
    expect(normalizePrice("$50 / output MTok")).toEqual({ ok: true, value: 50 });
  });

  it('normalizes "$5 / MTok" to 5 (Anthropic format)', () => {
    expect(normalizePrice("$5 / MTok")).toEqual({ ok: true, value: 5 });
  });

  it('normalizes "$5 per million tokens" to 5', () => {
    expect(normalizePrice("$5 per million tokens")).toEqual({ ok: true, value: 5 });
  });

  it('normalizes "$0" to 0 without fabricating', () => {
    expect(normalizePrice("$0")).toEqual({ ok: true, value: 0 });
  });

  it('does not silently normalize "Contact sales"', () => {
    expect(normalizePrice("Contact sales").ok).toBe(false);
  });

  it("never returns 0, NaN, or Infinity for unsafe input", () => {
    for (const bad of ["Contact sales", "", "free", "$-4", "NaN", "Infinity", "4 apples"]) {
      expect(normalizePrice(bad).ok, `expected ${JSON.stringify(bad)} to fail`).toBe(false);
    }
  });
});

describe("normalizeStatus", () => {
  it('normalizes "Active" to "active"', () => {
    expect(normalizeStatus("Active")).toEqual({ ok: true, value: "active" });
  });

  it('normalizes "DEPRECATED" to "deprecated"', () => {
    expect(normalizeStatus("DEPRECATED")).toEqual({ ok: true, value: "deprecated" });
  });

  it('normalizes "Unknown" to "unknown"', () => {
    expect(normalizeStatus("Unknown")).toEqual({ ok: true, value: "unknown" });
  });

  it("rejects unrecognized status text", () => {
    for (const bad of ["", "available", "GA", "retired soon"]) {
      expect(normalizeStatus(bad).ok, `expected ${JSON.stringify(bad)} to fail`).toBe(false);
    }
  });
});

describe("normalizeDate", () => {
  it('normalizes "March 1, 2027" to "2027-03-01"', () => {
    expect(normalizeDate("March 1, 2027")).toEqual({ ok: true, value: "2027-03-01" });
  });

  it("passes through valid ISO dates unchanged", () => {
    expect(normalizeDate("2027-03-01")).toEqual({ ok: true, value: "2027-03-01" });
  });

  it("rejects invalid dates and non-dates", () => {
    for (const bad of ["", "2027-13-01", "March 32, 2027", "2027/03/01", "tomorrow"]) {
      expect(normalizeDate(bad).ok, `expected ${JSON.stringify(bad)} to fail`).toBe(false);
    }
  });
});
