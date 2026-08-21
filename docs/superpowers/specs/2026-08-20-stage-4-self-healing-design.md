# Stage 4 — Self-Healing Design

## Real Capability Proof (2026-08-20)

### What Was Proven

| Phase | Run ID | Result |
|-------|--------|--------|
| HEALTHY baseline | `j_mt1jtgr1i92aypyxb` | ✅ All 6 fields present |
| BROKEN_SELECTOR | `j_mt1jttl022b0w6cqve` | ❌ Only sourceUrl present |
| BROKEN retry | `j_mt1jucaa2lwkjijz9r` | ❌ Empty row |
| Pre-heal evidence | `j_mt1l441y477wvqwis` | ❌ All 6 required fields missing |
| Post-heal (attempt 1) | `j_mt2kfgo7vvrzrbk8e` | ❌ All 6 fields missing — heal not yet performed |
| Post-heal (attempt 2) | `j_mt2lp3ww174tcil1wk` | ✅ All 6 fields present — heal performed, BROKEN_SELECTOR works |
| Post-heal BROKEN retest | `j_mt2lujth1o2y9utjoc` | ✅ All 6 fields present — heal persistent for BROKEN_SELECTOR |
| Post-heal HEALTHY test | `j_mt2ltm8pb2uaz02tr` | ❌ Only sourceUrl — heal broke article-based markup compatibility |
| Post-heal CHANGED_PRICE | `j_mt2lr7q6o5b184fwq` | ❌ Only sourceUrl — same incompatibility |
| Post-heal CHANGED_PRICE retest | `j_mt2lsihz2aeq1goof2` | ❌ Only sourceUrl — confirmed |

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

**Critical finding:** Self-Heal adapted selectors to BROKEN_SELECTOR's table-based markup, breaking compatibility with article-based markup (HEALTHY/CHANGED_PRICE). The healed collector works ONLY against the markup it was healed for.

**Design implication:** The demo must account for this. After BROKEN_SELECTOR → heal → recovery, the demo can only use BROKEN_SELECTOR-compatible variants for the CHANGED_PRICE contrast. Alternatively, the operator must revert the collector selectors to article-based after the BROKEN_SELECTOR demo.

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

### Successful Path

```
HEALTHY → SUSPECT → QUARANTINED → HEALING → AWAITING_APPROVAL → VERIFIED → HEALTHY
```

### Failed Path

```
HEALING → FAILED
AWAITING_APPROVAL → FAILED
```

### State Definitions

| State | Meaning |
|-------|---------|
| HEALTHY | Last extraction successful, contract is valid |
| SUSPECT | Initial extraction failure / retry in progress |
| QUARANTINED | Retry exhausted, persistent EXTRACTION_DRIFT |
| HEALING | Operator is repairing collector in Bright Data |
| AWAITING_APPROVAL | Post-heal run is schema-valid AND semantic verification passed |
| VERIFIED | Repair approved |
| FAILED | Repair rejected (semantic mismatch) or repair invalid |

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

## Pure Core APIs

```typescript
// packages/core/src/healing.ts

function isHealingEligible(input: { driftType: DriftType; reasonCodes: string[] }): boolean {
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

**Option 1 (preferred — requires collector revert):**
1. HEALTHY baseline established
2. Operator reverts Bright Data collector selectors to article-based
3. Switch to CHANGED_PRICE ($6 input)
4. Real Bright Data run succeeds (valid extraction)
5. SEMANTIC_DRIFT classified (pricing.inputPrice 4 → 6)
6. ZERO heal attempts
7. No quarantine
8. Contract updated with $6
9. Distinction proven: we repair broken extraction, not real facts

**Option 2 (no revert — collector stays table-based):**
1. BROKEN_SELECTOR healed → collector works with table-based
2. Switch to a table-based CHANGED_PRICE variant (would need to be created)
3. Real Bright Data run succeeds (valid extraction, $6 price)
4. SEMANTIC_DRIFT classified
5. ZERO heal attempts
6. Distinction proven

**Note:** The current CHANGED_PRICE variant uses article-based markup, which is incompatible with the healed (table-based) collector. The demo operator must choose one of these options.

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
