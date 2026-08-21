import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  quarantineExtractionDrift,
  verifyRepairCandidateAndApprove,
  rejectRepair,
  type HealingContext,
} from "../../apps/web/lib/healing";
import { createFakeDb } from "../helpers/fake-prisma";
import type { FakeDb } from "../helpers/fake-prisma";

describe("quarantineExtractionDrift", () => {
  let db: FakeDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createFakeDb();
  });

  it("EXTRACTION_DRIFT + RETRY_EXHAUSTED → QUARANTINED + HealAttempt", async () => {
    // Set up provider/model
    await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    // Create a DriftEvent
    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_mszty5alythqu9dqd",
      previousHash: "81ac4862",
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
    };

    const result = await quarantineExtractionDrift(db, ctx);

    expect(result.quarantined).toBe(true);
    expect(result.healAttempt).not.toBeNull();
    expect(result.healAttempt!.driftEventId).toBe(driftEvent.id);
    expect(result.healAttempt!.previousCollectorId).toBe("c_mszty5alythqu9dqd");
    expect(result.healAttempt!.previousHash).toBe("81ac4862");
    expect(result.healAttempt!.status).toBe("pending");

    // Model health state should be QUARANTINED
    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("QUARANTINED");
  });

  it("EXTRACTION_DRIFT without RETRY_EXHAUSTED → NOT quarantined", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_test",
      previousHash: "81ac4862",
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["REQUIRED_FIELD_MISSING"], // NO RETRY_EXHAUSTED
    };

    const result = await quarantineExtractionDrift(db, ctx);

    expect(result.quarantined).toBe(false);
    expect(result.healAttempt).toBeNull();

    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("HEALTHY");
  });

  it("SEMANTIC_DRIFT → NOT quarantined, no HealAttempt", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "SEMANTIC_DRIFT",
        reasonCodes: ["SEMANTIC_FIELD_CHANGED"],
        explanations: [],
        fieldDiffs: [{ field: "pricing.inputPrice", previous: 4, current: 6 }],
        previousHash: "81ac4862",
        currentHash: "f3d45ec4",
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_test",
      previousHash: "81ac4862",
      driftType: "SEMANTIC_DRIFT",
      reasonCodes: ["SEMANTIC_FIELD_CHANGED"],
    };

    const result = await quarantineExtractionDrift(db, ctx);

    expect(result.quarantined).toBe(false);
    expect(result.healAttempt).toBeNull();
  });

  it("AMBIGUOUS_DRIFT → NOT quarantined, no automatic HealAttempt", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "AMBIGUOUS_DRIFT",
        reasonCodes: ["UNSAFE_VALUE"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_test",
      previousHash: "81ac4862",
      driftType: "AMBIGUOUS_DRIFT",
      reasonCodes: ["UNSAFE_VALUE"],
    };

    const result = await quarantineExtractionDrift(db, ctx);

    expect(result.quarantined).toBe(false);
    expect(result.healAttempt).toBeNull();
  });

  it("NO_DRIFT → NOT quarantined", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "NO_DRIFT",
        reasonCodes: ["SEMANTIC_HASH_UNCHANGED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: "81ac4862",
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_test",
      previousHash: "81ac4862",
      driftType: "NO_DRIFT",
      reasonCodes: ["SEMANTIC_HASH_UNCHANGED"],
    };

    const result = await quarantineExtractionDrift(db, ctx);

    expect(result.quarantined).toBe(false);
    expect(result.healAttempt).toBeNull();
  });

  it("HealAttempt only records actual evidence at quarantine time", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const ctx: HealingContext = {
      driftEventId: driftEvent.id,
      modelRecordId: model.id,
      previousCollectorId: "c_mszty5alythqu9dqd",
      previousHash: "81ac4862",
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
    };

    const result = await quarantineExtractionDrift(db, ctx);

    // Candidate fields must not be set at quarantine time
    expect(result.healAttempt!.candidateRunId ?? null).toBeNull();
    expect(result.healAttempt!.candidateOutput ?? null).toBeNull();
    expect(result.healAttempt!.candidateHash ?? null).toBeNull();
    expect(result.healAttempt!.candidateSchemaValid ?? null).toBeNull();
    expect(result.healAttempt!.semanticMatch ?? null).toBeNull();
    expect(result.healAttempt!.completedAt ?? null).toBeNull();
  });
});

