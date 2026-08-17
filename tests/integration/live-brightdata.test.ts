import { describe, expect, it } from "vitest";
import { runCollectorAndWait } from "@modelcontract/brightdata";
import { createPrismaClient } from "@modelcontract/db";
import { ingestObservation, type RawObservation } from "../../apps/web/lib/ingest";
import { setDemoState } from "../../apps/web/lib/demo-state";

/**
 * OPT-IN live end-to-end test: real Bright Data Scraper Studio run →
 * real dataset → real PostgreSQL ingestion. Skipped entirely in normal CI
 * (no credentials). Never mocked — only runs with real credentials set.
 *
 *   BRIGHT_DATA_API_TOKEN, DATABASE_URL,
 *   BRIGHT_DATA_DEMO_COLLECTOR_ID (and BRIGHT_DATA_REAL_COLLECTOR_ID)
 */
const live =
  Boolean(process.env.BRIGHT_DATA_API_TOKEN) &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.BRIGHT_DATA_DEMO_COLLECTOR_ID);

const CANONICAL_DEMO_URL = "http://localhost:3000/provider-demo/model-x";

describe.runIf(live)("live Bright Data ingestion (opt-in)", () => {
  it(
    "controlled demo collector: same URL -> Bright Data -> DB -> contract",
    { timeout: 240_000 },
    async () => {
      const db = createPrismaClient();
      if (!db) throw new Error("DATABASE_URL missing");

      // Reset the controlled provider to HEALTHY under the canonical URL.
      await setDemoState(db, "HEALTHY");

      const { runId, rows } = await runCollectorAndWait(
        {
          collectorId: process.env.BRIGHT_DATA_DEMO_COLLECTOR_ID!,
          inputs: [{ url: CANONICAL_DEMO_URL }],
        },
        { maxAttempts: 30, pollIntervalMs: 5000 },
      );
      expect(rows.length).toBeGreaterThan(0);
      console.log("[live] demo collector runId:", runId, "rows:", rows.length);

      const row = rows[0] as Record<string, unknown>;
      const raw: RawObservation = {
        provider: row.provider,
        modelId: row.modelId,
        status: row.status,
        contextWindow: row.contextWindow,
        inputPrice: row.inputPrice,
        outputPrice: row.outputPrice,
        deprecationDate: row.deprecationDate,
        sourceUrl: row.sourceUrl ?? CANONICAL_DEMO_URL,
        collectorId: process.env.BRIGHT_DATA_DEMO_COLLECTOR_ID,
        collectorVersion: "v1",
        runId,
        observedAt: new Date().toISOString(),
      };

      const result = await ingestObservation(db, raw);
      expect(result.schemaValid).toBe(true);
      expect(result.contractId).toBeTruthy();
      expect(result.semanticHash).toBeTruthy();

      const contract = await db.contract.findUnique({
        where: { id: result.contractId! },
        include: { model: true },
      });
      expect(contract?.model.modelId).toBe("model-x");
      expect(contract?.inputPrice).toBe(4);
      console.log("[live] demo contract:", JSON.stringify({ id: contract?.id, inputPrice: contract?.inputPrice, hash: contract?.semanticHash }));
    },
  );

  it(
    "real public source collector: trigger -> poll -> ingest at least one model",
    { timeout: 240_000 },
    async () => {
      const collectorId = process.env.BRIGHT_DATA_REAL_COLLECTOR_ID;
      if (!collectorId) return; // real-source collector optional in this stage

      const db = createPrismaClient();
      if (!db) throw new Error("DATABASE_URL missing");

      const { runId, rows } = await runCollectorAndWait(
        {
          collectorId,
          inputs: [{ url: "https://docs.anthropic.com/en/docs/about-claude/models/overview" }],
        },
        { maxAttempts: 30, pollIntervalMs: 5000 },
      );
      console.log("[live] real collector runId:", runId, "rows:", rows.length);

      let ingestedValid = 0;
      for (const row of rows as Array<Record<string, unknown>>) {
        if (typeof row.modelId !== "string" || row.modelId === "") continue;
        const raw: RawObservation = {
          provider: row.provider ?? "anthropic",
          modelId: row.modelId,
          status: row.status,
          contextWindow: row.contextWindow,
          inputPrice: row.inputPrice,
          outputPrice: row.outputPrice,
          deprecationDate: row.deprecationDate,
          sourceUrl: row.sourceUrl ?? "https://docs.anthropic.com/en/docs/about-claude/models/overview",
          collectorId,
          collectorVersion: "v1",
          runId,
          observedAt: new Date().toISOString(),
        };
        const result = await ingestObservation(db, raw);
        if (result.schemaValid) {
          ingestedValid += 1;
          console.log("[live] real contract:", JSON.stringify({ modelId: row.modelId, hash: result.semanticHash, contractId: result.contractId }));
        }
      }
      expect(ingestedValid).toBeGreaterThanOrEqual(1);
    },
  );
});
