/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { classifyDrift } from "../../packages/core/src/classify-drift";
import { demoVariants } from "../../fixtures/provider-demo/shared";
import { contractFromVariant } from "../helpers/contract-from-variant";
import { createFakeDb } from "../helpers/fake-prisma";
import { ingestObservation, recordCollectionFailure } from "../../apps/web/lib/ingest";
import type { RawObservation } from "../../apps/web/lib/ingest";
import type { ModelContract } from "../../packages/core/src/contract";
import type { ObservationEvidence } from "../../packages/core/src/classify-drift";

const HEALTHY_CONTRACT = contractFromVariant(demoVariants.HEALTHY)!;

function evidenceForVariant(variantId: string): ObservationEvidence {
  switch (variantId) {
    case "HEALTHY":
    case "CHANGED_PRICE":
    case "DEPRECATED":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: true,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [],
      };
    case "BROKEN_SELECTOR":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: ["pricing.inputPrice", "pricing.outputPrice", "status", "contextWindow"],
        validationErrors: ["provider required", "modelId required", "status invalid"],
      };
    case "MISSING_FIELD":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: ["pricing.inputPrice"],
        validationErrors: ["pricing.inputPrice: inputPrice is missing"],
      };
    case "AMBIGUOUS":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: ["pricing.inputPrice"],
        missingFields: [],
        validationErrors: [
          'pricing.inputPrice: cannot safely normalize price from "Contact sales"',
        ],
      };
    default:
      throw new Error(`unknown variant: ${variantId}`);
  }
}

function variantToRaw(variantId: string): RawObservation {
  const v = demoVariants[variantId as keyof typeof demoVariants];
  return {
    provider: "demo-ai",
    modelId: v.semantics.modelId,
    status: v.semantics.status,
    contextWindow: v.semantics.contextWindow,
    inputPrice: v.semantics.inputPrice ?? undefined,
    outputPrice: v.semantics.outputPrice ?? undefined,
    sourceUrl: "https://demo.example/provider-demo/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  };
}

describe("provider variant -> drift classification matrix", () => {
  it("HEALTHY -> HEALTHY = NO_DRIFT", () => {
    const candidate = contractFromVariant(demoVariants.HEALTHY)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("HEALTHY"),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });

  it("HEALTHY -> CHANGED_PRICE = SEMANTIC_DRIFT with pricing.inputPrice", () => {
    const candidate = contractFromVariant(demoVariants.CHANGED_PRICE)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("CHANGED_PRICE"),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([
      { field: "pricing.inputPrice", previous: 4, current: 6 },
    ]);
  });

  it("HEALTHY -> DEPRECATED = SEMANTIC_DRIFT with status", () => {
    const candidate = contractFromVariant(demoVariants.DEPRECATED)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("DEPRECATED"),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);
  });

  it("HEALTHY -> BROKEN_SELECTOR = EXTRACTION_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("BROKEN_SELECTOR"),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("HEALTHY -> MISSING_FIELD = EXTRACTION_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("MISSING_FIELD"),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("HEALTHY -> AMBIGUOUS = AMBIGUOUS_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("AMBIGUOUS"),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("collection failure = TRANSIENT_FAILURE", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: {
        collectionFailed: true,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [],
      },
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
  });

  it("provenance-only change = NO_DRIFT", () => {
    const candidate: ModelContract = {
      ...HEALTHY_CONTRACT,
      source: {
        url: "https://other.example/model-x",
        collectorId: "c_other",
        collectorVersion: "v2",
        observedAt: "2031-01-01T00:00:00.000Z",
      },
    };
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("HEALTHY"),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });
});

describe("full ingest -> DriftEvent round-trip", () => {
  it("persists DriftEvent with correct driftType for each variant", async () => {
    const db = createFakeDb();
    const baseline = await ingestObservation(db, variantToRaw("HEALTHY"));
    expect(baseline.driftType).toBe("NO_DRIFT");

    const changed = await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    expect(changed.driftType).toBe("SEMANTIC_DRIFT");

    const ambiguous = await ingestObservation(db, variantToRaw("AMBIGUOUS"));
    expect(ambiguous.driftType).toBe("AMBIGUOUS_DRIFT");

    const events = db.__driftEvents as any[];
    expect(events.length).toBe(3);
    expect(events[0].driftType).toBe("NO_DRIFT");
    expect(events[1].driftType).toBe("SEMANTIC_DRIFT");
    expect(events[2].driftType).toBe("AMBIGUOUS_DRIFT");
  });

  it("CHANGED_PRICE DriftEvent has correct fieldDiffs", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    const events = db.__driftEvents as any[];
    const semanticEvent = events.find((e: any) => e.driftType === "SEMANTIC_DRIFT");
    expect(semanticEvent.fieldDiffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "pricing.inputPrice", previous: 4, current: 6 }),
      ]),
    );
  });

  it("contract NOT promoted for AMBIGUOUS_DRIFT", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    await ingestObservation(db, variantToRaw("AMBIGUOUS"));
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(4);
  });

  it("contract promoted for SEMANTIC_DRIFT", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(6);
  });

  it("recordCollectionFailure persists DriftEvent with observationId=null", async () => {
    const db = createFakeDb();
    const result = await recordCollectionFailure(db, {
      provider: "demo-ai",
      modelId: "model-x",
      retryExhausted: false,
      failureReason: "network timeout",
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.driftEventId).toBeTruthy();
    const events = db.__driftEvents as any[];
    expect(events.length).toBe(1);
    expect(events[0].observationId).toBeNull();
    expect(events[0].driftType).toBe("TRANSIENT_FAILURE");
  });

  it("recordCollectionFailure does not create Observation or promote Contract", async () => {
    const db = createFakeDb();
    // Seed baseline
    await ingestObservation(db, variantToRaw("HEALTHY"));
    const obsCount = db.__observations.length;
    const contractBefore = [...db.__contracts.values()][0] as any;

    await recordCollectionFailure(db, {
      provider: "demo-ai",
      modelId: "model-x",
      retryExhausted: false,
      failureReason: "network timeout",
    });

    expect(db.__observations.length).toBe(obsCount); // no new observation
    const contractAfter = [...db.__contracts.values()][0] as any;
    expect(contractAfter.inputPrice).toBe(contractBefore.inputPrice); // unchanged
  });
});
