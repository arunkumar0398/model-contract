/**
 * Collector Regression Proof
 *
 * Tests the refactored Bright Data collector against all three known
 * layouts with a single collector: c_mszty5alythqu9dqd
 *
 * Usage: npx tsx scripts/collector-regression-proof.ts
 */
import { readFileSync } from "fs";
// Load .env manually
const envContent = readFileSync(".env", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
import { runCollectorAndWait } from "@modelcontract/brightdata";
import {
  normalizePrice,
  normalizeStatus,
  normalizeContextWindow,
  semanticHash,
  validateCandidate,
  classifyDrift,
} from "@modelcontract/core";
type ModelContract = import("@modelcontract/core").ModelContract;

const COLLECTOR_ID = process.env.BRIGHT_DATA_DEMO_COLLECTOR_ID!;
const BASE_URL = "https://model-contract.vercel.app/provider-demo/model-x";

type VariantResult = {
  variant: string;
  runId: string;
  raw: Record<string, unknown>;
  provider?: string;
  modelId?: string;
  status?: string;
  contextWindow?: number;
  inputPrice?: number;
  outputPrice?: number;
  schemaValid: boolean;
  hash: string | null;
  driftType?: string;
  fieldDiffs?: Array<{ field: string; previous: number; current: number }>;
  errors: string[];
};

function parsePrice(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const res = normalizePrice(raw);
  return res.ok ? res.value : undefined;
}

function parseStatus(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const res = normalizeStatus(raw);
  return res.ok ? res.value : undefined;
}

function parseContextWindow(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const res = normalizeContextWindow(raw);
  return res.ok ? res.value : undefined;
}

async function switchVariant(variant: string): Promise<void> {
  const res = await fetch("https://model-contract.vercel.app/api/demo/variant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant }),
  });
  if (!res.ok) throw new Error(`Failed to switch to ${variant}: ${res.statusText}`);
  console.log(`Switched demo to ${variant}`);
}

async function testVariant(variant: string): Promise<VariantResult> {
  console.log(`\n=== Testing ${variant} ===`);
  await switchVariant(variant);

  const result = await runCollectorAndWait(
    { collectorId: COLLECTOR_ID, inputs: [{ url: BASE_URL }] },
    { maxAttempts: 20, pollIntervalMs: 5000 },
  );

  console.log(`Run ID: ${result.runId}`);
  const row = result.rows[0] || {};
  console.log(`Raw row:`, JSON.stringify(row, null, 2));

  const provider = String(row.provider || "");
  const modelId = String(row.modelId || "");
  const status = parseStatus(row.status);
  const contextWindow = parseContextWindow(row.contextWindow);
  const inputPrice = parsePrice(row.inputPrice);
  const outputPrice = parsePrice(row.outputPrice);

  const contract: ModelContract = {
    provider,
    modelId,
    status: (status ?? "unknown") as ModelContract["status"],
    contextWindow,
    pricing: {
      inputPrice,
      outputPrice,
      currency: "USD",
      unit: "per_1m_tokens",
    },
    source: {
      url: BASE_URL,
      collectorId: COLLECTOR_ID,
      collectorVersion: "regression-test",
      observedAt: new Date().toISOString(),
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };

  const validation = validateCandidate(contract);
  const schemaValid = validation.errors.length === 0;
  const hash = schemaValid ? semanticHash(contract) : null;

  let driftType: string | undefined;
  let fieldDiffs: Array<{ field: string; previous: number; current: number }> = [];

  if (variant === "CHANGED_PRICE") {
    const previousContract: ModelContract = {
      provider: "demo-ai",
      modelId: "model-x",
      status: "active",
      contextWindow: 128000,
      pricing: {
        inputPrice: 4,
        outputPrice: 12,
        currency: "USD",
        unit: "per_1m_tokens",
      },
      source: {
        url: BASE_URL,
        collectorId: COLLECTOR_ID,
        collectorVersion: "baseline",
        observedAt: new Date().toISOString(),
      },
      validation: { schemaValid: true, confidence: 0.99, warnings: [] },
    };

    const decision = classifyDrift({
      previousContract,
      candidate: schemaValid ? contract : null,
      evidence: {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid,
        unsafeFields: [],
        missingFields: [],
        validationErrors: validation.errors,
      },
    });

    driftType = decision.driftType;
    fieldDiffs = decision.fieldDiffs as Array<{ field: string; previous: number; current: number }>;
  }

  return {
    variant,
    runId: result.runId,
    raw: row as Record<string, unknown>,
    provider,
    modelId,
    status: status,
    contextWindow,
    inputPrice,
    outputPrice,
    schemaValid,
    hash,
    driftType,
    fieldDiffs,
    errors: validation.errors,
  };
}

async function main() {
  console.log("=== COLLECTOR REGRESSION PROOF ===");
  console.log(`Collector: ${COLLECTOR_ID}`);
  console.log(`Base URL: ${BASE_URL}\n`);

  const results: VariantResult[] = [];
  const failures: string[] = [];

  // Test BROKEN_SELECTOR
  const brokenResult = await testVariant("BROKEN_SELECTOR");
  results.push(brokenResult);
  if (!brokenResult.schemaValid || brokenResult.hash !== "81ac4862") {
    failures.push(`BROKEN_SELECTOR: schemaValid=${brokenResult.schemaValid}, hash=${brokenResult.hash}`);
  }

  // Test HEALTHY
  const healthyResult = await testVariant("HEALTHY");
  results.push(healthyResult);
  if (!healthyResult.schemaValid || healthyResult.hash !== "81ac4862") {
    failures.push(`HEALTHY: schemaValid=${healthyResult.schemaValid}, hash=${healthyResult.hash}`);
  }

  // Test CHANGED_PRICE
  const changedResult = await testVariant("CHANGED_PRICE");
  results.push(changedResult);
  if (!changedResult.schemaValid) {
    failures.push(`CHANGED_PRICE: schemaValid=${changedResult.schemaValid}`);
  }
  if (changedResult.driftType !== "SEMANTIC_DRIFT") {
    failures.push(`CHANGED_PRICE: driftType=${changedResult.driftType} (expected SEMANTIC_DRIFT)`);
  }
  const hasPriceDiff = changedResult.fieldDiffs?.some(
    (d) => d.field === "pricing.inputPrice" && d.previous === 4 && d.current === 6,
  );
  if (!hasPriceDiff) {
    failures.push(`CHANGED_PRICE: missing pricing.inputPrice 4→6 diff`);
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`\n${r.variant}:`);
    console.log(`  runId: ${r.runId}`);
    console.log(`  provider: ${r.provider}`);
    console.log(`  modelId: ${r.modelId}`);
    console.log(`  status: ${r.status}`);
    console.log(`  contextWindow: ${r.contextWindow}`);
    console.log(`  inputPrice: ${r.inputPrice}`);
    console.log(`  outputPrice: ${r.outputPrice}`);
    console.log(`  schemaValid: ${r.schemaValid}`);
    console.log(`  hash: ${r.hash}`);
    if (r.driftType) console.log(`  driftType: ${r.driftType}`);
    if (r.fieldDiffs?.length) console.log(`  fieldDiffs:`, JSON.stringify(r.fieldDiffs));
  }

  if (failures.length > 0) {
    console.error("\n❌ FAILURES:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\n✅ ALL VARIANTS PASS");
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
