import { describe, expect, it, beforeEach } from "vitest";
import { classifyDrift } from "../../packages/core/src/classify-drift";
import { verifyRepairCandidate } from "../../packages/core/src/healing";
import { contractFromVariant } from "../helpers/contract-from-variant";
import { createFakeDb } from "../helpers/fake-prisma";
import { demoVariants } from "../../fixtures/provider-demo/shared";
import {
  quarantineExtractionDrift,
  verifyRepairCandidateAndApprove,
} from "../../apps/web/lib/healing";
import type { HealingContext } from "../../apps/web/lib/healing";

const HEALTHY_CONTRACT = contractFromVariant(demoVariants.HEALTHY)!;
const HEALTHY_HASH = "81ac4862";
const MISMATCH_HASH = "f3d45ec4";

function brokenEvidence(retryExhausted: boolean) {
  return {
    collectionFailed: false,
    retryExhausted,
    schemaValid: false,
    unsafeFields: [],
    missingFields: [
      "pricing.inputPrice",
      "pricing.outputPrice",
      "status",
      "contextWindow",
    ],
    validationErrors: [
      "provider required",
      "modelId required",
      "status invalid",
    ],
  };
}

describe("full deterministic Stage 4 integration", () => {
  let db: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    db = createFakeDb();
  });

  describe("Scenario A: extraction drift → quarantine → repair → recovery", () => {
    it("complete lifecycle: break → retry → quarantine → repair → approve → healthy", async () => {
      // ── Step 1: HEALTHY baseline ──
      const providers = await db.provider.upsert({
        where: { slug: "demo-ai" },
        create: { name: "demo-ai", slug: "demo-ai" },
        update: {},
      });
      const model = await db.model.upsert({
        where: {
          providerId_modelId: { providerId: providers.id, modelId: "model-x" },
        },
        create: {
          providerId: providers.id,
          modelId: "model-x",
          displayName: "model-x",
        },
        update: {},
      });

      await db.contract.upsert({
        where: { modelId: model.id },
        create: {
          modelId: model.id,
          status: "active",
          inputPrice: 4,
          outputPrice: 12,
          currency: "USD",
          pricingUnit: "per_1m_tokens",
          semanticHash: HEALTHY_HASH,
          sourceUrl: "https://demo.example/provider-demo/model-x",
          collectorId: "c_mszty5alythqu9dqd",
          collectorVersion: "v1",
          observedAt: new Date().toISOString(),
        },
        update: {},
      });

      // Verify baseline
      expect(model.healthState).toBe("HEALTHY");
      const contractBefore = await db.contract.findUnique({
        where: { modelId: model.id },
      });
      expect(contractBefore!.inputPrice).toBe(4);
      expect(contractBefore!.outputPrice).toBe(12);
      expect(contractBefore!.semanticHash).toBe(HEALTHY_HASH);

      // ── Step 2: BROKEN extraction attempt 1 ──
      const brokenAttempt1 = classifyDrift({
        previousContract: HEALTHY_CONTRACT,
        candidate: null,
        evidence: brokenEvidence(false),
      });
      expect(brokenAttempt1.driftType).toBe("EXTRACTION_DRIFT");

      // ── Step 3: Retry once → still invalid ──
      const brokenAttempt2 = classifyDrift({
        previousContract: HEALTHY_CONTRACT,
        candidate: null,
        evidence: brokenEvidence(true), // retryExhausted = true
      });
      expect(brokenAttempt2.driftType).toBe("EXTRACTION_DRIFT");

      // ── Step 4: Persisted decision → QUARANTINED + HealAttempt ──
      const driftEvent = await db.driftEvent.create({
        data: {
          modelRecordId: model.id,
          driftType: "EXTRACTION_DRIFT",
          reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
          explanations: brokenAttempt2.explanations,
          fieldDiffs: [],
          previousHash: HEALTHY_HASH,
          currentHash: null,
        },
      });

      const ctx: HealingContext = {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_mszty5alythqu9dqd",
        previousHash: HEALTHY_HASH,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
      };

      const quarantineResult = await quarantineExtractionDrift(db, ctx);
      expect(quarantineResult.quarantined).toBe(true);
      expect(quarantineResult.healAttempt).not.toBeNull();
      expect(quarantineResult.healAttempt!.status).toBe("pending");

      // Verify QUARANTINED
      const quarantinedModel = await db.model.findUnique({
        where: { id: model.id },
      });
      expect(quarantinedModel!.healthState).toBe("QUARANTINED");

      // Contract preserved during quarantine
      const contractDuringQuarantine = await db.contract.findUnique({
        where: { modelId: model.id },
      });
      expect(contractDuringQuarantine!.inputPrice).toBe(4);
      expect(contractDuringQuarantine!.outputPrice).toBe(12);

      // ── Step 5: Simulated post-repair candidate (valid, same semantics) ──
      const repairHash = verifyRepairCandidate(
        HEALTHY_HASH,
        HEALTHY_HASH,
      );
      expect(repairHash).toBe(true);

      const repairResult = await verifyRepairCandidateAndApprove(db, {
        healAttemptId: quarantineResult.healAttempt!.id,
        modelRecordId: model.id,
        previousHash: HEALTHY_HASH,
        candidateRunId: "j_mt2ngwat2qox9iaziz",
        candidateOutput: [
          {
            provider: "demo-ai",
            modelId: "model-x",
            status: "Active",
            inputPrice: "$4",
            outputPrice: "$12",
            contextWindow: "128k",
          },
        ],
        candidateHash: HEALTHY_HASH,
        candidateSchemaValid: true,
      });

      // ── Step 6: Verify recovery ──
      expect(repairResult.approved).toBe(true);
      expect(repairResult.semanticMatch).toBe(true);

      const healedModel = await db.model.findUnique({
        where: { id: model.id },
      });
      expect(healedModel!.healthState).toBe("HEALTHY");

      // Previous semantic Contract values preserved
      const contractAfterHeal = await db.contract.findUnique({
        where: { modelId: model.id },
      });
      expect(contractAfterHeal!.inputPrice).toBe(4);
      expect(contractAfterHeal!.outputPrice).toBe(12);
      expect(contractAfterHeal!.semanticHash).toBe(HEALTHY_HASH);

      // HealAttempt approved
      const healAttempt = await db.healAttempt.findUnique({
        where: { id: quarantineResult.healAttempt!.id },
      });
      expect(healAttempt!.status).toBe("approved");
      expect(healAttempt!.semanticMatch).toBe(true);
      expect(healAttempt!.completedAt).not.toBeNull();
    });
  });

  describe("Scenario B: failed repair (semantic mismatch)", () => {
    it("valid extraction with changed semantics → reject → FAILED, contract preserved", async () => {
      // Seed provider/model/contract
      const providers = await db.provider.upsert({
        where: { slug: "demo-ai" },
        create: { name: "demo-ai", slug: "demo-ai" },
        update: {},
      });
      const model = await db.model.upsert({
        where: {
          providerId_modelId: { providerId: providers.id, modelId: "model-x" },
        },
        create: {
          providerId: providers.id,
          modelId: "model-x",
          displayName: "model-x",
        },
        update: {},
      });

      await db.contract.upsert({
        where: { modelId: model.id },
        create: {
          modelId: model.id,
          status: "active",
          inputPrice: 4,
          outputPrice: 12,
          currency: "USD",
          pricingUnit: "per_1m_tokens",
          semanticHash: HEALTHY_HASH,
          sourceUrl: "https://demo.example/provider-demo/model-x",
          collectorId: "c_test",
          collectorVersion: "v1",
          observedAt: new Date().toISOString(),
        },
        update: {},
      });

      // Quarantine
      await db.model.update({
        where: { id: model.id },
        data: { healthState: "QUARANTINED" },
      });

      const driftEvent = await db.driftEvent.create({
        data: {
          modelRecordId: model.id,
          driftType: "EXTRACTION_DRIFT",
          reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
          explanations: [],
          fieldDiffs: [],
          previousHash: HEALTHY_HASH,
          currentHash: null,
        },
      });

      const healAttempt = await db.healAttempt.create({
        data: {
          driftEventId: driftEvent.id,
          modelRecordId: model.id,
          previousCollectorId: "c_test",
          previousHash: HEALTHY_HASH,
          status: "pending",
        },
      });

      // Repair candidate: valid extraction BUT different semantics (inputPrice=6)
      expect(verifyRepairCandidate(HEALTHY_HASH, MISMATCH_HASH)).toBe(false);

      const result = await verifyRepairCandidateAndApprove(db, {
        healAttemptId: healAttempt.id,
        modelRecordId: model.id,
        previousHash: HEALTHY_HASH,
        candidateRunId: "j_test_mismatch",
        candidateOutput: [
          {
            provider: "demo-ai",
            modelId: "model-x",
            status: "Active",
            inputPrice: "$6",
            outputPrice: "$12",
          },
        ],
        candidateHash: MISMATCH_HASH,
        candidateSchemaValid: true,
      });

      // ── Verify: rejected, FAILED, contract preserved ──
      expect(result.approved).toBe(false);
      expect(result.semanticMatch).toBe(false);

      const updatedModel = await db.model.findUnique({
        where: { id: model.id },
      });
      expect(updatedModel!.healthState).toBe("FAILED");

      const updatedHeal = await db.healAttempt.findUnique({
        where: { id: healAttempt.id },
      });
      expect(updatedHeal!.status).toBe("rejected");

      // Previous valid Contract remains — no promotion of $6 candidate
      const contract = await db.contract.findUnique({
        where: { modelId: model.id },
      });
      expect(contract!.inputPrice).toBe(4);
      expect(contract!.outputPrice).toBe(12);
      expect(contract!.semanticHash).toBe(HEALTHY_HASH);
    });
  });

  describe("Scenario C: invalid repair (schema invalid)", () => {
    it("structurally invalid candidate → reject → FAILED, contract preserved, no fabricated hash", async () => {
      // Seed provider/model/contract
      const providers = await db.provider.upsert({
        where: { slug: "demo-ai" },
        create: { name: "demo-ai", slug: "demo-ai" },
        update: {},
      });
      const model = await db.model.upsert({
        where: {
          providerId_modelId: { providerId: providers.id, modelId: "model-x" },
        },
        create: {
          providerId: providers.id,
          modelId: "model-x",
          displayName: "model-x",
        },
        update: {},
      });

      await db.contract.upsert({
        where: { modelId: model.id },
        create: {
          modelId: model.id,
          status: "active",
          inputPrice: 4,
          outputPrice: 12,
          currency: "USD",
          pricingUnit: "per_1m_tokens",
          semanticHash: HEALTHY_HASH,
          sourceUrl: "https://demo.example/provider-demo/model-x",
          collectorId: "c_test",
          collectorVersion: "v1",
          observedAt: new Date().toISOString(),
        },
        update: {},
      });

      // Quarantine
      await db.model.update({
        where: { id: model.id },
        data: { healthState: "QUARANTINED" },
      });

      const driftEvent = await db.driftEvent.create({
        data: {
          modelRecordId: model.id,
          driftType: "EXTRACTION_DRIFT",
          reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
          explanations: [],
          fieldDiffs: [],
          previousHash: HEALTHY_HASH,
          currentHash: null,
        },
      });

      const healAttempt = await db.healAttempt.create({
        data: {
          driftEventId: driftEvent.id,
          modelRecordId: model.id,
          previousCollectorId: "c_test",
          previousHash: HEALTHY_HASH,
          status: "pending",
        },
      });

      // Invalid repair candidate (missing required fields)
      const result = await verifyRepairCandidateAndApprove(db, {
        healAttemptId: healAttempt.id,
        modelRecordId: model.id,
        previousHash: HEALTHY_HASH,
        candidateRunId: "j_test_invalid",
        candidateOutput: [{ sourceUrl: "https://example.com" }],
        candidateHash: null,
        candidateSchemaValid: false,
      });

      // ── Verify: rejected, FAILED, no fabricated hash ──
      expect(result.approved).toBe(false);
      expect(result.semanticMatch).toBe(false);

      const updatedModel = await db.model.findUnique({
        where: { id: model.id },
      });
      expect(updatedModel!.healthState).toBe("FAILED");

      const updatedHeal = await db.healAttempt.findUnique({
        where: { id: healAttempt.id },
      });
      expect(updatedHeal!.status).toBe("rejected");
      expect(updatedHeal!.candidateHash).toBeNull();
      expect(updatedHeal!.candidateSchemaValid).toBe(false);

      // Previous valid Contract preserved
      const contract = await db.contract.findUnique({
        where: { modelId: model.id },
      });
      expect(contract!.inputPrice).toBe(4);
      expect(contract!.outputPrice).toBe(12);
      expect(contract!.semanticHash).toBe(HEALTHY_HASH);
    });
  });
});
