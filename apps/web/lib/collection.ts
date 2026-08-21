import { prepareObservation } from "@modelcontract/core";
import { runCollectorAndWait } from "@modelcontract/brightdata";
import { recordCollectionFailure, ingestObservation } from "./ingest";
import type { IngestDb, RawObservation } from "./ingest";

/**
 * Retry-once collection orchestrator.
 *
 * Runs Bright Data collector, inspects extraction quality, retries exactly
 * once if invalid, and feeds the result through the single ingestObservation
 * classification path.
 *
 * This module owns Bright Data network orchestration. It does NOT own
 * classification logic — that stays in packages/core.
 */

export type CollectWithRetryInput = {
  db: IngestDb;
  collectorId: string;
  inputs: Array<Record<string, unknown>>;
  provider: string;
  modelId: string;
  sourceUrl?: string;
  collectorVersion?: string;
};

export type CollectWithRetryResult = {
  driftType: string;
  driftEventId: string | null;
  observationId: string | null;
  retryExhausted: boolean;
  retryCount: number;
  recovered: boolean;
  schemaValid: boolean;
  errors: string[];
};

/**
 * Run collector, prepare observation, decide whether retry is needed,
 * and feed through the single ingestObservation path.
 */
export async function collectWithRetry(
  input: CollectWithRetryInput,
): Promise<CollectWithRetryResult> {
  const { db, collectorId, inputs, provider, modelId, sourceUrl, collectorVersion } = input;

  // --- Attempt 1 ---
  let runResult;
  try {
    runResult = await runCollectorAndWait({ collectorId, inputs });
  } catch (err) {
    // Network / collection failure → existing TRANSIENT_FAILURE path
    const failureResult = await recordCollectionFailure(db, {
      provider,
      modelId,
      collectorId,
      collectorVersion,
      sourceUrl,
      retryExhausted: false,
      failureReason: err instanceof Error ? err.message : String(err),
    });
    return {
      driftType: failureResult.driftType,
      driftEventId: failureResult.driftEventId,
      observationId: null,
      retryExhausted: false,
      retryCount: 0,
      recovered: false,
      schemaValid: false,
      errors: [failureResult.driftType],
    };
  }

  const row = runResult.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    const failureResult = await recordCollectionFailure(db, {
      provider,
      modelId,
      collectorId,
      collectorVersion,
      sourceUrl: sourceUrl ?? "",
      retryExhausted: false,
      failureReason: "Empty dataset",
    });
    return {
      driftType: failureResult.driftType,
      driftEventId: failureResult.driftEventId,
      observationId: null,
      retryExhausted: false,
      retryCount: 0,
      recovered: false,
      schemaValid: false,
      errors: ["EMPTY_DATASET"],
    };
  }

  const raw1: RawObservation = {
    provider: row.provider,
    modelId: row.modelId,
    status: row.status,
    contextWindow: row.contextWindow,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    deprecationDate: row.deprecationDate,
    sourceUrl: row.sourceUrl ?? sourceUrl ?? "",
    collectorId: typeof row.collectorId === "string" ? row.collectorId : collectorId,
    collectorVersion: typeof row.collectorVersion === "string" ? row.collectorVersion : collectorVersion ?? "",
    runId: runResult.runId,
    observedAt: new Date().toISOString(),
  };

  const prepared1 = prepareObservation(raw1);

  if (prepared1.schemaValid) {
    // First attempt valid → ingest directly
    const ingestResult = await ingestObservation(db, raw1);
    return {
      driftType: ingestResult.driftType,
      driftEventId: ingestResult.driftEventId,
      observationId: ingestResult.observationId,
      retryExhausted: false,
      retryCount: 0,
      recovered: false,
      schemaValid: true,
      errors: [],
    };
  }

  // --- Attempt 2: retry exactly once ---
  let retryResult;
  try {
    retryResult = await runCollectorAndWait({ collectorId, inputs });
  } catch (err) {
    // Network failure during retry → record as collection failure
    const failureResult = await recordCollectionFailure(db, {
      provider,
      modelId,
      collectorId,
      collectorVersion,
      sourceUrl,
      retryExhausted: true,
      failureReason: err instanceof Error ? err.message : String(err),
    });
    return {
      driftType: failureResult.driftType,
      driftEventId: failureResult.driftEventId,
      observationId: null,
      retryExhausted: true,
      retryCount: 1,
      recovered: false,
      schemaValid: false,
      errors: [failureResult.driftType],
    };
  }

  const retryRow = retryResult.rows[0] as Record<string, unknown> | undefined;
  if (!retryRow) {
    // Empty retry → treat as extraction failure with retry exhausted
    const ingestResult = await ingestObservation(db, raw1, { retryExhausted: true });
    return {
      driftType: ingestResult.driftType,
      driftEventId: ingestResult.driftEventId,
      observationId: ingestResult.observationId,
      retryExhausted: true,
      retryCount: 1,
      recovered: false,
      schemaValid: false,
      errors: ingestResult.errors,
    };
  }

  const raw2: RawObservation = {
    provider: retryRow.provider,
    modelId: retryRow.modelId,
    status: retryRow.status,
    contextWindow: retryRow.contextWindow,
    inputPrice: retryRow.inputPrice,
    outputPrice: retryRow.outputPrice,
    deprecationDate: retryRow.deprecationDate,
    sourceUrl: retryRow.sourceUrl ?? sourceUrl ?? "",
    collectorId: typeof retryRow.collectorId === "string" ? retryRow.collectorId : collectorId,
    collectorVersion: typeof retryRow.collectorVersion === "string" ? retryRow.collectorVersion : collectorVersion ?? "",
    runId: retryResult.runId,
    observedAt: new Date().toISOString(),
  };

  const prepared2 = prepareObservation(raw2);

  if (prepared2.schemaValid) {
    // Retry recovered → ingest the retry observation
    const ingestResult = await ingestObservation(db, raw2);
    return {
      driftType: ingestResult.driftType,
      driftEventId: ingestResult.driftEventId,
      observationId: ingestResult.observationId,
      retryExhausted: false,
      retryCount: 1,
      recovered: true,
      schemaValid: true,
      errors: [],
    };
  }

  // Retry also invalid → final ingestion with retryExhausted=true
  const ingestResult = await ingestObservation(db, raw2, { retryExhausted: true });
  return {
    driftType: ingestResult.driftType,
    driftEventId: ingestResult.driftEventId,
    observationId: ingestResult.observationId,
    retryExhausted: true,
    retryCount: 1,
    recovered: false,
    schemaValid: false,
    errors: ingestResult.errors,
  };
}
