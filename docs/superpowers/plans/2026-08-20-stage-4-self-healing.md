# Stage 4 — Self-Healing Implementation Plan

## Prerequisites

- [x] Stage 3 complete (drift classification proven)
- [x] Real Bright Data break proven (BROKEN_SELECTOR)
- [x] Bright Data self-heal capability documented (UI-mediated)
- [x] Owner heals collector in Bright Data Scraper Studio (Self-Heal / AI Fix)
- [x] Post-heal verification succeeds (`scripts/post-heal-verify.ts` passes)
- [x] Collector refactored to support both layouts (HEALTHY + CHANGED_PRICE proven)
- [ ] Owner extracts `provider` and `modelId` attributes in Bright Data collector for BROKEN_SELECTOR

## Collector Regression Proof (2026-08-21)

The collector was refactored after the first repair regression. Results:

| Variant | Run ID | Status | provider | modelId | schemaValid | hash |
|---------|--------|--------|----------|---------|-------------|------|
| HEALTHY | `j_mt2mu5663ufen6dry` | ✅ | demo-ai | model-x | true | 81ac4862 |
| CHANGED_PRICE | `j_mt2muh76dzklvakgk` | ✅ | demo-ai | model-x | true | f3d45ec4 |
| BROKEN_SELECTOR | `j_mt2mtnys23ykwmrlh4` | ⚠️ | (missing) | (missing) | false | null |

**Remaining issue:** BROKEN_SELECTOR stores `provider` and `modelId` as HTML attributes (`data-provider`, `data-model`), not text content. The collector needs attribute extraction for these fields.

**HEALTHY canary:** ✅ Passes — proves no regression on article-based layout.
**CHANGED_PRICE:** ✅ Passes — SEMANTIC_DRIFT with correct fieldDiff.

## TASK 1: Pure Healing Rules + State Machine

**Files:**
- `packages/core/src/healing.ts` (new)
- `tests/unit/healing.test.ts` (new)

**TDD:**
1. Write tests for `isHealingEligible()`:
   - EXTRACTION_DRIFT + RETRY_EXHAUSTED → true
   - EXTRACTION_DRIFT without RETRY_EXHAUSTED → false
   - SEMANTIC_DRIFT → false
   - AMBIGUOUS_DRIFT → false
   - NO_DRIFT → false
   - TRANSIENT_FAILURE → false

2. Write tests for `verifyRepairCandidate()`:
   - matching hashes → true
   - different hashes → false

3. Write tests for `allowedHealthTransition()`:
   - HEALTHY → SUSPECT ✓
   - SUSPECT → QUARANTINED ✓
   - QUARANTINED → HEALING ✓
   - HEALING → AWAITING_APPROVAL ✓
   - AWAITING_APPROVAL → VERIFIED ✓
   - VERIFIED → HEALTHY ✓
   - HEALING → FAILED ✓
   - AWAITING_APPROVAL → FAILED ✓
   - Invalid transitions → false

4. Implement pure functions.

**Exit:** All unit tests pass. No DB, no fetch, no Bright Data.

---

## TASK 2: Observation Preparation Reuse

**Files:**
- `packages/core/src/prepare.ts` (new)
- `tests/unit/prepare.test.ts` (new)
- `apps/web/lib/ingest.ts` (modify — use prepareObservation)

**TDD:**
1. Write tests for `prepareObservation()`:
   - Valid raw observation → candidate, schemaValid=true
   - Missing required fields → missingFields populated
   - Unsafe values → unsafeFields populated
   - NOTE: Collection/run failure is NOT handled by prepareObservation — it operates only on actual returned RawObservation. Collection failure belongs to application orchestration and `recordCollectionFailure`.

2. Extract normalization logic from `ingestObservation` into `prepareObservation`.

3. Refactor `ingestObservation` to use `prepareObservation`.

4. Verify existing tests still pass (no regression).

**Exit:** One reusable pure function. No duplication.

---

## TASK 3: Model.healthState + HealAttempt Migration

**Files:**
- `packages/db/prisma/schema.prisma` (modify)
- `packages/db/prisma/migrations/20260820100000_stage4_healing/migration.sql` (new)

**Changes:**
1. Add `healthState String @default("HEALTHY")` to Model
2. Add HealAttempt model (as designed)
3. Add migration SQL
4. Run `prisma generate`

**Exit:** Schema valid. Migration artifact committed. Neon deployment deferred to Task 10 final acceptance.

---

## TASK 4: Fake-Prisma Support + Transaction Rollback

**Files:**
- `tests/helpers/fake-prisma.ts` (modify)
- `tests/unit/fake-prisma-rollback.test.ts` (modify or new test)

**Changes:**
1. Add HealAttempt to fake-prisma
2. Add Model.healthState to fake-prisma
3. Test $transaction rollback with HealAttempt

**Exit:** Fake-prisma supports all Stage 4 entities.

---

## TASK 5: Retry-Once Collection Orchestrator

