import { describe, expect, it } from "vitest";
import { prepareObservation } from "../../packages/core/src/prepare";
import type { RawObservation } from "../../packages/core/src/prepare";

function validRaw(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
    sourceUrl: "https://example.com/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("prepareObservation", () => {
  it("valid raw observation → candidate, schemaValid=true, semanticHash", () => {
    const result = prepareObservation(validRaw());
    expect(result.schemaValid).toBe(true);
    expect(result.candidate).not.toBeNull();
    expect(result.semanticHash).toBeTruthy();
    expect(result.errors).toEqual([]);
    expect(result.missingFields).toEqual([]);
    expect(result.unsafeFields).toEqual([]);
  });

  it("missing inputPrice → missingFields populated, schemaValid=false", () => {
    const raw = validRaw({ inputPrice: undefined });
    const result = prepareObservation(raw);
    expect(result.schemaValid).toBe(false);
    expect(result.missingFields).toContain("pricing.inputPrice");
    expect(result.candidate).toBeNull();
    expect(result.semanticHash).toBeNull();
  });

  it("missing provider → validation error from validateCandidate", () => {
    const raw = validRaw({ provider: "" });
    const result = prepareObservation(raw);
    expect(result.schemaValid).toBe(false);
    expect(result.errors.some((e) => e.includes("provider"))).toBe(true);
  });

  it("unsafe inputPrice value → unsafeFields populated", () => {
    const raw = validRaw({ inputPrice: "Contact sales" });
    const result = prepareObservation(raw);
    expect(result.schemaValid).toBe(false);
    expect(result.unsafeFields).toContain("pricing.inputPrice");
  });

  it("normalization: 128k → 128000", () => {
    const result = prepareObservation(validRaw());
    expect(result.candidate?.contextWindow).toBe(128000);
  });

  it("normalization: $4 / 1M tokens → 4", () => {
    const result = prepareObservation(validRaw());
    expect(result.candidate?.pricing?.inputPrice).toBe(4);
  });

  it("normalization: Active → active", () => {
    const result = prepareObservation(validRaw());
    expect(result.candidate?.status).toBe("active");
  });

  it("missing all required fields → errors and missingFields populated", () => {
    const raw = validRaw({
      provider: undefined,
      modelId: undefined,
      status: undefined,
      inputPrice: undefined,
    });
    const result = prepareObservation(raw);
    expect(result.schemaValid).toBe(false);
    // provider/modelId go through validateCandidate as errors
    expect(result.errors.length).toBeGreaterThan(0);
    // inputPrice goes through missingFields tracking
    expect(result.missingFields).toContain("pricing.inputPrice");
  });
});
