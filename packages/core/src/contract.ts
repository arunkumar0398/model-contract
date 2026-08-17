export type ModelStatus = "active" | "deprecated" | "unknown";

/**
 * Stable, machine-readable contract derived from a provider documentation
 * page. `source` and `validation` are provenance/metadata; the semantic
 * fields used for drift comparison are provider, modelId, status,
 * contextWindow, inputPrice, outputPrice and deprecationDate.
 */
export type ModelContract = {
  provider: string;
  modelId: string;

  status: ModelStatus;

  contextWindow?: number;

  pricing?: {
    inputPrice?: number;
    outputPrice?: number;
    currency: "USD";
    unit: "per_1m_tokens";
  };

  deprecationDate?: string;

  source: {
    url: string;
    collectorId: string;
    collectorVersion: string;
    observedAt: string;
  };

  validation: {
    schemaValid: boolean;
    confidence: number;
    warnings: string[];
  };
};
