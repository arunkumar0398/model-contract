# Stage 4 — Self-Healing Design

## Real Capability Proof (2026-08-20)

### What Was Proven

| Phase | Run ID | Result |
|-------|--------|--------|
| HEALTHY baseline | `j_mt1jtgr1i92aypyxb` | ✅ All 6 fields present |
| BROKEN_SELECTOR | `j_mt1jttl022b0w6cqve` | ❌ Only sourceUrl present |
| BROKEN retry | `j_mt1jucaa2lwkjijz9r` | ❌ Empty row |
| Pre-heal evidence | `j_mt1l441y477wvqwis` | ❌ All 6 required fields missing |
| Post-heal BROKEN (attempt 2) | `j_mt2lp3ww174tcil1wk` | ✅ All 6 fields present — heal performed, BROKEN_SELECTOR works |
| Post-heal BROKEN retest | `j_mt2lujth1o2y9utjoc` | ✅ All 6 fields present — heal persistent for BROKEN_SELECTOR |
| Post-heal HEALTHY regression | `j_mt2ltm8pb2uaz02tr` | ❌ Only sourceUrl — heal broke article-based markup compatibility |
| Post-heal CHANGED_PRICE regression | `j_mt2lr7q6o5b184fwq` | ❌ Only sourceUrl — same incompatibility |
| **Collector refactor proof** | | |
| Refactored BROKEN_SELECTOR | `j_mt2mtnys23ykwmrlh4` | ⚠️ Partial — prices/status present, provider/modelId missing (attribute extraction) |
| Refactored HEALTHY | `j_mt2mu5663ufen6dry` | ✅ All 6 fields present, schemaValid=true, hash=81ac4862 |
| Refactored CHANGED_PRICE | `j_mt2muh76dzklvakgk` | ✅ All 6 fields present, schemaValid=true, hash=f3d45ec4, SEMANTIC_DRIFT |
| **Final collector proof (2026-08-21)** | | |
| Final BROKEN_SELECTOR (repaired) | `j_mt2ngwat2qox9iaziz` | ✅ All 6 fields present, schemaValid=true, hash=81ac4862 (post-repair, NO_DRIFT) |
| Final HEALTHY | `j_mt2nh8t81msjn91muw` | ✅ All 6 fields present, schemaValid=true, hash=81ac4862 |
| Final CHANGED_PRICE | `j_mt2nhj5o14uwnb7s55` | ✅ All 6 fields present, schemaValid=true, hash=f3d45ec4, SEMANTIC_DRIFT |

### Collector

- **ID:** `c_mszty5alythqu9dqd`
- **Input:** `{ url: string }`
- **Output fields:** `provider`, `modelId`, `status`, `contextWindow`, `inputPrice`, `outputPrice`, `deprecationDate`, `sourceUrl`

### Bright Data Self-Healing

**Mechanism:** UI-mediated only — Bright Data Scraper Studio "Self-Heal" / "AI Fix"

**No programmatic API exists:**
- `POST /dca/self-heal` → NOT FOUND
- `POST /dca/heal` → NOT FOUND
- `POST /dca/fix` → NOT FOUND
- `POST /dca/ai-fix` → NOT FOUND

**After heal:**
- Same collector ID: YES
- Version exposed: NO
- Revision exposed: NO
- Updated timestamp: NOT_EXPOSED via API

**Critical finding (first repair):** Self-Heal adapted selectors to BROKEN_SELECTOR's table-based markup, breaking compatibility with article-based markup (HEALTHY/CHANGED_PRICE). The healed collector works ONLY against the markup it was healed for.

**Collector refactor proof (second repair):** The collector was refactored to support both layouts. Initial refactor partially worked but missed `provider`/`modelId` attributes. Owner updated collector to extract `data-provider`/`data-model` attributes.

**Final collector proof (2026-08-21):** All three variants pass with a single collector:
- BROKEN_SELECTOR: ✅ All 6 fields present, schemaValid=true, hash=81ac4862
- HEALTHY: ✅ All 6 fields present, schemaValid=true, hash=81ac4862
- CHANGED_PRICE: ✅ All 6 fields present, schemaValid=true, hash=f3d45ec4, SEMANTIC_DRIFT

**One collector, two DOM layouts, one provider URL.** No collector swaps needed.

## Architecture

### Ownership Boundaries

```
packages/core/src/healing.ts
  → Pure logic: isHealingEligible(), verifyRepairCandidate(), allowedHealthTransition()

packages/brightdata/
  → Existing: triggerCollector(), getDataset(), runCollectorAndWait()
  → No new heal API

apps/web/lib/healing.ts
  → Orchestration: quarantine, HealAttempt, verification, approve/reject

apps/web/lib/collection.ts (or healing.ts)
  → Retry-once collector orchestrator

packages/db/
  → Model.healthState + HealAttempt persistence
```

### Retry Architecture

