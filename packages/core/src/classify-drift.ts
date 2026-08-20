import type { ModelContract } from "./contract";
import type { CandidateObservation } from "./validate";
import type { DriftType, ReasonCode } from "./drift";
import type { SemanticFieldDiff } from "./semantic-diff";
import { extractSemanticFields, semanticHash, semanticHashOf } from "./semantic-hash";
import { semanticDiff } from "./semantic-diff";

/** Compute semantic hash from CandidateObservation (no validation field needed). */
function candidateHash(c: CandidateObservation): string {
  return semanticHashOf(extractSemanticFields(c as any));
}

export type ObservationEvidence = {
  /** Collection run itself failed (network, timeout, 5xx). No extraction data exists. */
  collectionFailed: boolean;
  /** Retry policy exhausted. Context only — does not determine drift type. */
  retryExhausted: boolean;
  /** Whether the normalized candidate passed schema validation. */
  schemaValid: boolean;
  /**
   * Fields that WERE PRESENT in the raw observation but could NOT be safely
   * normalized (e.g., inputPrice = "Contact sales").
   * Field names use dotted ModelContract paths: "pricing.inputPrice".
   */
  unsafeFields: string[];
  /**
   * Required fields that were ABSENT from the raw observation
   * (e.g., selector broke, element removed).
   */
  missingFields: string[];
  /** Raw validation errors from validateCandidate (when candidate was built). */
  validationErrors: string[];
};

export type DriftInput = {
  /** Previous healthy contract, or null if first observation for this model. */
  previousContract: ModelContract | null;
  /**
   * The normalized candidate. Built only when ALL normalizations succeed.
   * Null when normalization failed (unsafe value or missing field) or
   * when collection failed entirely.
   */
  candidate: CandidateObservation | null;
  /** Evidence from the ingestion pipeline. */
  evidence: ObservationEvidence;
};

export type DriftDecision = {
  driftType: DriftType;
  /** Machine-readable reason codes. Stable across stages. */
  reasonCodes: ReasonCode[];
  /** Human-readable explanations for debugging/demo. */
  explanations: string[];
  /** Field-level diffs. Populated ONLY for SEMANTIC_DRIFT. Empty array otherwise. */
  fieldDiffs: SemanticFieldDiff[];
  /** Semantic hash of the previous contract (null if first observation). */
  previousHash: string | null;
  /** Semantic hash of the new candidate (null if candidate is null). */
  currentHash: string | null;
};

/**
 * Pure drift classifier. Evaluates classification precedence exactly as
 * specified in the frozen design spec (steps 1-7). The first match wins.
 *
 * Critical invariant: EXTRACTION_DRIFT != SEMANTIC_DRIFT.
 * A broken extraction that yields null/missing fields is NEVER classified
 * as a semantic price change.
 */
export function classifyDrift(input: DriftInput): DriftDecision {
  const { previousContract, candidate, evidence } = input;
  const previousHash = previousContract ? semanticHash(previousContract) : null;
  const currentHash = candidate ? candidateHash(candidate) : null;

  // Step 1: collection failure — no extraction data exists
  if (evidence.collectionFailed) {
    return {
      driftType: "TRANSIENT_FAILURE",
      reasonCodes: ["COLLECTION_FAILED"],
      explanations: ["collection run failed — network or timeout error"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 2: unsafe values — field present but unparseable (e.g., "Contact sales")
  if (evidence.unsafeFields.length > 0) {
    return {
      driftType: "AMBIGUOUS_DRIFT",
      reasonCodes: ["UNSAFE_VALUE"],
      explanations: evidence.unsafeFields.map((f) => `${f} has unparseable value`),
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 3: missing fields — field absent from extraction (broken selector)
  if (evidence.missingFields.length > 0) {
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["REQUIRED_FIELD_MISSING"],
      explanations: evidence.missingFields.map((f) => `${f} is missing from extraction`),
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 4: validation failure on normalized data
  if (!evidence.schemaValid) {
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["EXTRACTION_VALIDATION_FAILED"],
      explanations:
        evidence.validationErrors.length > 0
          ? evidence.validationErrors
          : ["schema validation failed"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Steps 5-7: valid candidate — compare semantic hashes
  if (!candidate) {
    // Defensive: should not reach here if evidence is consistent
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["EXTRACTION_VALIDATION_FAILED"],
      explanations: ["candidate is null despite schemaValid=true"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 5: first observation (baseline)
  if (previousContract === null) {
    return {
      driftType: "NO_DRIFT",
      reasonCodes: ["BASELINE_ESTABLISHED"],
      explanations: ["first observation — baseline contract established"],
      fieldDiffs: [],
      previousHash: null,
      currentHash,
    };
  }

  const previousFields = extractSemanticFields(previousContract);
  const currentFields = extractSemanticFields(candidate as any);

  // Step 6: same semantic hash
  if (previousHash === currentHash) {
    return {
      driftType: "NO_DRIFT",
      reasonCodes: ["SEMANTIC_HASH_UNCHANGED"],
      explanations: ["semantic hash unchanged — only provenance changed"],
      fieldDiffs: [],
      previousHash,
      currentHash,
    };
  }

  // Step 7: different semantic values
  const diffs = semanticDiff(previousFields, currentFields);
  const explanations = diffs.map(
    (d) => `${d.field} changed: ${JSON.stringify(d.previous)} → ${JSON.stringify(d.current)}`,
  );

  return {
    driftType: "SEMANTIC_DRIFT",
    reasonCodes: ["SEMANTIC_FIELD_CHANGED"],
    explanations,
    fieldDiffs: diffs,
    previousHash,
    currentHash,
  };
}
