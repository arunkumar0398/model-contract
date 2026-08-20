import type { PrismaClient } from "@modelcontract/db";
import {
  normalizeContextWindow,
  normalizeDate,
  normalizePrice,
  normalizeStatus,
  semanticHash,
  validateCandidate,
  classifyDrift,
  type CandidateObservation,
  type ModelContract,
  type DriftType,
} from "@modelcontract/core";

/** JSON-safe payload (strips undefined so Prisma Json columns accept it). */
function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Raw collector observation — scraped strings exactly as Bright Data
 * returned them. packages/core owns normalization; this module owns the
 * receive -> normalize -> validate -> hash -> persist pipeline.
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

export type IngestResult = {
  observationId: string;
  schemaValid: boolean;
  contractId: string | null;
  semanticHash: string | null;
  driftType: DriftType;
  driftEventId: string | null;
  errors: string[];
  warnings: string[];
};

/** Structural subset of PrismaClient the pipeline uses (fake-able in CI). */
export type IngestDb = Pick<
  PrismaClient,
  "provider" | "model" | "contract" | "observation" | "collectorVersion" | "driftEvent" | "$transaction"
>;

type ContractRow = {
  status: string;
  contextWindow?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  currency: string;
  pricingUnit: string;
  deprecationDate?: string | null;
  sourceUrl: string;
  collectorId: string;
  collectorVersion: string;
  observedAt: string;
  id?: string;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Convert a Prisma Contract row to a ModelContract for the classifier.
 * MUST receive domain-level provider and modelId — not DB record IDs.
 */
function contractRowToModelContract(
  row: {
    status: string;
    contextWindow?: number | null;
    inputPrice?: number | null;
    outputPrice?: number | null;
    currency: string;
    pricingUnit: string;
    deprecationDate?: string | null;
    sourceUrl: string;
    collectorId: string;
    collectorVersion: string;
    observedAt: string;
  },
  provider: string,
  modelId: string,
): ModelContract {
  return {
    provider,
    modelId,
    status: row.status as ModelContract["status"],
    contextWindow: row.contextWindow ?? undefined,
    pricing: {
      inputPrice: row.inputPrice ?? undefined,
      outputPrice: row.outputPrice ?? undefined,
      currency: row.currency as "USD",
      unit: row.pricingUnit as "per_1m_tokens",
    },
    deprecationDate: row.deprecationDate ?? undefined,
    source: {
      url: row.sourceUrl,
      collectorId: row.collectorId,
      collectorVersion: row.collectorVersion,
      observedAt: row.observedAt,
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };
}

/**
 * Stage 3 ingestion: normalize, validate, classify BEFORE promotion,
 * persist DriftEvent, then promote valid Contract — all atomically.
 *
 * Critical invariant: EXTRACTION_DRIFT and AMBIGUOUS_DRIFT never promote.
 */
export async function ingestObservation(db: IngestDb, raw: RawObservation): Promise<IngestResult> {
  const provider = nonEmptyString(raw.provider) ? raw.provider : "";
  const modelId = nonEmptyString(raw.modelId) ? raw.modelId : "";
  const sourceUrl = nonEmptyString(raw.sourceUrl) ? raw.sourceUrl : "";
  const collectorId = nonEmptyString(raw.collectorId) ? raw.collectorId : "";
  const collectorVersion = nonEmptyString(raw.collectorVersion) ? raw.collectorVersion : null;
  const runId = nonEmptyString(raw.runId) ? raw.runId : null;
  const observedAt = nonEmptyString(raw.observedAt) ? raw.observedAt : new Date().toISOString();

  // --- Normalize (packages/core). Track unsafe/missing fields for classification.
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

  // --- Validate the normalized candidate (packages/core).
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
        collectorVersion: collectorVersion ?? "",
        observedAt,
      },
      confidence: 0.99,
    };
    const validation = validateCandidate(candidate);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
    schemaValid = errors.length === 0;
  }

  const hash = candidate && schemaValid ? semanticHash(candidate as ModelContract) : null;

  // --- Evidence for classifier
  const observationEvidence = {
    collectionFailed: false,
    retryExhausted: false,
    schemaValid,
    unsafeFields,
    missingFields,
    validationErrors: errors,
  };

  // --- Idempotent upserts (outside transaction)
  const providerRow = await db.provider.upsert({
    where: { slug: provider.toLowerCase() },
    create: { name: provider, slug: provider.toLowerCase() },
    update: {},
  });

  const modelRow = await db.model.upsert({
    where: { providerId_modelId: { providerId: providerRow.id, modelId } },
    create: { providerId: providerRow.id, modelId, displayName: modelId },
    update: {},
  });

  if (collectorVersion) {
    await db.collectorVersion.upsert({
      where: { collectorId_version: { collectorId, version: collectorVersion } },
      create: { collectorId, version: collectorVersion, sourceName: provider, status: "active" },
      update: { sourceName: provider, status: "active" },
    });
  }

  // --- Atomic transaction: observation + classify + driftEvent + promote
  const txResult = await db.$transaction(async (tx) => {
    // Load previous contract INSIDE transaction
    const previousRow = await tx.contract.findUnique({
      where: { modelId: modelRow.id },
    });
    const previousContract = previousRow
      ? contractRowToModelContract(previousRow as ContractRow, provider, modelId)
      : null;

    // Persist observation
    const observation = await tx.observation.create({
      data: {
        modelId: modelRow.id,
        rawPayload: jsonSafe(raw),
        normalizedPayload: candidate ? jsonSafe(candidate) : null,
        schemaValid,
        validationErrors: errors,
        validationWarnings: warnings,
        semanticHash: hash,
        collectorId,
        collectorVersion,
        runId,
        sourceUrl,
        observedAt,
      },
    });

    // Classify BEFORE promotion
    const decision = classifyDrift({
      previousContract,
      candidate: schemaValid ? candidate : null,
      evidence: observationEvidence,
    });

    // Persist DriftEvent
    const driftEvent = await tx.driftEvent.create({
      data: {
        modelRecordId: modelRow.id,
        observationId: observation.id,
        previousContractId: previousRow?.id ?? null,
        driftType: decision.driftType,
        reasonCodes: decision.reasonCodes,
        explanations: decision.explanations,
        fieldDiffs: decision.fieldDiffs as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        previousHash: decision.previousHash,
        currentHash: decision.currentHash,
      },
    });

    // Promote contract ONLY for valid observations
    let contractId: string | null = null;
    const shouldPromote =
      schemaValid &&
      candidate !== null &&
      decision.driftType !== "EXTRACTION_DRIFT" &&
      decision.driftType !== "AMBIGUOUS_DRIFT" &&
      decision.driftType !== "TRANSIENT_FAILURE";

    if (shouldPromote) {
      const c = candidate!;
      const contractRow = await tx.contract.upsert({
        where: { modelId: modelRow.id },
        create: {
          modelId: modelRow.id,
          status: c.status,
          contextWindow: c.contextWindow ?? null,
          inputPrice: c.pricing?.inputPrice ?? null,
          outputPrice: c.pricing?.outputPrice ?? null,
          currency: "USD",
          pricingUnit: "per_1m_tokens",
          deprecationDate: c.deprecationDate ?? null,
          semanticHash: hash!,
          sourceUrl,
          collectorId,
          collectorVersion: collectorVersion ?? "",
          observedAt,
        },
        update: {
          status: c.status,
          contextWindow: c.contextWindow ?? null,
          inputPrice: c.pricing?.inputPrice ?? null,
          outputPrice: c.pricing?.outputPrice ?? null,
          deprecationDate: c.deprecationDate ?? null,
          semanticHash: hash!,
          sourceUrl,
          collectorId,
          collectorVersion: collectorVersion ?? "",
          observedAt,
        },
      });
      contractId = contractRow.id;
    }

    return {
      observationId: observation.id,
      driftEventId: driftEvent.id,
      contractId,
      driftType: decision.driftType,
    };
  });

  return {
    observationId: txResult.observationId,
    schemaValid,
    contractId: txResult.contractId,
    semanticHash: hash,
    driftType: txResult.driftType,
    driftEventId: txResult.driftEventId,
    errors,
    warnings,
  };
}

