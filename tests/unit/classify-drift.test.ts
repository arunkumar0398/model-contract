import { describe, expect, it } from "vitest";
import {
  classifyDrift,
  type DriftInput,
  type ObservationEvidence,
} from "../../packages/core/src/classify-drift";
import type { ModelContract } from "../../packages/core/src/contract";

const BASE_CONTRACT: ModelContract = {
  provider: "demo-ai",
  modelId: "model-x",
  status: "active",
  contextWindow: 128000,
  pricing: { inputPrice: 4, outputPrice: 12, currency: "USD", unit: "per_1m_tokens" },
  source: {
    url: "https://demo.example/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  },
  validation: { schemaValid: true, confidence: 0.99, warnings: [] },
};

const HEALTHY_CANDIDATE: DriftInput["candidate"] = {
  provider: "demo-ai",
  modelId: "model-x",
  status: "active",
  contextWindow: 128000,
  pricing: { inputPrice: 4, outputPrice: 12, currency: "USD", unit: "per_1m_tokens" },
  source: {
    url: "https://demo.example/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  },
};

function evidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    collectionFailed: false,
    retryExhausted: false,
    schemaValid: true,
    unsafeFields: [],
    missingFields: [],
    validationErrors: [],
    ...overrides,
  };
}

describe("classifyDrift", () => {
  it("NO_DRIFT: same hash -> SEMANTIC_HASH_UNCHANGED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: HEALTHY_CANDIDATE,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.previousHash).toBe(result.currentHash);
  });

  it("NO_DRIFT: provenance-only change -> SEMANTIC_HASH_UNCHANGED", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE!,
      source: { ...HEALTHY_CANDIDATE!.source, observedAt: "2031-01-01T00:00:00.000Z" },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });

  it("NO_DRIFT: first observation -> BASELINE_ESTABLISHED", () => {
    const result = classifyDrift({
      previousContract: null,
      candidate: HEALTHY_CANDIDATE,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("BASELINE_ESTABLISHED");
    expect(result.previousHash).toBeNull();
    expect(result.currentHash).toBeTruthy();
  });

  it("SEMANTIC_DRIFT: $4 -> $6 with fieldDiff", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE!,
      pricing: { ...HEALTHY_CANDIDATE!.pricing!, inputPrice: 6 },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_FIELD_CHANGED");
    expect(result.fieldDiffs).toEqual([{ field: "pricing.inputPrice", previous: 4, current: 6 }]);
  });

  it("SEMANTIC_DRIFT: active -> deprecated with fieldDiff", () => {
    const candidate = { ...HEALTHY_CANDIDATE!, status: "deprecated" as const };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);
  });

  it("EXTRACTION_DRIFT: schemaInvalid -> EXTRACTION_VALIDATION_FAILED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, validationErrors: ["inputPrice required"] }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.reasonCodes).toContain("EXTRACTION_VALIDATION_FAILED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.currentHash).toBeNull();
  });

  it("EXTRACTION_DRIFT: missingFields -> REQUIRED_FIELD_MISSING (4->null is NOT SEMANTIC_DRIFT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, missingFields: ["pricing.inputPrice"] }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.reasonCodes).toContain("REQUIRED_FIELD_MISSING");
    expect(result.driftType).not.toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("AMBIGUOUS_DRIFT: unsafeFields -> UNSAFE_VALUE", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, unsafeFields: ["pricing.inputPrice"] }),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.reasonCodes).toContain("UNSAFE_VALUE");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("TRANSIENT_FAILURE: collectionFailed -> COLLECTION_FAILED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ collectionFailed: true, schemaValid: false }),
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.reasonCodes).toContain("COLLECTION_FAILED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.currentHash).toBeNull();
  });

  it("TRANSIENT_FAILURE: collectionFailed + retryExhausted -> still TRANSIENT_FAILURE", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ collectionFailed: true, retryExhausted: true, schemaValid: false }),
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
  });

  it("EXTRACTION_DRIFT + retryExhausted -> EXTRACTION_DRIFT (not TRANSIENT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({
        retryExhausted: true,
        schemaValid: false,
        missingFields: ["pricing.inputPrice"],
      }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.driftType).not.toBe("TRANSIENT_FAILURE");
  });

  it("AMBIGUOUS_DRIFT + retryExhausted -> AMBIGUOUS_DRIFT (not TRANSIENT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({
        retryExhausted: true,
        schemaValid: false,
        unsafeFields: ["pricing.inputPrice"],
      }),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.driftType).not.toBe("TRANSIENT_FAILURE");
  });

  it("critical invariant: invalid observation NEVER produces SEMANTIC_DRIFT", () => {
    const cases: DriftInput[] = [
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false, missingFields: ["pricing.inputPrice"] }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false, unsafeFields: ["pricing.inputPrice"] }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ collectionFailed: true, schemaValid: false }),
      },
    ];
    for (const input of cases) {
      expect(classifyDrift(input).driftType).not.toBe("SEMANTIC_DRIFT");
    }
  });

  it("multi-field diff: inputPrice + outputPrice change in canonical order", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE!,
      pricing: { ...HEALTHY_CANDIDATE!.pricing!, inputPrice: 6, outputPrice: 15 },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs.map((d) => d.field)).toEqual([
      "pricing.inputPrice",
      "pricing.outputPrice",
    ]);
  });
});
