import {
  normalizeContextWindow,
  normalizeDate,
  normalizePrice,
  normalizeStatus,
} from "./normalize";
import { semanticHash as computeHash } from "./semantic-hash";
import { validateCandidate } from "./validate";
import type { CandidateObservation } from "./validate";
import type { ModelContract } from "./contract";

/**
 * Raw collector observation — scraped strings exactly as Bright Data
 * returned them. packages/core owns normalization; this module owns
 * the prepare (normalize → validate → hash) step.
 */
export type RawObservation = {
  provider: unknown;
  modelId: unknown;
  status: unknown;
  contextWindow?: unknown;
  inputPrice?: unknown;
  outputPrice?: unknown;
  deprecationDate?: unknown;
  sourceUrl: unknown;
  collectorId: unknown;
  collectorVersion?: unknown;
  runId?: unknown;
  observedAt: unknown;
};

export type PreparationResult = {
  candidate: CandidateObservation | null;
  schemaValid: boolean;
  unsafeFields: string[];
  missingFields: string[];
  errors: string[];
  warnings: string[];
  semanticHash: string | null;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Pure observation preparation.
 *
 * Normalizes, validates, and hashes a real RawObservation.
 * Operates ONLY on a real returned observation — does NOT handle
 * network failure, collector run failure, or timeout.
 * Collection failure belongs to application orchestration and
 * the existing recordCollectionFailure path.
 */
export function prepareObservation(raw: RawObservation): PreparationResult {
  const provider = nonEmptyString(raw.provider) ? raw.provider : "";
  const modelId = nonEmptyString(raw.modelId) ? raw.modelId : "";
  const sourceUrl = nonEmptyString(raw.sourceUrl) ? raw.sourceUrl : "";
  const collectorId = nonEmptyString(raw.collectorId) ? raw.collectorId : "";
  const collectorVersion = nonEmptyString(raw.collectorVersion)
    ? raw.collectorVersion
    : "";
  const observedAt = nonEmptyString(raw.observedAt)
    ? raw.observedAt
    : new Date().toISOString();

  // --- Normalize. Track unsafe/missing fields for classification.
  const errors: string[] = [];
  const warnings: string[] = [];
  const unsafeFields: string[] = [];
  const missingFields: string[] = [];

  const statusRes = normalizeStatus(raw.status);
  if (!statusRes.ok) errors.push(`status: ${statusRes.reason}`);

  const contextRes =
    raw.contextWindow !== undefined && raw.contextWindow !== null && raw.contextWindow !== ""
      ? normalizeContextWindow(raw.contextWindow)
      : { ok: true as const, value: undefined };
  if (!contextRes.ok) errors.push(`contextWindow: ${contextRes.reason}`);

  // inputPrice: distinguish "present but unsafe" from "absent"
  const inputRes =
    raw.inputPrice !== undefined && raw.inputPrice !== null && raw.inputPrice !== ""
      ? normalizePrice(raw.inputPrice)
      : { ok: false as const, reason: "inputPrice is missing" };
  if (!inputRes.ok) {
    errors.push(`pricing.inputPrice: ${inputRes.reason}`);
    if (raw.inputPrice !== undefined && raw.inputPrice !== null && raw.inputPrice !== "") {
      unsafeFields.push("pricing.inputPrice"); // present but unparseable
    } else {
      missingFields.push("pricing.inputPrice"); // absent
    }
  }

  const outputRes =
    raw.outputPrice !== undefined && raw.outputPrice !== null && raw.outputPrice !== ""
      ? normalizePrice(raw.outputPrice)
      : { ok: true as const, value: undefined };
  if (!outputRes.ok) errors.push(`pricing.outputPrice: ${outputRes.reason}`);

  const dateRes =
    raw.deprecationDate !== undefined && raw.deprecationDate !== null && raw.deprecationDate !== ""
      ? normalizeDate(raw.deprecationDate)
      : { ok: true as const, value: undefined };
  if (!dateRes.ok) errors.push(`deprecationDate: ${dateRes.reason}`);

  // --- Validate the normalized candidate.
  let schemaValid = false;
  let candidate: CandidateObservation | null = null;

  if (statusRes.ok && contextRes.ok && inputRes.ok && outputRes.ok && dateRes.ok) {
    candidate = {
      provider,
      modelId,
      status: statusRes.value,
      contextWindow: contextRes.value,
      pricing: {
        inputPrice: inputRes.value,
        outputPrice: outputRes.value,
        currency: "USD",
        unit: "per_1m_tokens",
      },
      deprecationDate: dateRes.value,
      source: {
        url: sourceUrl,
        collectorId,
        collectorVersion,
        observedAt,
      },
      confidence: 0.99,
    };
    const validation = validateCandidate(candidate);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
    schemaValid = errors.length === 0;
  }

  const hash =
    candidate && schemaValid ? computeHash(candidate as ModelContract) : null;

  return {
    candidate,
    schemaValid,
    unsafeFields,
    missingFields,
    errors,
    warnings,
    semanticHash: hash,
  };
}
