import { isHealingEligible, verifyRepairCandidate } from "@modelcontract/core";
import type { PrismaClient } from "@modelcontract/db";

/** JSON-safe payload (strips undefined so Prisma Json columns accept it). */
function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Healing orchestration — quarantine, repair verification, approve/reject.
 *
 * This module owns the application-level workflow around extraction-drift
 * recovery. It does NOT own Bright Data interaction or pure domain logic.
 */

/** Structural subset of PrismaClient the healing pipeline uses. */
export type HealingDb = Pick<
  PrismaClient,
  "model" | "driftEvent" | "healAttempt" | "$transaction"
>;

export type HealingContext = {
  driftEventId: string;
  modelRecordId: string;
  previousCollectorId: string;
  previousHash: string | null;
  driftType: string;
  reasonCodes: string[];
};

export type QuarantineResult = {
  quarantined: boolean;
  healAttempt: {
    id: string;
    driftEventId: string;
    modelRecordId: string;
    previousCollectorId: string | null;
    previousHash: string | null;
    candidateRunId: string | null;
    candidateOutput: unknown;
    candidateHash: string | null;
    candidateSchemaValid: boolean | null;
    semanticMatch: boolean | null;
    status: string;
    failureReason: string | null;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
};

/**
 * Quarantine extraction drift when healing eligibility is satisfied.
 *
 * Requires BOTH:
 * - driftType === "EXTRACTION_DRIFT"
 * - reasonCodes includes "RETRY_EXHAUSTED"
 *
 * If eligible:
 * - Model.healthState → QUARANTINED (via SUSPECT)
 * - HealAttempt created with only quarantine-time evidence
 *
 * If not eligible:
 * - No state change, no HealAttempt
 */
export async function quarantineExtractionDrift(
  db: HealingDb,
  ctx: HealingContext,
): Promise<QuarantineResult> {
  const eligible = isHealingEligible({
    driftType: ctx.driftType as import("@modelcontract/core").DriftType,
    reasonCodes: ctx.reasonCodes as import("@modelcontract/core").ReasonCode[],
  });

  if (!eligible) {
    return { quarantined: false, healAttempt: null };
  }

  // Quarantine in a transaction
  const result = await db.$transaction(async (tx) => {
    // Update model health state
    const updatedModel = await tx.model.update({
      where: { id: ctx.modelRecordId },
      data: { healthState: "QUARANTINED" },
    });

    // Create HealAttempt with quarantine-time evidence only
    const healAttempt = await tx.healAttempt.create({
      data: {
        driftEventId: ctx.driftEventId,
        modelRecordId: ctx.modelRecordId,
        previousCollectorId: ctx.previousCollectorId,
        previousHash: ctx.previousHash,
        status: "pending",
      },
    });

    return { model: updatedModel, healAttempt };
  });

  return {
    quarantined: true,
    healAttempt: {
      id: result.healAttempt.id,
      driftEventId: result.healAttempt.driftEventId,
      modelRecordId: result.healAttempt.modelRecordId,
      previousCollectorId: result.healAttempt.previousCollectorId,
      previousHash: result.healAttempt.previousHash,
      candidateRunId: result.healAttempt.candidateRunId,
      candidateOutput: result.healAttempt.candidateOutput,
      candidateHash: result.healAttempt.candidateHash,
      candidateSchemaValid: result.healAttempt.candidateSchemaValid,
      semanticMatch: result.healAttempt.semanticMatch,
      status: result.healAttempt.status,
      failureReason: result.healAttempt.failureReason,
      createdAt: result.healAttempt.createdAt,
      completedAt: result.healAttempt.completedAt,
    },
  };
}

export type VerifyRepairInput = {
  healAttemptId: string;
  modelRecordId: string;
  previousHash: string;
  candidateRunId: string;
  candidateOutput: Record<string, unknown>[];
  candidateHash: string | null;
  candidateSchemaValid: boolean;
};

export type VerifyRepairResult = {
  approved: boolean;
  semanticMatch: boolean;
};

/**
 * Verify a post-heal repair candidate and approve/reject.
 *
 * Success requires:
 * - candidate is schema-valid
 * - candidate semantic hash matches previous healthy hash
 *
 * On approval:
 * - HealAttempt → approved
 * - Model.healthState → VERIFIED → HEALTHY
 * - Previous Contract values preserved (provenance-safe, not semantic mutation)
 *
 * On rejection:
 * - HealAttempt → rejected
 * - Model.healthState → FAILED
 * - Previous Contract preserved
 */
export async function verifyRepairCandidateAndApprove(
  db: HealingDb,
  input: VerifyRepairInput,
): Promise<VerifyRepairResult> {
  const { healAttemptId, modelRecordId, previousHash, candidateHash, candidateSchemaValid } = input;

  // Verify semantic invariant
  const semanticMatch = candidateSchemaValid && candidateHash !== null
    ? verifyRepairCandidate(previousHash, candidateHash)
    : false;

  const approved = candidateSchemaValid && semanticMatch;

  await db.$transaction(async (tx) => {
    // Update HealAttempt
    await tx.healAttempt.update({
      where: { id: healAttemptId },
      data: {
        candidateRunId: input.candidateRunId,
        candidateOutput: jsonSafe(input.candidateOutput),
        candidateHash: candidateHash,
        candidateSchemaValid: candidateSchemaValid,
        semanticMatch,
        status: approved ? "approved" : "rejected",
        failureReason: approved
          ? null
          : !candidateSchemaValid
            ? "Candidate extraction structurally invalid"
            : "Semantic hash mismatch — repair rejected",
        completedAt: new Date(),
      },
    });

    // Update health state
    const newHealthState = approved ? "HEALTHY" : "FAILED";
    await tx.model.update({
      where: { id: modelRecordId },
      data: { healthState: newHealthState },
    });
  });

  return { approved, semanticMatch };
}

export type RejectRepairInput = {
  healAttemptId: string;
  modelRecordId: string;
  reason: string;
};

export type RejectRepairResult = {
  rejected: boolean;
};

/**
 * Manually reject a repair candidate.
 * Sets HealAttempt to rejected and healthState to FAILED.
 */
export async function rejectRepair(
  db: HealingDb,
  input: RejectRepairInput,
): Promise<RejectRepairResult> {
  await db.$transaction(async (tx) => {
    await tx.healAttempt.update({
      where: { id: input.healAttemptId },
      data: {
        status: "rejected",
        failureReason: input.reason,
        completedAt: new Date(),
      },
    });

    await tx.model.update({
      where: { id: input.modelRecordId },
      data: { healthState: "FAILED" },
    });
  });

  return { rejected: true };
}