**Files:**
- `apps/web/lib/collection.ts` (new)
- `tests/integration/collection-retry.test.ts` (new)

**TDD:**
1. Write tests for `collectWithRetry()`:
   - First run valid → ingest, no retry
   - First run invalid → retry once → valid → ingest
   - First run invalid → retry once → invalid → EXTRACTION_DRIFT
   - First run invalid → retry once → valid but different semantics → classify

2. Implement orchestrator using:
   - `runCollectorAndWait()` from Bright Data
   - `prepareObservation()` from Task 2
   - `ingestObservation()` for persistence

**Exit:** Retry-once works. No generic retry library.

---

## TASK 6: Quarantine + HealAttempt Orchestration

**Files:**
- `apps/web/lib/healing.ts` (new)
- `tests/integration/healing.test.ts` (new)

**TDD:**
1. Write tests for quarantine flow:
   - EXTRACTION_DRIFT + RETRY_EXHAUSTED → QUARANTINED → create HealAttempt
   - EXTRACTION_DRIFT without RETRY_EXHAUSTED → NOT quarantined (retry in progress)
   - healthState transitions correctly
   - HealAttempt persists with correct fields

2. Write tests for post-heal verification:
   - Valid candidate → semantic match → approve
   - Valid candidate → semantic mismatch → reject
   - Invalid candidate → reject

3. Implement orchestration.

**Exit:** Quarantine and verification work against fake-prisma.

---

## TASK 7: Post-Heal Verification + Approve/Reject

**Files:**
- `apps/web/lib/healing.ts` (extend)
- `tests/integration/healing.test.ts` (extend)

**TDD:**
1. Write tests for approve flow:
   - HealAttempt status → approved
   - healthState → VERIFIED → HEALTHY
   - Contract updated with new extraction

2. Write tests for reject flow:
   - HealAttempt status → rejected
   - healthState → FAILED
   - Contract remains previous valid

**Exit:** Full approve/reject cycle works.

---

## TASK 8: Semantic-Drift ZERO-Heal Regression

**Files:**
- `tests/integration/semantic-drift-no-heal.test.ts` (new)

**TDD:**
1. Write tests proving:
   - CHANGED_PRICE → SEMANTIC_DRIFT
   - HealAttempt count delta = 0
   - healthState does NOT enter QUARANTINED/HEALING
   - No Bright Data repair flow triggered

2. Same for DEPRECATED.

**Exit:** Semantic drift never triggers healing.

---

## TASK 9: Deterministic Full Stage 4 Integration

**Files:**
- `tests/integration/stage4-integration.test.ts` (new)

**TDD:**
1. Write deterministic integration test:
   - HEALTHY baseline
   - Simulate BROKEN_SELECTOR (missing fields)
   - Retry → still broken
   - EXTRACTION_DRIFT → QUARANTINED
   - Simulate healed extraction (valid fields)
   - Semantic match → approve → HEALTHY
   - Verify contract restored

2. Write failed-repair test:
   - Previous: inputPrice=4
   - Candidate: inputPrice=6 (valid but different)
   - semanticMatch=false → reject
   - healthState=FAILED
   - Contract remains 4

**Exit:** Full Stage 4 flow works deterministically.

---

## TASK 10: Real Neon + Bright Data Acceptance

**Files:**
- `tests/integration/stage4-acceptance.test.ts` (new)

**Prerequisites:**
- Owner has healed collector in Bright Data Scraper Studio (Self-Heal / AI Fix)
- Post-heal verification script (`scripts/post-heal-verify.ts`) passes
- NO simulation allowed — all evidence must be real Bright Data j_ runs

**TDD:**
1. Run real acceptance against Neon:
   - Set demo HEALTHY → baseline
   - Set demo BROKEN_SELECTOR → break
   - Real Bright Data run → EXTRACTION_DRIFT
   - Real Bright Data Self-Heal performed in Scraper Studio
   - Real Bright Data run → valid extraction
   - Semantic match → approve → HEALTHY
   - Repeat 3x consecutively

2. Apply Stage 4 migration to Neon
3. Run CHANGED_PRICE contrast:
   - Set demo CHANGED_PRICE
   - Real Bright Data run → SEMANTIC_DRIFT
   - HealAttempt count = 0
   - No quarantine, no healing

**Exit:** 3x consecutive demo passes. Stage 4 gate met.

---

## Commit Sequence

After each task:
1. Commit test first (red)
2. Commit implementation (green)
3. Commit refactor if needed

Final commits:
- `feat: pure healing rules and state machine`
- `feat: reuse observation preparation`
- `feat: Model.healthState + HealAttempt migration`
- `feat: retry-once collection orchestrator`
- `feat: quarantine and HealAttempt orchestration`
- `feat: post-heal verification and approve/reject`
- `test: semantic-drift zero-heal regression`
- `test: deterministic Stage 4 integration`
- `test: real Neon + Bright Data acceptance`
