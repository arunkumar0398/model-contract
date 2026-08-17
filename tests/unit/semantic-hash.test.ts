import { describe, expect, it } from "vitest";
import {
  extractSemanticFields,
  normalizeContextWindow,
  normalizePrice,
  semanticHash,
  type ModelContract,
} from "@modelcontract/core";

function contract(overrides: Partial<ModelContract> = {}): ModelContract {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "active",
    contextWindow: 128000,
    pricing: {
      inputPrice: 4,
      outputPrice: 12,
      currency: "USD",
      unit: "per_1m_tokens",
    },
    source: {
      url: "https://demo.example/model-x",
      collectorId: "col-1",
      collectorVersion: "v1",
      observedAt: "2026-08-17T00:00:00.000Z",
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
    ...overrides,
  };
}

describe("semantic hash", () => {
  it("is deterministic for identical contracts", () => {
    const a = contract();
    const b = contract();
    expect(semanticHash(a)).toBe(semanticHash(b));
    expect(semanticHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('yields the same hash for "$4" and "$4.00" (same normalized price)', () => {
    const from4 = normalizePrice("$4");
    const from400 = normalizePrice("$4.00");
    expect(from4).toEqual({ ok: true, value: 4 });
    expect(from400).toEqual({ ok: true, value: 4 });
    if (!from4.ok || !from400.ok) throw new Error("expected prices to normalize");
    const a = contract({ pricing: { ...contract().pricing!, inputPrice: from4.value } });
    const b = contract({ pricing: { ...contract().pricing!, inputPrice: from400.value } });
    expect(semanticHash(a)).toBe(semanticHash(b));
  });

  it('yields the same hash for "128k" and "128,000 tokens"', () => {
    const a = normalizeContextWindow("128k");
    const b = normalizeContextWindow("128,000 tokens");
    expect(a).toEqual({ ok: true, value: 128000 });
    expect(b).toEqual({ ok: true, value: 128000 });
    if (!a.ok || !b.ok) throw new Error("expected context windows to normalize");
    expect(semanticHash(contract({ contextWindow: a.value }))).toBe(
      semanticHash(contract({ contextWindow: b.value })),
    );
  });

  it("differs when the input price changes ($4 vs $6)", () => {
    const four = contract();
    const six = contract({
      pricing: { ...contract().pricing!, inputPrice: 6 },
    });
    expect(semanticHash(four)).not.toBe(semanticHash(six));
  });

  it("differs when status changes (active vs deprecated)", () => {
    const active = contract();
    const deprecated = contract({ status: "deprecated" });
    expect(semanticHash(active)).not.toBe(semanticHash(deprecated));
  });

  it("ignores provenance: source url, collector id/version, and observedAt", () => {
    const a = contract();
    const b = contract({
      source: {
        url: "https://other.example/elsewhere",
        collectorId: "col-999",
        collectorVersion: "v42",
        observedAt: "2031-01-01T00:00:00.000Z",
      },
    });
    expect(semanticHash(a)).toBe(semanticHash(b));
  });

  it("ignores validation metadata", () => {
    const a = contract();
    const b = contract({ validation: { schemaValid: false, confidence: 0.1, warnings: ["x"] } });
    expect(semanticHash(a)).toBe(semanticHash(b));
  });

  it("extracts only semantic fields", () => {
    const fields = extractSemanticFields(contract());
    expect(fields).toEqual({
      provider: "demo-ai",
      modelId: "model-x",
      status: "active",
      contextWindow: 128000,
      inputPrice: 4,
      outputPrice: 12,
      deprecationDate: undefined,
    });
  });
});
