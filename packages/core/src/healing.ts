import type { DriftType, ReasonCode, HealthState } from "./drift";

export type { HealthState } from "./drift";

/**
 * Type guard: is the given string a valid ReasonCode?
 */
export function isReasonCode(value: string): value is ReasonCode {
  const valid: ReasonCode[] = [
    "BASELINE_ESTABLISHED",
    "SEMANTIC_HASH_UNCHANGED",
    "SEMANTIC_FIELD_CHANGED",
    "REQUIRED_FIELD_MISSING",
    "UNSAFE_VALUE",
    "COLLECTION_FAILED",
    "EXTRACTION_VALIDATION_FAILED",
    "RETRY_EXHAUSTED",
  ];
  return valid.includes(value as ReasonCode);
}

/**
 * Is this drift event eligible for healing?
 *
 * Requires BOTH:
 * - driftType === EXTRACTION_DRIFT
 * - reasonCodes contains RETRY_EXHAUSTED
 *
 * Single extraction failures are NOT healing-eligible.
 */
export function isHealingEligible(input: {
  driftType: DriftType;
  reasonCodes: ReasonCode[];
}): boolean {
  return (
    input.driftType === "EXTRACTION_DRIFT" &&
    input.reasonCodes.includes("RETRY_EXHAUSTED")
  );
}

/**
 * Verify that a repair candidate preserves the semantic invariant.
 *
 * For extraction-only repair:
 * semanticHash(beforeBreak) === semanticHash(afterCandidateRepair)
 */
export function verifyRepairCandidate(
  previousHash: string,
  candidateHash: string,
): boolean {
  return previousHash === candidateHash;
}

/**
 * Allowed health-state transitions.
 *
 * Real observable transitions:
 *   HEALTHY → QUARANTINED  (extraction drift + retry exhausted)
 *   QUARANTINED → HEALTHY  (repair approved)
 *   QUARANTINED → FAILED   (repair rejected)
 *
 * HEALING, AWAITING_APPROVAL, VERIFIED are UI-mediated states
 * with no system event — not modeled here.
 */
const VALID_TRANSITIONS: Record<string, HealthState[]> = {
  HEALTHY: ["QUARANTINED"],
  QUARANTINED: ["HEALTHY", "FAILED"],
  FAILED: [],
};

export function allowedHealthTransition(
  from: HealthState,
  to: HealthState,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}
