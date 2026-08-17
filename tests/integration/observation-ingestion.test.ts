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
});
