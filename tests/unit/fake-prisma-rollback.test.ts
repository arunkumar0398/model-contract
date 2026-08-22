import { describe, expect, it } from "vitest";
import { createFakeDb } from "../helpers/fake-prisma";

describe("fake-prisma Stage 4 rollback", () => {
  it("rollback restores healthState and removes HealAttempt on transaction failure", async () => {
    const db = createFakeDb();

    // Setup: create provider and model
    const provider = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "Demo AI", slug: "demo-ai" },
      update: {},
    });

    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "model-x" } },
      create: { providerId: provider.id, modelId: "model-x", displayName: "Model X" },
      update: {},
    });

    // Verify initial state
    expect(model.healthState).toBe("HEALTHY");

    // Inside transaction: change healthState + create HealAttempt
    await expect(
      db.$transaction(async (tx) => {
        // Update health state
        const updated = await tx.model.update({
          where: { id: model.id },
          data: { healthState: "QUARANTINED" },
        });
        expect(updated.healthState).toBe("QUARANTINED");

        // Create heal attempt
        await tx.healAttempt.create({
          data: {
            driftEventId: "fake_drift_1",
            modelRecordId: model.id,
            previousHash: "81ac4862",
            status: "pending",
          },
        });

        // Intentional failure
        throw new Error("Simulated transaction failure");
      }),
    ).rejects.toThrow("Simulated transaction failure");

    // After rollback: healthState restored, HealAttempt absent
    const models = await db.model.findMany();
    const modelAfter = models.find((m) => m.id === model.id);
    expect(modelAfter?.healthState).toBe("HEALTHY"); // restored

    const healAttempts = await db.healAttempt.findMany();
    expect(healAttempts).toHaveLength(0); // removed

    // Existing data unchanged
    const providers = await db.provider.upsert({
      where: { slug: "demo-ai" },
      create: { name: "Demo AI", slug: "demo-ai" },
      update: {},
    });
    expect(providers.id).toBe(provider.id);
  });

  it("successful transaction persists healthState and HealAttempt", async () => {
    const db = createFakeDb();

    const provider = await db.provider.upsert({
      where: { slug: "anthropic" },
      create: { name: "Anthropic", slug: "anthropic" },
      update: {},
    });

    const model = await db.model.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: "claude-3" } },
      create: { providerId: provider.id, modelId: "claude-3", displayName: "Claude 3" },
      update: {},
    });

    // Successful transaction
    await db.$transaction(async (tx) => {
      await tx.model.update({
        where: { id: model.id },
        data: { healthState: "QUARANTINED" },
      });

      await tx.healAttempt.create({
        data: {
          driftEventId: "fake_drift_2",
          modelRecordId: model.id,
          previousHash: "abc123",
          status: "pending",
        },
      });
    });

    // Verify persisted state
    const models = await db.model.findMany();
    const modelAfter = models.find((m) => m.id === model.id);
    expect(modelAfter?.healthState).toBe("QUARANTINED");

    const healAttempts = await db.healAttempt.findMany();
    expect(healAttempts).toHaveLength(1);
    const first = healAttempts[0];
    expect(first).toBeDefined();
    expect(first!.status).toBe("pending");
    expect(first!.previousHash).toBe("abc123");
  });
});