describe("verifyRepairCandidateAndApprove", () => {
  let db: FakeDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createFakeDb();
  });

  it("semantic match → approve → VERIFIED → HEALTHY", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    // Simulate quarantine
    await db.model.update({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      data: { healthState: "QUARANTINED" },
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const healAttempt = await db.healAttempt.create({
      data: {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_test",
        previousHash: "81ac4862",
        status: "pending",
      },
    });

    const result = await verifyRepairCandidateAndApprove(db, {
      healAttemptId: healAttempt.id,
      modelRecordId: model.id,
      previousHash: "81ac4862",
      candidateRunId: "j_mt2lp3ww174tcil1wk",
      candidateOutput: [{ provider: "demo-ai", modelId: "model-x", status: "Active", inputPrice: "$4", outputPrice: "$12" }],
      candidateHash: "81ac4862",
      candidateSchemaValid: true,
    });

    expect(result.approved).toBe(true);
    expect(result.semanticMatch).toBe(true);

    const updated = await db.healAttempt.findUnique({ where: { id: healAttempt.id } });
    expect(updated!.status).toBe("approved");
    expect(updated!.candidateRunId).toBe("j_mt2lp3ww174tcil1wk");
    expect(updated!.candidateHash).toBe("81ac4862");
    expect(updated!.semanticMatch).toBe(true);
    expect(updated!.completedAt).not.toBeNull();

    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("HEALTHY");
  });

  it("semantic mismatch → reject → FAILED", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    await db.model.update({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      data: { healthState: "QUARANTINED" },
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const healAttempt = await db.healAttempt.create({
      data: {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_test",
        previousHash: "81ac4862",
        status: "pending",
      },
    });

    // Candidate has different semantic hash (inputPrice = 6 vs 4)
    const result = await verifyRepairCandidateAndApprove(db, {
      healAttemptId: healAttempt.id,
      modelRecordId: model.id,
      previousHash: "81ac4862",
      candidateRunId: "j_test_mismatch",
      candidateOutput: [{ provider: "demo-ai", modelId: "model-x", status: "Active", inputPrice: "$6", outputPrice: "$12" }],
      candidateHash: "f3d45ec4",
      candidateSchemaValid: true,
    });

    expect(result.approved).toBe(false);
    expect(result.semanticMatch).toBe(false);

    const updated = await db.healAttempt.findUnique({ where: { id: healAttempt.id } });
    expect(updated!.status).toBe("rejected");
    expect(updated!.semanticMatch).toBe(false);
    expect(updated!.completedAt).not.toBeNull();

    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("FAILED");
  });

  it("invalid repair → reject → FAILED, contract preserved", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    await db.model.update({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      data: { healthState: "QUARANTINED" },
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const healAttempt = await db.healAttempt.create({
      data: {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_test",
        previousHash: "81ac4862",
        status: "pending",
      },
    });

    // Candidate structurally invalid
    const result = await verifyRepairCandidateAndApprove(db, {
      healAttemptId: healAttempt.id,
      modelRecordId: model.id,
      previousHash: "81ac4862",
      candidateRunId: "j_test_invalid",
      candidateOutput: [{ sourceUrl: "https://example.com" }], // missing required fields
      candidateHash: null,
      candidateSchemaValid: false,
    });

    expect(result.approved).toBe(false);

    const updated = await db.healAttempt.findUnique({ where: { id: healAttempt.id } });
    expect(updated!.status).toBe("rejected");

    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("FAILED");
  });

  it("contract not modified by extraction repair", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    // Existing valid contract
    await db.contract.upsert({
      where: { modelId: model.id },
      create: {
        modelId: model.id,
        status: "active",
        inputPrice: 4,
        outputPrice: 12,
        currency: "USD",
        pricingUnit: "per_1m_tokens",
        semanticHash: "81ac4862",
        sourceUrl: "https://example.com",
        collectorId: "c_test",
        collectorVersion: "1.0",
        observedAt: new Date().toISOString(),
      },
      update: {},
    });

    await db.model.update({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      data: { healthState: "QUARANTINED" },
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const healAttempt = await db.healAttempt.create({
      data: {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_test",
        previousHash: "81ac4862",
        status: "pending",
      },
    });

    await verifyRepairCandidateAndApprove(db, {
      healAttemptId: healAttempt.id,
      modelRecordId: model.id,
      previousHash: "81ac4862",
      candidateRunId: "j_test_repair",
      candidateOutput: [{ provider: "demo-ai", modelId: "model-x", status: "Active", inputPrice: "$4", outputPrice: "$12" }],
      candidateHash: "81ac4862",
      candidateSchemaValid: true,
    });

    // Contract values should remain unchanged (provenance-safe repair)
    const contract = await db.contract.findUnique({ where: { modelId: model.id } });
    expect(contract!.inputPrice).toBe(4);
    expect(contract!.outputPrice).toBe(12);
    expect(contract!.semanticHash).toBe("81ac4862");
  });
});

describe("rejectRepair", () => {
  let db: FakeDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createFakeDb();
  });

  it("manual reject → FAILED, contract preserved", async () => {
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "model-x" },
      update: {},
    });

    await db.model.update({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      data: { healthState: "AWAITING_APPROVAL" },
    });

    const driftEvent = await db.driftEvent.create({
      data: {
        modelRecordId: model.id,
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["REQUIRED_FIELD_MISSING", "RETRY_EXHAUSTED"],
        explanations: [],
        fieldDiffs: [],
        previousHash: "81ac4862",
        currentHash: null,
      },
    });

    const healAttempt = await db.healAttempt.create({
      data: {
        driftEventId: driftEvent.id,
        modelRecordId: model.id,
        previousCollectorId: "c_test",
        previousHash: "81ac4862",
        candidateHash: "81ac4862",
        candidateSchemaValid: true,
        semanticMatch: true,
        status: "pending",
      },
    });

    const result = await rejectRepair(db, {
      healAttemptId: healAttempt.id,
      modelRecordId: model.id,
      reason: "Operator rejected",
    });

    expect(result.rejected).toBe(true);

    const updated = await db.healAttempt.findUnique({ where: { id: healAttempt.id } });
    expect(updated!.status).toBe("rejected");

    const updatedModel = await db.model.findUnique({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
    });
    expect(updatedModel!.healthState).toBe("FAILED");
  });
});
