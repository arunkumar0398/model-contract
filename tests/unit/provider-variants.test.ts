import { describe, expect, it } from "vitest";
import {
  normalizeContextWindow,
  normalizePrice,
  normalizeStatus,
  semanticHash,
  validateCandidate,
  type CandidateObservation,
  type ModelContract,
} from "@modelcontract/core";
import {
  demoVariants,
  resolveVariantId,
  type DemoVariant,
} from "../../fixtures/provider-demo/shared";

const SOURCE = {
  url: "https://demo.example/provider-demo/model-x",
  collectorId: "demo-collector",
  collectorVersion: "v1",
  observedAt: "2026-08-17T00:00:00.000Z",
};

/** Normalize a fixture variant into a full ModelContract, or null when its
 *  raw semantics cannot be safely normalized (AMBIGUOUS / MISSING_FIELD). */
function fullyNormalizedContract(variant: DemoVariant): ModelContract | null {
  const context = normalizeContextWindow(variant.semantics.contextWindow);
  const status = normalizeStatus(variant.semantics.status);
  if (!context.ok || !status.ok) return null;

  const input =
    variant.semantics.inputPrice === null ? undefined : normalizePrice(variant.semantics.inputPrice);
  const output =
    variant.semantics.outputPrice === null ? undefined : normalizePrice(variant.semantics.outputPrice);
  if (variant.semantics.inputPrice !== null && input && !input.ok) return null;
  if (variant.semantics.outputPrice !== null && output && !output.ok) return null;

  return {
    provider: "demo-ai",
    modelId: variant.semantics.modelId,
    status: status.value,
    contextWindow: context.value,
    pricing: {
      inputPrice: input?.ok ? input.value : undefined,
      outputPrice: output?.ok ? output.value : undefined,
      currency: "USD",
      unit: "per_1m_tokens",
    },
    source: SOURCE,
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };
}

describe("provider demo variants (fixtures)", () => {
  it("exposes all six variants with unique ids and non-empty markup", () => {
    const ids = Object.values(demoVariants).map((v) => v.id);
    expect(new Set(ids).size).toBe(6);
    for (const id of [
      "HEALTHY",
      "BROKEN_SELECTOR",
      "CHANGED_PRICE",
      "MISSING_FIELD",
      "DEPRECATED",
      "AMBIGUOUS",
    ]) {
      const variant = demoVariants[id as keyof typeof demoVariants];
      expect(variant, id).toBeDefined();
      expect(variant.html.length, `${id} html`).toBeGreaterThan(0);
    }
  });

  it("HEALTHY and BROKEN_SELECTOR have identical semantic values", () => {
    const healthy = fullyNormalizedContract(demoVariants.HEALTHY);
    const broken = fullyNormalizedContract(demoVariants.BROKEN_SELECTOR);
    expect(healthy).not.toBeNull();
    expect(broken).not.toBeNull();
    expect(healthy!.status).toBe(broken!.status);
    expect(healthy!.contextWindow).toBe(broken!.contextWindow);
    expect(healthy!.pricing).toEqual(broken!.pricing);
    expect(semanticHash(healthy!)).toBe(semanticHash(broken!));
  });

  it("BROKEN_SELECTOR restructures markup without changing semantics", () => {
    expect(demoVariants.BROKEN_SELECTOR.html).not.toBe(demoVariants.HEALTHY.html);
    expect(demoVariants.HEALTHY.html).toContain('id="input-price"');
    expect(demoVariants.BROKEN_SELECTOR.html).not.toContain('id="input-price"');
    expect(demoVariants.BROKEN_SELECTOR.html).not.toContain("model-card");
  });

  it("CHANGED_PRICE keeps HEALTHY structure and changes only the price", () => {
    const changed = demoVariants.CHANGED_PRICE;
    expect(changed.html).toContain('id="input-price"');
    expect(changed.html).toContain("$6 / 1M tokens");
    expect(changed.html.replace("$6 / 1M tokens", "$4 / 1M tokens")).toBe(
      demoVariants.HEALTHY.html,
    );
    const healthy = fullyNormalizedContract(demoVariants.HEALTHY)!;
    const priced = fullyNormalizedContract(changed)!;
    expect(healthy.pricing?.inputPrice).toBe(4);
    expect(priced.pricing?.inputPrice).toBe(6);
    expect(priced.status).toBe(healthy.status);
    expect(priced.contextWindow).toBe(healthy.contextWindow);
    expect(semanticHash(healthy)).not.toBe(semanticHash(priced));
  });

  it("DEPRECATED keeps structure and changes only the status", () => {
    const deprecated = demoVariants.DEPRECATED;
    expect(deprecated.html).toContain('id="model-status"');
    expect(deprecated.html.replace("Deprecated", "Active")).toBe(demoVariants.HEALTHY.html);
    const contract = fullyNormalizedContract(deprecated)!;
    expect(contract.status).toBe("deprecated");
    expect(contract.pricing?.inputPrice).toBe(4);
    expect(semanticHash(contract)).not.toBe(semanticHash(fullyNormalizedContract(demoVariants.HEALTHY)!));
  });

  it("MISSING_FIELD yields a schema-invalid candidate (no silent numeric guess)", () => {
    const variant = demoVariants.MISSING_FIELD;
    expect(variant.semantics.inputPrice).toBeNull();
    expect(variant.html).not.toContain("spec-input-price");

    const candidate: CandidateObservation = {
      provider: "demo-ai",
      modelId: variant.semantics.modelId,
      status: "active",
      contextWindow: 128000,
      pricing: {
        inputPrice: undefined,
        outputPrice: 12,
        currency: "USD",
        unit: "per_1m_tokens",
      },
      source: SOURCE,
    };
    const result = validateCandidate(candidate);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("inputPrice"))).toBe(true);
  });

  it("AMBIGUOUS does not silently normalize 'Contact sales' into a number", () => {
    const variant = demoVariants.AMBIGUOUS;
    expect(variant.semantics.inputPrice).toBe("Contact sales");
    expect(variant.html).toContain("Contact sales");
    const result = normalizePrice("Contact sales");
    expect(result.ok).toBe(false);
    expect(fullyNormalizedContract(variant)).toBeNull();
  });

  it("resolveVariantId is deterministic and falls back to HEALTHY", () => {
    expect(resolveVariantId(undefined)).toBe("HEALTHY");
    expect(resolveVariantId("")).toBe("HEALTHY");
    expect(resolveVariantId("healthy")).toBe("HEALTHY");
    expect(resolveVariantId("broken-selector")).toBe("BROKEN_SELECTOR");
    expect(resolveVariantId("BROKEN_SELECTOR")).toBe("BROKEN_SELECTOR");
    expect(resolveVariantId("not-a-variant")).toBe("HEALTHY");
  });
});
