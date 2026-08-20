# Stage 3 - Drift Intelligence Implementation Plan

**Date:** 2026-08-20
**Branch:** feat/stage-3-drift-intelligence
**Spec:** docs/superpowers/specs/2026-08-20-stage-3-drift-intelligence-design.md
**Method:** TDD - failing test first, minimum implementation, passing verification

---

## TASK 1: ReasonCode + semanticDiff

**Goal:** Add ReasonCode type and implement semanticDiff with dotted ModelContract paths.

**Files:** packages/core/src/drift.ts, packages/core/src/semantic-diff.ts (new), packages/core/src/index.ts, tests/unit/semantic-diff.test.ts (new)

**Tests:** 8 unit tests asserting dotted paths (pricing.inputPrice, pricing.outputPrice, status).

**Commit:** feat: add ReasonCode type and semanticDiff with dotted field paths

---

## TASK 2: classifyDrift pure classifier

**Files:** packages/core/src/classify-drift.ts (new), packages/core/src/index.ts, tests/unit/classify-drift.test.ts (new)

**Tests:** 14 unit tests. fieldDiff assertions use dotted paths.

**Commit:** feat: implement pure drift classifier with classification precedence

---

## TASK 3: DriftEvent Prisma schema + migration

**Files:** packages/db/prisma/schema.prisma

**Steps:** Add DriftEvent model + reverse relations. Generate migration.

**Commit:** feat: add DriftEvent schema with relations

---

## TASK 4: fake-prisma transaction with snapshot/rollback + DriftEvent

**Files:** tests/helpers/fake-prisma.ts

**Steps:**  with snapshot/restore of observations, contracts, driftEvents. Add driftEvent delegate.

**Commit:** feat: extend fake-prisma with DriftEvent,  rollback

---

## TASK 5: ingest refactor + recordCollectionFailure

**Files:** apps/web/lib/ingest.ts, tests/integration/observation-ingestion.test.ts

**Tests:** HEALTHY->HEALTHY baseline regression, identity fix, rollback, DriftEvent persistence.

**Key changes:**
- contractRowToModelContract(row, provider, modelId) accepts domain identity
- : load previous -> normalize -> observe -> classify -> driftEvent -> promote
- recordCollectionFailure: separate function, observationId=null, no Observation, no promotion

**Commit:** feat: refactor ingestion to classify before promotion with collection failure support

---

## TASK 6: Deterministic provider variant integration matrix

**Files:** tests/integration/drift-classification.test.ts (new)

**Tests:** 12 tests including variant matrix, round-trip, fieldDiffs with dotted paths, collection failure, rollback.

**Commit:** test: add provider variant drift classification matrix

---

## TASK 7: Transaction / invalid-promotion regression + HEALTHY->HEALTHY

**Files:** tests/integration/observation-ingestion.test.ts

**Tests:** 6 tests: DriftEvent always persisted, promotion order, HEALTHY->HEALTHY previousHash===currentHash, identity correct, rollback.

**Commit:** test: add regression coverage for identity, rollback, and baseline

---

## TASK 8: Full Stage 3 verification + DB acceptance

**Verification:** pnpm test, pnpm typecheck, pnpm lint, pnpm build

**DB acceptance:** prisma generate, prisma migrate deploy, prisma migrate status. Never print DATABASE_URL.

**Classification proof:** HEALTHY baseline->NO_DRIFT, HEALTHY again->NO_DRIFT, CHANGED_PRICE->SEMANTIC_DRIFT, AMBIGUOUS->AMBIGUOUS_DRIFT, MISSING_FIELD->EXTRACTION_DRIFT.

No healing. No Stage 4 work.

---

## Summary

| Task | Description | Tests | Commit |
|------|-------------|-------|--------|
| 1 | ReasonCode + semanticDiff | 8 unit | feat: add ReasonCode type and semanticDiff with dotted field paths |
| 2 | classifyDrift classifier | 14 unit | feat: implement pure drift classifier |
| 3 | DriftEvent schema | migration | feat: add DriftEvent schema |
| 4 | fake-prisma rollback | 1 regression | feat: extend fake-prisma with rollback |
| 5 | ingest refactor + recordCollectionFailure | 6 integration | feat: refactor ingestion with collection failure |
| 6 | variant matrix | 12 integration | test: add variant drift matrix |
| 7 | regression coverage | 6 regression | test: add regression coverage |
| 8 | full verification + DB | - | (no commit if clean) |

**Total new tests:** ~53

**No Stage 4 work.** No healing, no quarantine, no compatibility, no judge UI.
