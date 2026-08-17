import type { ModelContract } from "./contract";

/**
 * Semantic fields only. Provenance (source url, collector id/version,
 * observedAt) and validation metadata are deliberately excluded — they are
 * provenance, not model semantics.
 */
export type SemanticFields = {
  provider: string;
  modelId: string;
  status: string;
  contextWindow?: number;
  inputPrice?: number;
  outputPrice?: number;
  deprecationDate?: string;
};

export function extractSemanticFields(contract: ModelContract): SemanticFields {
  return {
    provider: contract.provider,
    modelId: contract.modelId,
    status: contract.status,
    contextWindow: contract.contextWindow,
    inputPrice: contract.pricing?.inputPrice,
    outputPrice: contract.pricing?.outputPrice,
    deprecationDate: contract.deprecationDate,
  };
}

export function semanticHash(contract: ModelContract): string {
  return semanticHashOf(extractSemanticFields(contract));
}

/** Deterministic 32-bit FNV-1a hash over canonicalized semantic fields. */
export function semanticHashOf(fields: SemanticFields): string {
  const ordered: Record<string, unknown> = {};
  for (const key of [
    "provider",
    "modelId",
    "status",
    "contextWindow",
    "inputPrice",
    "outputPrice",
    "deprecationDate",
  ] as const) {
    const value = fields[key];
    if (value !== undefined) ordered[key] = value;
  }
  return fnv1a(JSON.stringify(ordered));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
