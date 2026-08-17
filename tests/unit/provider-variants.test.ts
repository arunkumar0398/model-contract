import { describe, expect, it } from "vitest";
import {
  normalizePrice,
  semanticHash,
  validateCandidate,
  type CandidateObservation,
} from "@modelcontract/core";
import { demoVariants, resolveVariantId } from "../../fixtures/provider-demo/shared";
import { contractFromVariant } from "../helpers/contract-from-variant";

const SOURCE = {
  url: "https://demo.example/provider-demo/model-x",
  collectorId: "demo-collector",
  collectorVersion: "v1",
  observedAt: "2026-08-17T00:00:00.000Z",
};

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
    const healthy = contractFromVariant(demoVariants.HEALTHY);
    const broken = contractFromVariant(demoVariants.BROKEN_SELECTOR);
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
    const healthy = contractFromVariant(demoVariants.HEALTHY)!;
    const priced = contractFromVariant(changed)!;
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
    const contract = contractFromVariant(deprecated)!;
    expect(contract.status).toBe("deprecated");
    expect(contract.pricing?.inputPrice).toBe(4);
    expect(semanticHash(contract)).not.toBe(semanticHash(contractFromVariant(demoVariants.HEALTHY)!));
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
    expect(contractFromVariant(variant)).toBeNull();
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
