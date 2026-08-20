/**
 * Stage 3 Database Acceptance — real Prisma/Neon, no mocks.
 * 
 * Runs the controlled acceptance sequence against Neon:
 * HEALTHY baseline, HEALTHY again, CHANGED_PRICE, AMBIGUOUS, 
 * MISSING_FIELD, TRANSIENT_FAILURE, restore HEALTHY.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPrismaClient } from "@modelcontract/db";
import { ingestObservation, recordCollectionFailure } from "../../apps/web/lib/ingest";
import type { RawObservation } from "../../apps/web/lib/ingest";

const PROVIDER = "demo-ai";
const MODEL = "model-x";
const SOURCE_URL = "https://model-contract.vercel.app/provider-demo/model-x";
const COLLECTOR_ID = "c_acceptance";
const COLLECTOR_VERSION = "v1";
const OBSERVED_AT = "2026-08-20T12:00:00.000Z";

// Skip if no DATABASE_URL
const prisma = createPrismaClient();
const itDb = prisma ? it : it.skip;

function rawObs(overrides: Partial<RawObservation> & Pick<RawObservation, "provider" | "modelId">): RawObservation {
  return {
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
    sourceUrl: SOURCE_URL,
    collectorId: COLLECTOR_ID,
    collectorVersion: COLLECTOR_VERSION,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

// Need model record id for queries
let modelRecordId: string;

beforeAll(async () => {
  if (!prisma) return;
  const providerRow = await prisma.provider.upsert({
    where: { slug: PROVIDER },
    create: { name: PROVIDER, slug: PROVIDER },
    update: {},
  });
  const modelRow = await prisma.model.upsert({
    where: { providerId_modelId: { providerId: providerRow.id, modelId: MODEL } },
    create: { providerId: providerRow.id, modelId: MODEL, displayName: MODEL },
    update: {},
  });
  modelRecordId = modelRow.id;
});

describe.runIf(process.env.DATABASE_URL)("Stage 3 database acceptance (real Neon)", () => {
  let currentHash = "";

  itDb("A — HEALTHY baseline: first ingestion establishes contract", async () => {
    const result = await ingestObservation(prisma!, rawObs({
      provider: PROVIDER,
      modelId: MODEL,
    }));

    expect(result.schemaValid).toBe(true);
    expect(result.contractId).toBeTruthy();
    expect(result.semanticHash).toBeTruthy();

    // Contract exists with correct values
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract).toBeTruthy();
    expect(contract!.inputPrice).toBe(4);
    expect(contract!.outputPrice).toBe(12);
    expect(contract!.status).toBe("active");

    currentHash = contract!.semanticHash;
  });

  itDb("B — HEALTHY again: NO_DRIFT, SEMANTIC_HASH_UNCHANGED, previousHash === currentHash", async () => {
    const result = await ingestObservation(prisma!, rawObs({
      provider: PROVIDER,
      modelId: MODEL,
    }));

    expect(result.schemaValid).toBe(true);
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.semanticHash).toBe(currentHash);

    // DriftEvent with SEMANTIC_HASH_UNCHANGED
    const latestEvent = await prisma!.driftEvent.findFirst({
      where: { modelRecordId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestEvent).toBeTruthy();
    expect(latestEvent!.driftType).toBe("NO_DRIFT");

    const reasonCodes = latestEvent!.reasonCodes as string[];
    expect(reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
    expect(latestEvent!.previousHash).toBe(latestEvent!.currentHash);

    // Contract unchanged
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.semanticHash).toBe(currentHash);
    expect(contract!.inputPrice).toBe(4);
  });

  itDb("C — CHANGED_PRICE: SEMANTIC_DRIFT, fieldDiff pricing.inputPrice 4→6", async () => {
    const result = await ingestObservation(prisma!, rawObs({
      provider: PROVIDER,
      modelId: MODEL,
      inputPrice: "$6 / 1M tokens",
    }));

    expect(result.schemaValid).toBe(true);
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.semanticHash).not.toBe(currentHash);

    // DriftEvent with correct fieldDiff
    const latestEvent = await prisma!.driftEvent.findFirst({
      where: { modelRecordId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestEvent).toBeTruthy();
    expect(latestEvent!.driftType).toBe("SEMANTIC_DRIFT");
    expect(latestEvent!.previousHash).toBe(currentHash);
    expect(latestEvent!.currentHash).not.toBe(currentHash);

    const diffs = latestEvent!.fieldDiffs as Array<{ field: string; previous: unknown; current: unknown }>;
    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "pricing.inputPrice", previous: 4, current: 6 }),
      ]),
    );

    // Contract promoted to $6
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.inputPrice).toBe(6);
    currentHash = contract!.semanticHash;
  });

  itDb("D — AMBIGUOUS ('Contact sales'): AMBIGUOUS_DRIFT, contract unchanged at $6", async () => {
    const result = await ingestObservation(prisma!, rawObs({
      provider: PROVIDER,
      modelId: MODEL,
      inputPrice: "Contact sales",
    }));

    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");

    const latestEvent = await prisma!.driftEvent.findFirst({
      where: { modelRecordId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestEvent).toBeTruthy();
    expect(latestEvent!.driftType).toBe("AMBIGUOUS_DRIFT");

    // Contract unchanged
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.inputPrice).toBe(6);
    expect(contract!.semanticHash).toBe(currentHash);
  });

  itDb("E — MISSING_FIELD (no inputPrice): EXTRACTION_DRIFT, contract unchanged at $6", async () => {
    const result = await ingestObservation(prisma!, {
      provider: PROVIDER,
      modelId: MODEL,
      status: "Active",
      contextWindow: "128k",
      outputPrice: "$12 / 1M tokens",
      sourceUrl: SOURCE_URL,
      collectorId: COLLECTOR_ID,
      collectorVersion: COLLECTOR_VERSION,
      observedAt: OBSERVED_AT,
    });

    expect(result.driftType).toBe("EXTRACTION_DRIFT");

    const latestEvent = await prisma!.driftEvent.findFirst({
      where: { modelRecordId },
      orderBy: { createdAt: "desc" },
    });
    expect(latestEvent).toBeTruthy();
    expect(latestEvent!.driftType).toBe("EXTRACTION_DRIFT");

    // Contract unchanged
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.inputPrice).toBe(6);
    expect(contract!.semanticHash).toBe(currentHash);
  });

  itDb("F — TRANSIENT_FAILURE: observationId=null, no observation, no contract change", async () => {
    const obsCountBefore = await prisma!.observation.count({ where: { modelId: modelRecordId } });

    const result = await recordCollectionFailure(prisma!, {
      provider: PROVIDER,
      modelId: MODEL,
      collectorId: COLLECTOR_ID,
      collectorVersion: COLLECTOR_VERSION,
      sourceUrl: SOURCE_URL,
      retryExhausted: false,
      failureReason: "Network timeout during acceptance test",
    });

    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.driftEventId).toBeTruthy();

    // DriftEvent with observationId=null, currentHash=null
    const event = await prisma!.driftEvent.findUnique({ where: { id: result.driftEventId } });
    expect(event).toBeTruthy();
    expect(event!.observationId).toBeNull();
    expect(event!.currentHash).toBeNull();

    // No new observation
    const obsCountAfter = await prisma!.observation.count({ where: { modelId: modelRecordId } });
    expect(obsCountAfter).toBe(obsCountBefore);

    // Contract unchanged
    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.inputPrice).toBe(6);
    expect(contract!.semanticHash).toBe(currentHash);
  });

  itDb("G — RESTORE HEALTHY: inputPrice 6→4, contract returns to canonical $4/$12", async () => {
    const result = await ingestObservation(prisma!, rawObs({
      provider: PROVIDER,
      modelId: MODEL,
      inputPrice: "$4 / 1M tokens",
    }));

    expect(result.schemaValid).toBe(true);
    expect(result.driftType).toBe("SEMANTIC_DRIFT");

    const contract = await prisma!.contract.findUnique({ where: { modelId: modelRecordId } });
    expect(contract!.inputPrice).toBe(4);
    expect(contract!.outputPrice).toBe(12);
    expect(contract!.status).toBe("active");
    expect(contract!.semanticHash).not.toBe(currentHash);
  });

  itDb("EVIDENCE — persisted DriftEvents match expected sequence", async () => {
    const events = await prisma!.driftEvent.findMany({
      where: { modelRecordId },
      orderBy: { createdAt: "asc" },
    });

    expect(events.length).toBeGreaterThanOrEqual(7);

    const last7 = events.slice(-7);
    expect(last7).toHaveLength(7);
    expect(last7[0]!.driftType).toBe("NO_DRIFT");   // HEALTHY baseline
    expect(last7[1]!.driftType).toBe("NO_DRIFT");   // HEALTHY again
    expect(last7[2]!.driftType).toBe("SEMANTIC_DRIFT"); // CHANGED_PRICE
    expect(last7[3]!.driftType).toBe("AMBIGUOUS_DRIFT"); // AMBIGUOUS
    expect(last7[4]!.driftType).toBe("EXTRACTION_DRIFT"); // MISSING_FIELD
    expect(last7[5]!.driftType).toBe("TRANSIENT_FAILURE"); // TRANSIENT_FAILURE
    expect(last7[5]!.observationId).toBeNull();
    expect(last7[6]!.driftType).toBe("SEMANTIC_DRIFT"); // RESTORE HEALTHY
  });
});
