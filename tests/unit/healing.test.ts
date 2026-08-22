import { describe, expect, it } from "vitest";
import {
  isHealingEligible,
  verifyRepairCandidate,
  allowedHealthTransition,
  isReasonCode,
  type HealthState,
} from "../../packages/core/src/healing";

describe("RETRY_EXHAUSTED reason code", () => {
  it("RETRY_EXHAUSTED is a valid ReasonCode", () => {
    expect(isReasonCode("RETRY_EXHAUSTED")).toBe(true);
  });

  it("existing Stage 3 reason codes remain accepted", () => {
    expect(isReasonCode("BASELINE_ESTABLISHED")).toBe(true);
    expect(isReasonCode("SEMANTIC_HASH_UNCHANGED")).toBe(true);
    expect(isReasonCode("SEMANTIC_FIELD_CHANGED")).toBe(true);
    expect(isReasonCode("REQUIRED_FIELD_MISSING")).toBe(true);
    expect(isReasonCode("UNSAFE_VALUE")).toBe(true);
    expect(isReasonCode("COLLECTION_FAILED")).toBe(true);
    expect(isReasonCode("EXTRACTION_VALIDATION_FAILED")).toBe(true);
  });

  it("random string is not a valid ReasonCode", () => {
    expect(isReasonCode("NOT_A_REASON")).toBe(false);
  });
});

describe("isHealingEligible", () => {
  it("EXTRACTION_DRIFT + RETRY_EXHAUSTED → true", () => {
    expect(
      isHealingEligible({
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["EXTRACTION_VALIDATION_FAILED", "RETRY_EXHAUSTED"],
      }),
    ).toBe(true);
  });

  it("EXTRACTION_DRIFT without RETRY_EXHAUSTED → false", () => {
    expect(
      isHealingEligible({
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: ["EXTRACTION_VALIDATION_FAILED"],
      }),
    ).toBe(false);
  });

  it("EXTRACTION_DRIFT with empty reasonCodes → false", () => {
    expect(
      isHealingEligible({
        driftType: "EXTRACTION_DRIFT",
        reasonCodes: [],
      }),
    ).toBe(false);
  });

  it("SEMANTIC_DRIFT → false", () => {
    expect(
      isHealingEligible({
        driftType: "SEMANTIC_DRIFT",
        reasonCodes: ["SEMANTIC_FIELD_CHANGED"],
      }),
    ).toBe(false);
  });

  it("AMBIGUOUS_DRIFT → false", () => {
    expect(
      isHealingEligible({
        driftType: "AMBIGUOUS_DRIFT",
        reasonCodes: ["UNSAFE_VALUE"],
      }),
    ).toBe(false);
  });

  it("TRANSIENT_FAILURE → false", () => {
    expect(
      isHealingEligible({
        driftType: "TRANSIENT_FAILURE",
        reasonCodes: ["COLLECTION_FAILED"],
      }),
    ).toBe(false);
  });

  it("NO_DRIFT → false", () => {
    expect(
      isHealingEligible({
        driftType: "NO_DRIFT",
        reasonCodes: ["SEMANTIC_HASH_UNCHANGED"],
      }),
    ).toBe(false);
  });
});

describe("verifyRepairCandidate", () => {
  it("same hashes → true", () => {
    expect(verifyRepairCandidate("81ac4862", "81ac4862")).toBe(true);
  });

  it("different hashes → false", () => {
    expect(verifyRepairCandidate("81ac4862", "f3d45ec4")).toBe(false);
  });
});

describe("allowedHealthTransition", () => {
  const validTransitions: [HealthState, HealthState][] = [
    ["HEALTHY", "QUARANTINED"],
    ["QUARANTINED", "HEALTHY"],
    ["QUARANTINED", "FAILED"],
  ];

  for (const [from, to] of validTransitions) {
    it(`${from} → ${to} is valid`, () => {
      expect(allowedHealthTransition(from, to)).toBe(true);
    });
  }

  const invalidTransitions: [HealthState, HealthState][] = [
    ["HEALTHY", "HEALTHY"],
    ["HEALTHY", "FAILED"],
    ["QUARANTINED", "QUARANTINED"],
    ["FAILED", "HEALTHY"],
    ["FAILED", "QUARANTINED"],
    ["FAILED", "FAILED"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`${from} → ${to} is invalid`, () => {
      expect(allowedHealthTransition(from, to)).toBe(false);
    });
  }
});
