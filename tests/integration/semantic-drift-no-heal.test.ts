import { describe, expect, it, beforeEach } from "vitest";
import { classifyDrift } from "../../packages/core/src/classify-drift";
import { isHealingEligible } from "../../packages/core/src/healing";
import { contractFromVariant } from "../helpers/contract-from-variant";
import { createFakeDb } from "../helpers/fake-prisma";
import { demoVariants } from "../../fixtures/provider-demo/shared";
import { ingestObservation } from "../../apps/web/lib/ingest";
import type { RawObservation } from "../../apps/web/lib/ingest";

const HEALTHY_CONTRACT = contractFromVariant(demoVariants.HEALTHY)!;
const CHANGED_PRICE_CONTRACT = contractFromVariant(demoVariants.CHANGED_PRICE)!;
const DEPRECATED_CONTRACT = contractFromVariant(demoVariants.DEPRECATED)!;

function evidenceValid() {
  return {
    collectionFailed: false,
    retryExhausted: false,
    schemaValid: true,
    unsafeFields: [],
    missingFields: [],
    validationErrors: [],
  };
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

describe("semantic drift never triggers healing", () => {
  let db: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    db = createFakeDb();
  });

  it("CHANGED_PRICE: semantic drift, no healing, no quarantine", async () => {
    // Seed baseline
    await ingestObservation(db, variantToRaw("HEALTHY"));

    // Count heal attempts before
    const healBefore = db.__healAttempts.length;

    // Ingest CHANGED_PRICE
    const result = await ingestObservation(db, variantToRaw("CHANGED_PRICE"));

    // Classification is SEMANTIC_DRIFT
    expect(result.driftType).toBe("SEMANTIC_DRIFT");

    // The pure classifier also says SEMANTIC_DRIFT
    const decision = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: CHANGED_PRICE_CONTRACT,
      evidence: evidenceValid(),
    });
    expect(decision.driftType).toBe("SEMANTIC_DRIFT");

    // Field diff is pricing.inputPrice: 4 → 6
    expect(decision.fieldDiffs).toEqual([
      { field: "pricing.inputPrice", previous: 4, current: 6 },
    ]);

    // Healing eligibility is false
    expect(isHealingEligible(decision)).toBe(false);

    // HealAttempt count unchanged (delta = 0)
    const healAfter = db.__healAttempts.length;
    expect(healAfter - healBefore).toBe(0);

    // No quarantine — model stays HEALTHY
    const modelsList = await db.model.findMany();
    expect(modelsList.length).toBe(1);
    expect(modelsList[0].healthState).toBe("HEALTHY");
  });

  it("DEPRECATED: semantic drift, no healing, no quarantine", async () => {
    // Seed baseline
    await ingestObservation(db, variantToRaw("HEALTHY"));

    // Count heal attempts before
    const healBefore = db.__healAttempts.length;

    // Ingest DEPRECATED
    const result = await ingestObservation(db, variantToRaw("DEPRECATED"));

    // Classification is SEMANTIC_DRIFT
    expect(result.driftType).toBe("SEMANTIC_DRIFT");

    // The pure classifier also says SEMANTIC_DRIFT
    const decision = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: DEPRECATED_CONTRACT,
      evidence: evidenceValid(),
    });
    expect(decision.driftType).toBe("SEMANTIC_DRIFT");

    // Field diff is status: "active" → "deprecated"
    expect(decision.fieldDiffs).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);

    // Healing eligibility is false
    expect(isHealingEligible(decision)).toBe(false);

    // HealAttempt count unchanged (delta = 0)
    const healAfter = db.__healAttempts.length;
    expect(healAfter - healBefore).toBe(0);

    // No quarantine — model stays HEALTHY
    const modelsList = await db.model.findMany();
    expect(modelsList[0].healthState).toBe("HEALTHY");
  });
});
