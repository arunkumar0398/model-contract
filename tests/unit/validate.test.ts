import { describe, expect, it } from "vitest";
import { validateCandidate, type CandidateObservation } from "@modelcontract/core";

const valid: CandidateObservation = {
  provider: "demo-ai",
  modelId: "model-x",
  status: "active",
  contextWindow: 128000,
  pricing: {
    inputPrice: 4,
    outputPrice: 12,
    currency: "USD",
    unit: "per_1m_tokens",
  },
  source: {
    url: "https://demo.example/model-x",
    collectorId: "col-1",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  },
  confidence: 0.98,
};

describe("validateCandidate", () => {
  it("accepts a fully valid candidate", () => {
    const result = validateCandidate(valid);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not throw for null, undefined, or non-object input", () => {
    for (const bad of [null, undefined, "nope", 42, []]) {
      const result = validateCandidate(bad);
      expect(result.ok, `expected ${JSON.stringify(bad)} to be invalid`).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("requires provider and modelId", () => {
    const result = validateCandidate({ ...valid, provider: "", modelId: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("provider"))).toBe(true);
    expect(result.errors.some((e) => e.includes("modelId"))).toBe(true);
  });

  it("rejects invalid status values", () => {
    expect(validateCandidate({ ...valid, status: "retired" }).ok).toBe(false);
  });

  it("requires contextWindow to be a positive number when present", () => {
    expect(validateCandidate({ ...valid, contextWindow: 0 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, contextWindow: -1 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, contextWindow: "128k" }).ok).toBe(false);
    expect(validateCandidate({ ...valid, contextWindow: 128000 }).ok).toBe(true);
  });

  it("requires prices to be safely normalized non-negative numbers", () => {
    expect(validateCandidate({ ...valid, pricing: { ...valid.pricing!, inputPrice: -1 } }).ok).toBe(false);
    expect(validateCandidate({ ...valid, pricing: { ...valid.pricing!, inputPrice: "4" } }).ok).toBe(false);
    expect(validateCandidate({ ...valid, pricing: { ...valid.pricing!, inputPrice: 4 } }).ok).toBe(true);
  });

  it("requires pricing unit 'per_1m_tokens' and currency 'USD'", () => {
    expect(validateCandidate({ ...valid, pricing: { ...valid.pricing!, unit: "per_1m_characters" } }).ok).toBe(false);
    expect(validateCandidate({ ...valid, pricing: { ...valid.pricing!, currency: "EUR" } }).ok).toBe(false);
  });

  it("requires inputPrice when a pricing block is present", () => {
    const pricingWithoutInput: CandidateObservation["pricing"] = {
      outputPrice: valid.pricing!.outputPrice,
      currency: "USD",
      unit: "per_1m_tokens",
    };
    const result = validateCandidate({ ...valid, pricing: pricingWithoutInput });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("inputPrice"))).toBe(true);
  });

  it("requires source provenance fields", () => {
    const result = validateCandidate({
      ...valid,
      source: { url: "", collectorId: "", collectorVersion: "", observedAt: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("url"))).toBe(true);
    expect(result.errors.some((e) => e.includes("collectorId"))).toBe(true);
  });

  it("bounds confidence to [0, 1]", () => {
    expect(validateCandidate({ ...valid, confidence: 1.5 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, confidence: -0.1 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, confidence: 0.5 }).ok).toBe(true);
    expect(validateCandidate({ ...valid, confidence: undefined }).ok).toBe(true);
  });

  it("warns (but accepts) when deprecationDate is present while status is active", () => {
    const result = validateCandidate({ ...valid, deprecationDate: "2027-03-01" });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("rejects malformed deprecationDate", () => {
    expect(validateCandidate({ ...valid, deprecationDate: "March 1, 2027" }).ok).toBe(false);
  });
});
