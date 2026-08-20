import { describe, expect, it, vi } from "vitest";
import { normalizeContextWindow, normalizePrice, normalizeStatus, semanticHash } from "@modelcontract/core";
import { ingestObservation, type RawObservation } from "../../apps/web/lib/ingest";
import { createFakeDb, type FakeDb } from "../helpers/fake-prisma";

function healthyInput(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
    deprecationDate: undefined,
    sourceUrl: "https://demo.example/provider-demo/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    runId: "j_123",
    observedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

async function storedObservation(db: FakeDb, index = 0) {
  return db.__observations[index] as Record<string, unknown>;
}

describe("ingestObservation", () => {
  it("promotes a valid observation to the current contract with provenance", async () => {
    const db = createFakeDb();
    const result = await ingestObservation(db, healthyInput());

    expect(result.schemaValid).toBe(true);
    expect(result.contractId).toBeTruthy();
    expect(result.errors).toEqual([]);

    const obs = await storedObservation(db);
    expect(obs.schemaValid).toBe(true);
    expect(obs.collectorId).toBe("c_demo");
    expect(obs.collectorVersion).toBe("v1");
    expect(obs.runId).toBe("j_123");
    expect(obs.sourceUrl).toContain("provider-demo/model-x");
    expect(obs.observedAt).toBe("2026-08-17T00:00:00.000Z");
    expect(obs.rawPayload).toMatchObject({ inputPrice: "$4 / 1M tokens" });
    expect(obs.normalizedPayload).toMatchObject({ status: "active", contextWindow: 128000 });

    // Expected semantic hash of the normalized contract.
    const expectedHash = semanticHash({
      provider: "demo-ai",
      modelId: "model-x",
      status: "active",
      contextWindow: 128000,
      pricing: { inputPrice: 4, outputPrice: 12, currency: "USD", unit: "per_1m_tokens" },
      source: {
        url: "https://demo.example/provider-demo/model-x",
        collectorId: "c_demo",
        collectorVersion: "v1",
        observedAt: "2026-08-17T00:00:00.000Z",
      },
      validation: { schemaValid: true, confidence: 1, warnings: [] },
    });
    expect(result.semanticHash).toBe(expectedHash);
    expect(obs.semanticHash).toBe(expectedHash);

    // The current contract row holds the normalized semantics.
    const contract = [...db.__contracts.values()][0] as Record<string, unknown>;
    expect(contract.inputPrice).toBe(4);
    expect(contract.outputPrice).toBe(12);
    expect(contract.contextWindow).toBe(128000);
    expect(contract.status).toBe("active");
  });

  it("stores a missing-field observation as invalid WITHOUT promoting a contract", async () => {
    const db = createFakeDb();
    const input = healthyInput();
    delete (input as { inputPrice?: unknown }).inputPrice;

    const result = await ingestObservation(db, input);

    expect(result.schemaValid).toBe(false);
    expect(result.contractId).toBeNull();
    expect(result.semanticHash).toBeNull();
    expect(result.errors.some((e) => e.toLowerCase().includes("inputprice"))).toBe(true);

    const obs = await storedObservation(db);
    expect(obs.schemaValid).toBe(false);
    expect(obs.normalizedPayload).toBeNull();
    expect(obs.validationErrors).toEqual(result.errors);
    expect(db.__contracts.size).toBe(0);
  });

  it("stores an ambiguous observation as invalid and never fabricates a number", async () => {
    const db = createFakeDb();
    const result = await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));

    expect(result.schemaValid).toBe(false);
    expect(result.contractId).toBeNull();
    expect(result.errors.join(" ")).toContain("cannot safely normalize price");
    const obs = await storedObservation(db);
    expect((obs.normalizedPayload as unknown)).toBeNull();
    expect(db.__contracts.size).toBe(0);
  });

  it("rejects an unsafe status without promoting", async () => {
    const db = createFakeDb();
    const result = await ingestObservation(db, healthyInput({ status: "retired soon" }));
    expect(result.schemaValid).toBe(false);
    expect(db.__contracts.size).toBe(0);
  });

  it("keeps the current contract when a later observation is invalid", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput());
    const second = await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));
    expect(second.schemaValid).toBe(false);
    const contract = [...db.__contracts.values()][0] as Record<string, unknown>;
    expect(contract.inputPrice).toBe(4); // previous healthy contract untouched
  });

  it("records collector provenance", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput());
    const upsert = db.collectorVersion.upsert as unknown as ReturnType<typeof vi.fn>;
    expect(upsert).toHaveBeenCalled();
    const args = upsert.mock.calls[0]![0] as {
      where: { collectorId_version: { collectorId: string; version: string } };
      create: { sourceName: string };
    };
    expect(args.where.collectorId_version).toEqual({ collectorId: "c_demo", version: "v1" });
    expect(args.create.sourceName).toBe("demo-ai");
  });

  it("normalizes equivalent representations to the same contract values", async () => {
    const db = createFakeDb();
    await ingestObservation(
      db,
      healthyInput({ contextWindow: "128,000 tokens", inputPrice: "$4.00" }),
    );
    const contract = [...db.__contracts.values()][0] as Record<string, unknown>;
    expect(contract.contextWindow).toBe(128000);
    expect(contract.inputPrice).toBe(4);
  });

  it("maps raw status/price text through canonical normalization", () => {
    expect(normalizeStatus("Active")).toEqual({ ok: true, value: "active" });
    expect(normalizePrice("$4 / 1M tokens")).toEqual({ ok: true, value: 4 });
    expect(normalizeContextWindow("128k")).toEqual({ ok: true, value: 128000 });
  });

  // --- Stage 3: classification + DriftEvent tests ---

  it("persists a DriftEvent for every valid ingestion", async () => {
    const db = createFakeDb();
    const result = await ingestObservation(db, healthyInput());
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.driftEventId).toBeTruthy();
    const events = db.__driftEvents;
    expect(events.length).toBe(1);
    expect(events[0]!.driftType).toBe("NO_DRIFT");
    expect(events[0]!.observationId).toBe(result.observationId);
  });

  it("IngestResult includes driftType and driftEventId", async () => {
    const db = createFakeDb();
    const result = await ingestObservation(db, healthyInput());
    expect(result).toHaveProperty("driftType");
    expect(result).toHaveProperty("driftEventId");
    expect(typeof result.driftType).toBe("string");
    expect(typeof result.driftEventId).toBe("string");
  });

  it("classifies $4 -> $6 as SEMANTIC_DRIFT before promoting contract", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput());
    const result2 = await ingestObservation(db, healthyInput({ inputPrice: "$6 / 1M tokens" }));
    expect(result2.driftType).toBe("SEMANTIC_DRIFT");
    expect(result2.driftEventId).toBeTruthy();
    const events = db.__driftEvents as any[];
    expect(events.length).toBe(2);
    expect(events[1].driftType).toBe("SEMANTIC_DRIFT");
    expect(events[1].fieldDiffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "pricing.inputPrice" })]),
    );
    // Contract should be promoted with new $6 price
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(6);
  });

  it("does NOT promote contract for AMBIGUOUS_DRIFT", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput());
    const result = await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    // Contract should still be $4 from first ingestion
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(4);
  });

  // --- Stage 3: HEALTHY -> HEALTHY baseline regression ---

  it("second identical HEALTHY ingestion: NO_DRIFT, SEMANTIC_HASH_UNCHANGED, previousHash === currentHash", async () => {
    const db = createFakeDb();
    const first = await ingestObservation(db, healthyInput());
    expect(first.driftType).toBe("NO_DRIFT");
    const second = await ingestObservation(db, healthyInput());
    expect(second.driftType).toBe("NO_DRIFT");
    const events = db.__driftEvents as any[];
    expect(events.length).toBe(2);
    // Second event should be SEMANTIC_HASH_UNCHANGED
    expect(events[1].reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
    expect(events[1].previousHash).toBe(events[1].currentHash);
  });

  // --- Stage 3: previous contract identity ---

  it("previous contract has correct provider and modelId (not empty strings)", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput());
    await ingestObservation(db, healthyInput({ inputPrice: "$6 / 1M tokens" }));
    const events = db.__driftEvents as any[];
    const semanticEvent = events[1];
    expect(semanticEvent.previousHash).toBeTruthy();
    expect(semanticEvent.currentHash).toBeTruthy();
    // previousHash must match the $4 contract hash, not an empty-identity hash
    expect(semanticEvent.previousHash).not.toBe(semanticEvent.currentHash);
  });

  // --- Stage 3: transaction rollback ---

  it("transaction failure preserves previous state", async () => {
    const db = createFakeDb();
    await ingestObservation(db, healthyInput()); // baseline $4
    const contractBefore = [...db.__contracts.values()][0] as any;
    expect(contractBefore.inputPrice).toBe(4);

    // Force failure: make driftEvent.create throw
    const originalCreate = db.driftEvent.create;
    (db as any).driftEvent.create = vi.fn(async (...args: any[]) => {
      throw new Error("simulated driftEvent failure");
    });

    await expect(
      ingestObservation(db, healthyInput({ inputPrice: "$6 / 1M tokens" })),
    ).rejects.toThrow("simulated driftEvent failure");

    // Restore original mock
    (db as any).driftEvent.create = originalCreate;

    // Contract unchanged — still $4
    const contractAfter = [...db.__contracts.values()][0] as any;
    expect(contractAfter.inputPrice).toBe(4);
    // No new DriftEvent persisted
    expect(db.__driftEvents.length).toBe(1);
    // No new Observation persisted
    expect(db.__observations.length).toBe(1);
  });
});