```
runCollectorAndWait()
      ↓
inspect result
      ↓
valid extraction?
  YES → ingestObservation(...)
  NO  → retry SAME collector exactly ONCE
            ↓
            inspect retry
            ↓
            valid?
              YES → ingestObservation(...)
              NO  → retryExhausted=true
                    → EXTRACTION_DRIFT
                    → QUARANTINED
```

**Critical:** Bright Data retry orchestration lives ABOVE `ingestObservation()`. The ingestion boundary remains pure persistence/classification.

### Observation Preparation

Extract one reusable pure function from `ingestObservation`:

```typescript
prepareObservation(raw: RawObservation): {
  candidate: CandidateObservation | null;
  schemaValid: boolean;
  unsafeFields: string[];
  missingFields: string[];
  errors: string[];
  warnings: string[];
  semanticHash: string | null;
}
```

Both `ingestObservation` and the retry orchestrator use this same function.

**Boundary:** `prepareObservation` operates ONLY on a real returned `RawObservation`. It does NOT handle network/run failure. Collection failure belongs to application orchestration and the existing `recordCollectionFailure` path.

## State Machine

### Real Observable Transitions

```
HEALTHY → QUARANTINED (extraction drift + retry exhausted)
QUARANTINED → HEALTHY (repair approved)
QUARANTINED → FAILED (repair rejected)
```

### State Definitions

| State | Meaning |
|-------|---------|
| HEALTHY | Last extraction successful, contract is valid |
| QUARANTINED | Retry exhausted, persistent EXTRACTION_DRIFT |
| FAILED | Repair rejected (semantic mismatch) or repair invalid |

### Dead States (removed from implementation)

HEALING, AWAITING_APPROVAL, VERIFIED, SUSPECT are defined in the type union but have no system events to trigger transitions. Bright Data repair is UI-mediated — no webhook/event marks the exact moment repair begins or completes. These states were architecture theatre and have been removed from the state machine.

### Storage

**Model.healthState** — health belongs to monitored source, not contract.

Contract remains the last valid semantic truth. Extraction failure produces `Model.healthState = QUARANTINED` while Contract stays at previous valid state.

## HealAttempt Schema

```prisma
model HealAttempt {
  id                       String   @id @default(cuid())
  driftEventId             String
  modelRecordId            String

  // Previous state (from last HEALTHY contract)
  previousCollectorId      String?
  previousHash             String?

  // Candidate repair evidence (real Bright Data data)
  candidateRunId           String?     // j_... from post-heal collection
  candidateOutput          Json?       // raw Bright Data rows
  candidateHash            String?
  candidateSchemaValid     Boolean?
  semanticMatch            Boolean?    // previousHash === candidateHash

  // Status
  status                   String   @default("pending")  // pending | approved | rejected | failed
  failureReason            String?

  createdAt                DateTime @default(now())
  completedAt              DateTime?

  driftEvent   DriftEvent  @relation(fields: [driftEventId], references: [id])
  model        Model       @relation(fields: [modelRecordId], references: [id])

  @@index([driftEventId])
  @@index([modelRecordId])
  @@index([status])
}
```

**Key decisions:**
- `candidateCollectorVersion` REMOVED — Bright Data does not expose versions
- `candidateRunId` — real `j_...` run ID from post-heal collection
- `candidateOutput` — raw Bright Data rows for evidence
- `semanticMatch` — computed boolean for quick verification
- `previousSchemaValid` REMOVED — previous healthy contract is guaranteed valid

## Typed RETRY_EXHAUSTED Reason Code

Stage 4 introduces a typed reason code in `packages/core/src/drift.ts`:

```typescript
export type ReasonCode =
  | "BASELINE_ESTABLISHED"
  | "SEMANTIC_HASH_UNCHANGED"
  | "SEMANTIC_FIELD_CHANGED"
  | "REQUIRED_FIELD_MISSING"
  | "UNSAFE_VALUE"
  | "COLLECTION_FAILED"
  | "EXTRACTION_VALIDATION_FAILED"  // Stage 3 — preserved
  | "RETRY_EXHAUSTED";              // NEW: Stage 4 — retry-once orchestrator exhausted
```

`RETRY_EXHAUSTED` is Stage 4 orchestration evidence, not a new drift type.
Classifier Stage 3 precedence remains frozen.

## Retry-Context Ingestion Contract

The collection orchestrator passes retry context into the existing ingestion boundary:

```typescript
// apps/web/lib/ingest.ts
export type IngestContext = {
  retryExhausted?: boolean;  // Stage 4: true only after final failed extraction
};

export async function ingestObservation(
  db: IngestDb,
  raw: RawObservation,
  context?: IngestContext,  // Stage 4: optional retry context
): Promise<IngestResult> {
  // ...
  const observationEvidence = {
    collectionFailed: false,
    retryExhausted: context?.retryExhausted ?? false,
    schemaValid,
    unsafeFields,
    missingFields,
    validationErrors: errors,
  };
  // ...
}
```

