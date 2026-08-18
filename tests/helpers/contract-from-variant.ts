import {
  normalizeContextWindow,
  normalizePrice,
  normalizeStatus,
  type ModelContract,
} from "@modelcontract/core";
import type { DemoVariant } from "../../fixtures/provider-demo/shared";

const SOURCE = {
  url: "https://demo.example/provider-demo/model-x",
  collectorId: "demo-collector",
  collectorVersion: "v1",
  observedAt: "2026-08-17T00:00:00.000Z",
};

/** Normalize a fixture variant into a full ModelContract, or null when its
 *  raw semantics cannot be safely normalized (AMBIGUOUS / MISSING_FIELD). */
export function contractFromVariant(variant: DemoVariant): ModelContract | null {
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
