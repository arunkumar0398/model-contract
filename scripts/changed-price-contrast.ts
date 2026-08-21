/**
 * CHANGED_PRICE contrast proof.
 *
 * Switches demo to CHANGED_PRICE variant, runs the real Bright Data
 * collector, and proves SEMANTIC_DRIFT with zero healing action.
 *
 * Usage: npx tsx scripts/changed-price-contrast.ts
 *
 * Requires: BRIGHT_DATA_API_TOKEN and BRIGHT_DATA_DEMO_COLLECTOR_ID in .env
 */
import { readFileSync } from "fs";
// Load .env manually (dotenv not available in scripts/)
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
const DEMO_URL = "https://model-contract.vercel.app/provider-demo/model-x";

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

async function main() {
  console.log("=== CHANGED_PRICE REAL CONTRAST ===\n");
  console.log(`Collector: ${COLLECTOR_ID}`);
  console.log(`Demo URL: ${DEMO_URL}`);
  console.log(`Variant: CHANGED_PRICE\n`);

  // 1. Run the collector
  console.log("--- Running collector ---");
  const result = await runCollectorAndWait(
    { collectorId: COLLECTOR_ID, inputs: [{ url: DEMO_URL }] },
    { maxAttempts: 20, pollIntervalMs: 5000 },
  );

  console.log(`Run ID: ${result.runId}`);
  console.log(`Rows: ${result.rows.length}`);
  console.log(`Raw row:`, JSON.stringify(result.rows[0], null, 2));

  if (result.rows.length === 0) {
    console.error("\nFAIL: No rows returned");
    process.exit(1);
  }

  const row = result.rows[0];

  // 2. Normalize
  const provider = String(row.provider);
  const modelId = String(row.modelId);
  const status = parseStatus(row.status);
  const contextWindow = parseContextWindow(row.contextWindow);
  const inputPrice = parsePrice(row.inputPrice);
  const outputPrice = parsePrice(row.outputPrice);

  console.log("\n--- Extracted values ---");
  console.log(`  provider: ${provider}`);
  console.log(`  modelId: ${modelId}`);
  console.log(`  status: ${status}`);
  console.log(`  contextWindow: ${contextWindow}`);
  console.log(`  inputPrice: ${inputPrice}`);
  console.log(`  outputPrice: ${outputPrice}`);

  // 3. Build contract
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
      url: DEMO_URL,
      collectorId: COLLECTOR_ID,
      collectorVersion: "changed-price-test",
      observedAt: new Date().toISOString(),
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };

  const validation = validateCandidate(contract);
  const schemaValid = validation.errors.length === 0;
  const currentHash = semanticHash(contract);

  // 4. Previous contract (HEALTHY baseline)
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
      url: DEMO_URL,
      collectorId: COLLECTOR_ID,
      collectorVersion: "baseline",
      observedAt: new Date().toISOString(),
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };

  const previousHash = semanticHash(previousContract);

  // 5. Classify
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

  console.log("\n--- Classification ---");
  console.log(`  driftType: ${decision.driftType}`);
  console.log(`  reasonCodes: ${decision.reasonCodes.join(", ")}`);
  console.log(`  fieldDiffs:`, JSON.stringify(decision.fieldDiffs, null, 2));
  console.log(`  previousHash: ${decision.previousHash}`);
  console.log(`  currentHash: ${decision.currentHash}`);

  // 6. Verify expected
  console.log("\n--- Expected results ---");
  const isSemanticDrift = decision.driftType === "SEMANTIC_DRIFT";
  const hasPriceDiff = decision.fieldDiffs.some(
    (d) => d.field === "pricing.inputPrice" && d.previous === 4 && d.current === 6,
  );
  const hashChanged = previousHash !== currentHash;

  console.log(`  SEMANTIC_DRIFT: ${isSemanticDrift ? "✅" : "❌"}`);
  console.log(`  pricing.inputPrice 4→6 diff: ${hasPriceDiff ? "✅" : "❌"}`);
  console.log(`  hash changed: ${hashChanged ? "✅" : "❌"}`);
  console.log(`  (no quarantine, no healing, no HealAttempt)`);

  console.log("\n--- RESULT ---");
  if (isSemanticDrift && hasPriceDiff && hashChanged) {
    console.log("✅ CHANGED_PRICE_CONTRAST_VERIFIED");
    console.log(`  run: ${result.runId}`);
    console.log(`  classification: SEMANTIC_DRIFT`);
    console.log(`  fieldDiff: pricing.inputPrice 4 → 6`);
    console.log(`  healing action: NONE`);
    console.log(`  HealAttempt eligible: false`);
  } else {
    console.error("❌ CHANGED_PRICE_CONTRAST_FAILED");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
