import type { PrismaClient } from "@modelcontract/db";
import {
  normalizeContextWindow,
  normalizeDate,
  normalizePrice,
  normalizeStatus,
  semanticHash,
  validateCandidate,
  type CandidateObservation,
  type ModelContract,
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
  errors: string[];
  warnings: string[];
};

/** Structural subset of PrismaClient the pipeline uses (fake-able in CI). */
export type IngestDb = Pick<
  PrismaClient,
  "provider" | "model" | "contract" | "observation" | "collectorVersion"
>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Stage 2 ingestion: persist the raw observation, normalize + validate with
 * packages/core, compute the semantic hash when valid, and promote the
 * current contract ONLY for schema-valid observations. Invalid scrapes are
 * stored with schemaValid=false and their errors — never promoted, so
 * Stage 3 can classify them without false semantic changes.
 */
export async function ingestObservation(db: IngestDb, raw: RawObservation): Promise<IngestResult> {
  const provider = nonEmptyString(raw.provider) ? raw.provider : "";
  const modelId = nonEmptyString(raw.modelId) ? raw.modelId : "";
  const sourceUrl = nonEmptyString(raw.sourceUrl) ? raw.sourceUrl : "";
  const collectorId = nonEmptyString(raw.collectorId) ? raw.collectorId : "";
  const collectorVersion = nonEmptyString(raw.collectorVersion) ? raw.collectorVersion : null;
  const runId = nonEmptyString(raw.runId) ? raw.runId : null;
  const observedAt = nonEmptyString(raw.observedAt) ? raw.observedAt : new Date().toISOString();

  // --- Normalize (packages/core). Failed fields become errors; missing
  // optional fields stay undefined; inputPrice is required.
  const errors: string[] = [];
  const warnings: string[] = [];

  const statusRes = normalizeStatus(raw.status);
  if (!statusRes.ok) errors.push(`status: ${statusRes.reason}`);

  const contextRes =
    raw.contextWindow !== undefined && raw.contextWindow !== null && raw.contextWindow !== ""
      ? normalizeContextWindow(raw.contextWindow)
      : { ok: true as const, value: undefined };
  if (!contextRes.ok) errors.push(`contextWindow: ${contextRes.reason}`);

  const inputRes =
    raw.inputPrice !== undefined && raw.inputPrice !== null && raw.inputPrice !== ""
      ? normalizePrice(raw.inputPrice)
      : { ok: false as const, reason: "inputPrice is missing" };
  if (!inputRes.ok) errors.push(`pricing.inputPrice: ${inputRes.reason}`);

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
  let normalized: Omit<ModelContract, "source" | "validation"> | null = null;
  let hash: string | null = null;

  if (statusRes.ok && contextRes.ok && inputRes.ok && outputRes.ok && dateRes.ok) {
    const candidate: CandidateObservation = {
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

    if (schemaValid) {
      const contract: ModelContract = {
        ...candidate,
        pricing: candidate.pricing,
        source: candidate.source,
        validation: { schemaValid: true, confidence: 0.99, warnings },
      };
      hash = semanticHash(contract);
      normalized = {
        provider: contract.provider,
        modelId: contract.modelId,
        status: contract.status,
        contextWindow: contract.contextWindow,
        pricing: contract.pricing,
        deprecationDate: contract.deprecationDate,
      };
    }
  }

  // --- Persist provenance + raw payload first (never lost).
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

  const observation = await db.observation.create({
    data: {
      modelId: modelRow.id,
      rawPayload: jsonSafe(raw),
      normalizedPayload: normalized ? jsonSafe(normalized) : null,
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

  // --- Promote the current contract only when the observation is valid.
  let contractId: string | null = null;
  if (schemaValid && hash && normalized) {
    const contractRow = await db.contract.upsert({
      where: { modelId: modelRow.id },
      create: {
        modelId: modelRow.id,
        status: normalized.status,
        contextWindow: normalized.contextWindow ?? null,
        inputPrice: normalized.pricing?.inputPrice ?? null,
        outputPrice: normalized.pricing?.outputPrice ?? null,
        currency: "USD",
        pricingUnit: "per_1m_tokens",
        deprecationDate: normalized.deprecationDate ?? null,
        semanticHash: hash,
        sourceUrl,
        collectorId,
        collectorVersion: collectorVersion ?? "",
        observedAt,
      },
      update: {
        status: normalized.status,
        contextWindow: normalized.contextWindow ?? null,
        inputPrice: normalized.pricing?.inputPrice ?? null,
        outputPrice: normalized.pricing?.outputPrice ?? null,
        deprecationDate: normalized.deprecationDate ?? null,
        semanticHash: hash,
        sourceUrl,
        collectorId,
        collectorVersion: collectorVersion ?? "",
        observedAt,
      },
    });
    contractId = contractRow.id;
  }

  return { observationId: observation.id, schemaValid, contractId, semanticHash: hash, errors, warnings };
}