// --- Collection failure recording (TRANSIENT_FAILURE without Observation) ---

export type CollectionFailureInput = {
  provider: string;
  modelId: string;
  collectorId?: string;
  collectorVersion?: string;
  runId?: string;
  sourceUrl?: string;
  retryExhausted: boolean;
  failureReason: string;
};

export type CollectionFailureResult = {
  driftEventId: string;
  driftType: "TRANSIENT_FAILURE";
  previousHash: string | null;
};

export type CollectionFailureDb = Pick<
  PrismaClient,
  "provider" | "model" | "contract" | "driftEvent" | "$transaction"
>;

/**
 * Record a collection/network failure. Creates a DriftEvent with
 * observationId=null. Never creates an Observation. Never promotes a Contract.
 */
export async function recordCollectionFailure(
  db: CollectionFailureDb,
  input: CollectionFailureInput,
): Promise<CollectionFailureResult> {
  const providerRow = await db.provider.upsert({
    where: { slug: input.provider.toLowerCase() },
    create: { name: input.provider, slug: input.provider.toLowerCase() },
    update: {},
  });

  const modelRow = await db.model.upsert({
    where: { providerId_modelId: { providerId: providerRow.id, modelId: input.modelId } },
    create: { providerId: providerRow.id, modelId: input.modelId, displayName: input.modelId },
    update: {},
  });

  return db.$transaction(async (tx) => {
    const previousRow = await tx.contract.findUnique({
      where: { modelId: modelRow.id },
    });
    const previousContract = previousRow
      ? contractRowToModelContract(previousRow as ContractRow, input.provider, input.modelId)
      : null;

    const decision = classifyDrift({
      previousContract,
      candidate: null,
      evidence: {
        collectionFailed: true,
        retryExhausted: input.retryExhausted,
        schemaValid: false,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [input.failureReason],
      },
    });

    const event = await tx.driftEvent.create({
      data: {
        modelRecordId: modelRow.id,
        observationId: null,
        previousContractId: previousRow?.id ?? null,
        driftType: decision.driftType,
        reasonCodes: decision.reasonCodes,
        explanations: decision.explanations,
        fieldDiffs: decision.fieldDiffs as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        previousHash: decision.previousHash,
        currentHash: decision.currentHash,
      },
    });

    return {
      driftEventId: event.id,
      driftType: "TRANSIENT_FAILURE" as const,
      previousHash: decision.previousHash,
    };
  });
}
