export type DriftType =
  | "NO_DRIFT"
  | "TRANSIENT_FAILURE"
  | "EXTRACTION_DRIFT"
  | "SEMANTIC_DRIFT"
  | "AMBIGUOUS_DRIFT";

export type HealthState =
  | "HEALTHY"
  | "SUSPECT"
  | "QUARANTINED"
  | "HEALING"
  | "AWAITING_APPROVAL"
  | "VERIFIED"
  | "FAILED";