**Invariants:**
- Stage 2/3 callers remain unchanged (context defaults to `{}`)
- Stage 4 collection orchestrator passes `{ retryExhausted: true }` ONLY for the final failed extraction after exactly one retry
- Classification path is NOT duplicated — retry state flows through one coherent classification
- DriftEvent is written through one coherent classification path, not patched after the fact

## Pure Core APIs

```typescript
// packages/core/src/healing.ts

function isHealingEligible(input: { driftType: DriftType; reasonCodes: ReasonCode[] }): boolean {
  return input.driftType === "EXTRACTION_DRIFT" && input.reasonCodes.includes("RETRY_EXHAUSTED");
}

function verifyRepairCandidate(
  previousHash: string,
  candidateHash: string
): boolean {
  return previousHash === candidateHash;
}

function allowedHealthTransition(
  from: HealthState,
  to: HealthState
): boolean {
  // Define valid transitions
}
```

## Invariants

1. **EXTRACTION_DRIFT ≠ SEMANTIC_DRIFT** — structural, enforced by classifier
2. **SEMANTIC_DRIFT never triggers healing** — `isHealingEligible("SEMANTIC_DRIFT") === false`
3. **AMBIGUOUS_DRIFT not automatically healing eligible** — requires human review
3a. **RETRY_EXHAUSTED required** — healing eligibility requires BOTH `EXTRACTION_DRIFT` AND `RETRY_EXHAUSTED` reason code, preventing single-failure immediate healing
4. **Semantic invariant:** `semanticHash(healthy) === semanticHash(repaired)` before approval
5. **No fake repairs** — Bright Data is the repair tool, ModelContract is the verifier
6. **Contract preserved** — extraction failure never overwrites last valid contract
7. **Retry exactly once** — not configurable, not a framework
8. **State machine honest** — only HEALTHY, QUARANTINED, FAILED are real observable states. No dead states.
9. **Repair regression invariant** — a repair candidate is acceptable only when:
   a. current broken extraction becomes valid
   b. schema validation passes
   c. extraction-only semantics remain unchanged
   d. deterministic HEALTHY canary remains valid

   This is NOT a generic compatibility/history framework. Only one controlled canary is required.

## Demo Flow

### Scenario A: Extraction Drift → Heal → Recovery

1. HEALTHY baseline established ($4 input, $12 output)
2. Switch to BROKEN_SELECTOR
3. Real Bright Data run fails to extract (empty fields)
4. Retry once → still fails
5. EXTRACTION_DRIFT classified
6. Model quarantined (HEALTHY → SUSPECT → QUARANTINED)
7. Operator heals in Bright Data Scraper Studio
8. ModelContract re-runs collector → valid extraction
9. Semantic hash matches → REPAIR_CANDIDATE_VERIFIED
10. Approve → VERIFIED → HEALTHY

### Scenario B: Semantic Drift → No Heal

1. HEALTHY baseline established
2. Switch to CHANGED_PRICE ($6 input)
3. Real Bright Data run succeeds (valid extraction)
4. SEMANTIC_DRIFT classified (pricing.inputPrice 4 → 6)
5. ZERO heal attempts
6. No quarantine
7. Contract updated with $6
8. Distinction proven: we repair broken extraction, not real facts

**Note:** The same collector handles both article-based (HEALTHY/CHANGED_PRICE) and table-based (BROKEN_SELECTOR) layouts. No collector swap or revert required between Scenario A and B.

## Failed Repair Case

```
broken extraction
→ candidate becomes structurally valid
BUT semantics differ unexpectedly (e.g., inputPrice = 6)

candidateSchemaValid = true
semanticMatch = false
→ REJECT REPAIR
→ healthState = FAILED
→ current Contract remains $4
```

## 3x Acceptance Reset Procedure

Because Bright Data repairs the collector in-place, each pass requires the collector to be genuinely broken again. The real reset procedure:

### Pass 1
1. Set demo BROKEN_SELECTOR
2. Run collector → extraction fails (BROKEN_SELECTOR table markup)
3. Retry → still fails
4. QUARANTINED
5. Operator heals collector in Bright Data Scraper Studio
6. Run collector → valid extraction
7. Semantic hash matches → APPROVED → HEALTHY

### Pass 2 Reset
1. Operator opens Bright Data Scraper Studio
2. Manually reverts the collector selectors to the BROKEN state
   (restores the broken CSS selectors that only extract from article-based layout)
3. Set demo BROKEN_SELECTOR
4. Run collector → extraction fails again (proof of real break)
5. Repeat steps 3-7 from Pass 1

### Pass 3 Reset
1. Same reset procedure as Pass 2
2. Repeat the full cycle

### What proves the collector is broken before each heal
- Real Bright Data run returns rows with missing/empty required fields
- schemaValid = false
- No provider, no modelId, no prices extracted

### If no reproducible reset exists
Report `STAGE4_3X_REAL_RESET_BLOCKED` and propose the smallest honest gate adjustment for explicit approval. Do not change the gate silently.
