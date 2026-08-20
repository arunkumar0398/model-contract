import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../helpers/fake-prisma";

describe("fake-prisma $transaction rollback", () => {
  it("restores state when callback throws", async () => {
    const db = createFakeDb();

    // Seed baseline data
    await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "demo-ai", slug: "demo-ai" },
      update: {},
    });
    await db.model.upsert({
      where: { providerId_modelId: { providerId: "p1", modelId: "model-x" } },
      create: { providerId: "p1", modelId: "model-x", displayName: "model-x" },
      update: {},
    });
    const contract = await db.contract.upsert({
      where: { modelId: "m1" },
      create: { modelId: "m1", status: "active", inputPrice: 4, semanticHash: "abc", sourceUrl: "u", collectorId: "c1", collectorVersion: "v1", observedAt: "2026-01-01" },
      update: {},
    });
    const obs = await db.observation.create({
      data: { modelId: "m1", rawPayload: {}, schemaValid: true, validationErrors: [], validationWarnings: [], collectorId: "c1", sourceUrl: "u", observedAt: "2026-01-01" },
    });

    // Snapshot counts
    const obsCount = db.__observations.length;
    const contractCount = db.__contracts.size;
    const driftCount = db.__driftEvents.length;

    // Force failure inside transaction
    await expect(
      db.$transaction(async (tx: any) => {
        await tx.observation.create({
          data: { modelId: "m1", rawPayload: {}, schemaValid: false, validationErrors: [], validationWarnings: [], collectorId: "c1", sourceUrl: "u", observedAt: "2026-01-01" },
        });
        await tx.driftEvent.create({
          data: { modelRecordId: "m1", driftType: "NO_DRIFT", reasonCodes: [], explanations: [], fieldDiffs: [] },
        });
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    // Verify rollback: counts unchanged
    expect(db.__observations.length).toBe(obsCount);
    expect(db.__contracts.size).toBe(contractCount);
    expect(db.__driftEvents.length).toBe(driftCount);
  });

  it("supports driftEvent.create inside $transaction", async () => {
    const db = createFakeDb();
    const result = await db.$transaction(async (tx: any) => {
      return tx.driftEvent.create({
        data: {
          modelRecordId: "model_1",
          observationId: "obs_1",
          driftType: "NO_DRIFT",
          reasonCodes: ["BASELINE_ESTABLISHED"],
          explanations: ["first observation"],
          fieldDiffs: [],
          createdAt: new Date(),
        },
      });
    });
    expect((result as any).id).toBeTruthy();
    expect((result as any).driftType).toBe("NO_DRIFT");
  });
});
