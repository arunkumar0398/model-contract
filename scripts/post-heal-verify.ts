/**
 * Post-heal verification script.
 *
 * Runs the REAL Bright Data collector against BROKEN_SELECTOR demo
 * and verifies the healed extraction produces valid semantic output.
 *
 * Usage: npx tsx scripts/post-heal-verify.ts
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
  console.log("=== POST-HEAL VERIFICATION ===\n");
  console.log(`Collector: ${COLLECTOR_ID}`);
  console.log(`Demo URL: ${DEMO_URL}`);
  console.log(`Variant: BROKEN_SELECTOR (must still be active)\n`);

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

  // 2. Check required fields
  const requiredFields = ["provider", "modelId", "status", "inputPrice", "outputPrice"];
  const missingFields = requiredFields.filter(
    (f) => row[f] === undefined || row[f] === null || row[f] === "",
  );

  console.log("\n--- Field check ---");
  for (const f of requiredFields) {
    const present = row[f] !== undefined && row[f] !== null && row[f] !== "";
    console.log(`  ${f}: ${present ? "✅" : "❌"} ${row[f] ?? "(missing)"}`);
  }

  if (missingFields.length > 0) {
    console.error(`\nFAIL: Missing fields: ${missingFields.join(", ")}`);
    process.exit(1);
  }

  // 3. Normalize and build contract
  const provider = String(row.provider);
  const modelId = String(row.modelId);
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
      url: DEMO_URL,
      collectorId: COLLECTOR_ID,
      collectorVersion: "post-heal",
      observedAt: new Date().toISOString(),
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };

  const validation = validateCandidate(contract);
  const schemaValid = validation.errors.length === 0;
  const candidateHash = semanticHash(contract);

  // 4. Expected values
  const expectedHash = "81ac4862"; // last known healthy hash

  console.log("\n--- Semantic verification ---");
  console.log(`  provider: ${provider}`);
  console.log(`  modelId: ${modelId}`);
  console.log(`  status: ${contract.status}`);
  console.log(`  contextWindow: ${contextWindow}`);
  console.log(`  inputPrice: ${inputPrice}`);
  console.log(`  outputPrice: ${outputPrice}`);
  console.log(`  schemaValid: ${schemaValid}`);
  console.log(`  validation errors: ${validation.errors.join(", ") || "(none)"}`);
  console.log(`  candidateHash: ${candidateHash}`);
  console.log(`  previousHash (expected): ${expectedHash}`);
  console.log(`  semanticMatch: ${candidateHash === expectedHash}`);

  console.log("\n--- RESULT ---");
  if (schemaValid && candidateHash === expectedHash) {
    console.log("✅ REPAIR_CANDIDATE_VERIFIED");
    console.log(`  postHealRunId: ${result.runId}`);
    console.log(`  schemaValid: true`);
    console.log(`  previousHash: ${expectedHash}`);
    console.log(`  candidateHash: ${candidateHash}`);
    console.log(`  semanticMatch: true`);
  } else {
    console.error("❌ REPAIR_CANDIDATE_FAILED");
    if (!schemaValid) console.error("  reason: schema invalid");
    if (candidateHash !== expectedHash) console.error("  reason: semantic mismatch");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
