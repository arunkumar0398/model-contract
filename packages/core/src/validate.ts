import type { ModelStatus } from "./contract";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * A normalized observation candidate — raw scraped values that already
 * passed normalization. Stage 3's classifier consumes this shape.
 */
export type CandidateObservation = {
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
  confidence?: number;
};

/**
 * Low-level structural validation. Returns errors/warnings instead of
 * throwing — invalid scraped input is a normal condition, not an exception.
 */
export function validateCandidate(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input === null || typeof input !== "object") {
    errors.push("observation must be an object");
    return { ok: false, errors, warnings };
  }
  const c = input as Record<string, unknown>;

  if (typeof c.provider !== "string" || c.provider.trim() === "") {
    errors.push("provider must be a non-empty string");
  }

  if (typeof c.modelId !== "string" || c.modelId.trim() === "") {
    errors.push("modelId must be a non-empty string");
  }

  const status = c.status;
  if (status !== "active" && status !== "deprecated" && status !== "unknown") {
    errors.push("status must be one of: active, deprecated, unknown");
  }

  if (c.contextWindow !== undefined) {
    if (typeof c.contextWindow !== "number" || !Number.isFinite(c.contextWindow)) {
      errors.push("contextWindow must be a finite number");
    } else if (c.contextWindow <= 0) {
      errors.push("contextWindow must be positive");
    }
  }

  if (c.pricing !== undefined) {
    if (c.pricing === null || typeof c.pricing !== "object") {
      errors.push("pricing must be an object");
    } else {
      const p = c.pricing as Record<string, unknown>;
      if (p.currency !== "USD") {
        errors.push("pricing.currency must be 'USD'");
      }
      if (p.unit !== "per_1m_tokens") {
        errors.push("pricing.unit must be 'per_1m_tokens'");
      }
      if (p.inputPrice === undefined) {
        errors.push("pricing.inputPrice is required when pricing is present");
      } else if (typeof p.inputPrice !== "number" || !Number.isFinite(p.inputPrice)) {
        errors.push("pricing.inputPrice must be a finite number");
      } else if (p.inputPrice < 0) {
        errors.push("pricing.inputPrice must be non-negative");
      }
      if (p.outputPrice !== undefined) {
        if (typeof p.outputPrice !== "number" || !Number.isFinite(p.outputPrice)) {
          errors.push("pricing.outputPrice must be a finite number");
        } else if (p.outputPrice < 0) {
          errors.push("pricing.outputPrice must be non-negative");
        }
      } else {
        warnings.push("pricing.outputPrice is missing");
      }
    }
  }

  if (c.deprecationDate !== undefined) {
    if (typeof c.deprecationDate !== "string") {
      errors.push("deprecationDate must be a string");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(c.deprecationDate)) {
      errors.push("deprecationDate must be an ISO date (yyyy-mm-dd)");
    }
  }

  if (status === "active" && typeof c.deprecationDate === "string") {
    warnings.push("deprecationDate present but status is 'active'");
  }

  const src = c.source;
  if (src === null || typeof src !== "object") {
    errors.push("source must be an object");
  } else {
    const s = src as Record<string, unknown>;
    if (typeof s.url !== "string" || s.url.trim() === "") {
      errors.push("source.url is required");
    }
    if (typeof s.collectorId !== "string" || s.collectorId.trim() === "") {
      errors.push("source.collectorId is required");
    }
    if (typeof s.collectorVersion !== "string" || s.collectorVersion.trim() === "") {
      errors.push("source.collectorVersion is required");
    }
    if (typeof s.observedAt !== "string" || s.observedAt.trim() === "") {
      errors.push("source.observedAt is required");
    }
  }

  if (c.confidence !== undefined) {
    if (typeof c.confidence !== "number" || !Number.isFinite(c.confidence)) {
      errors.push("confidence must be a finite number");
    } else if (c.confidence < 0 || c.confidence > 1) {
      errors.push("confidence must be between 0 and 1");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
