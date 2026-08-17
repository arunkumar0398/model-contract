import { ambiguousVariant } from "./ambiguous";
import { brokenSelectorVariant } from "./broken-selector";
import { changedPriceVariant } from "./changed-price";
import { deprecatedVariant } from "./deprecated";
import { healthyVariant } from "./healthy";
import { missingFieldVariant } from "./missing-field";

export type DemoVariantId =
  | "HEALTHY"
  | "BROKEN_SELECTOR"
  | "CHANGED_PRICE"
  | "MISSING_FIELD"
  | "DEPRECATED"
  | "AMBIGUOUS";

export type DemoSemantics = {
  modelId: string;
  /** Raw status text exactly as displayed in the HTML. */
  status: string;
  /** Raw context-window text exactly as displayed in the HTML. */
  contextWindow: string;
  /** Raw input-price text, or null when the element is removed. */
  inputPrice: string | null;
  outputPrice: string | null;
};

export type DemoVariant = {
  id: DemoVariantId;
  label: string;
  /** Raw semantic values as displayed in the rendered HTML. */
  semantics: DemoSemantics;
  /**
   * HTML fragment rendered by /provider-demo/model-x. The stable scrape
   * target: selectors must survive across variants (or be intentionally
   * broken, for BROKEN_SELECTOR).
   */
  html: string;
};

export const DEMO_VARIANT_IDS: readonly DemoVariantId[] = [
  "HEALTHY",
  "BROKEN_SELECTOR",
  "CHANGED_PRICE",
  "MISSING_FIELD",
  "DEPRECATED",
  "AMBIGUOUS",
] as const;

export const demoVariants: Record<DemoVariantId, DemoVariant> = {
  HEALTHY: healthyVariant,
  BROKEN_SELECTOR: brokenSelectorVariant,
  CHANGED_PRICE: changedPriceVariant,
  MISSING_FIELD: missingFieldVariant,
  DEPRECATED: deprecatedVariant,
  AMBIGUOUS: ambiguousVariant,
};

/**
 * Deterministic variant resolution for the stable /provider-demo/model-x URL.
 * Accepts canonical ids ("BROKEN_SELECTOR") and kebab-case ("broken-selector"),
 * case-insensitively; anything else falls back to HEALTHY.
 */
export function resolveVariantId(raw: string | null | undefined): DemoVariantId {
  const normalized = raw?.trim().toUpperCase().replace(/-/g, "_") ?? "";
  if ((DEMO_VARIANT_IDS as readonly string[]).includes(normalized)) {
    return normalized as DemoVariantId;
  }
  return "HEALTHY";
}
