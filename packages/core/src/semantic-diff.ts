import type { SemanticFields } from "./semantic-hash";

export type SemanticFieldDiff = {
  /** Dotted ModelContract path: "provider", "modelId", "status", "contextWindow",
   *  "pricing.inputPrice", "pricing.outputPrice", "deprecationDate". */
  field: string;
  previous: unknown;
  current: unknown;
};

const CANONICAL_DIFF_FIELDS: readonly { key: keyof SemanticFields; path: string }[] = [
  { key: "provider", path: "provider" },
  { key: "modelId", path: "modelId" },
  { key: "status", path: "status" },
  { key: "contextWindow", path: "contextWindow" },
  { key: "inputPrice", path: "pricing.inputPrice" },
  { key: "outputPrice", path: "pricing.outputPrice" },
  { key: "deprecationDate", path: "deprecationDate" },
] as const;

/**
 * Deterministic field-level diff between two semantic field sets.
 * Uses dotted ModelContract paths in output.
 * Provenance excluded (SemanticFields already excludes it).
 * Invalid extractions: semanticDiff is never called; classifier sets fieldDiffs = [].
 */
export function semanticDiff(
  previous: SemanticFields,
  current: SemanticFields,
): SemanticFieldDiff[] {
  const diffs: SemanticFieldDiff[] = [];
  for (const { key, path } of CANONICAL_DIFF_FIELDS) {
    const prev = previous[key];
    const curr = current[key];
    if (prev !== curr) {
      diffs.push({ field: path, previous: prev ?? null, current: curr ?? null });
    }
  }
  return diffs;
}
