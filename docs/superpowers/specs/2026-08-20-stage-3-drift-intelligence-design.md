# Stage 3 — Drift Intelligence Design Specification

**Date:** 2026-08-20
**Branch:** feat/stage-3-drift-intelligence
**Status:** FROZEN — amend only for field-diff paths and collection-failure persistence

---

## 1. Goal

Given a previous valid ModelContract and a new observation/run, determine what kind of drift occurred. The classifier must structurally enforce:

EXTRACTION_DRIFT != SEMANTIC_DRIFT

---

## 2. Scope

### Stage 3 MAY implement

- Pure drift classifier (classifyDrift)
- Field-level semantic diff (semanticDiff)
- Machine-readable reason codes (ReasonCode)
- Minimal DriftEvent persistence (Prisma entity)
- Collection failure recording (recordCollectionFailure)
- Deterministic unit + integration tests
- Controlled provider variant tests
- Ingestion pipeline refactor (classify before promotion, transaction boundary)

### Stage 3 MUST NOT implement

- Bright Data healing / collector repair
- Collector repair orchestration
- Repair approval / rejection
- Repair verification
- Compatibility policies
- Judge UI
- Analytics
- Stage 4 quarantine / health state transitions
- Distributed locks or queues

---

## 3. DriftType Taxology

Defined in packages/core/src/drift.ts (existing, unchanged):

NO_DRIFT, TRANSIENT_FAILURE, EXTRACTION_DRIFT, SEMANTIC_DRIFT, AMBIGUOUS_DRIFT

---

## 4. ReasonCode Taxology

Defined in packages/core/src/drift.ts (extended):

BASELINE_ESTABLISHED, SEMANTIC_HASH_UNCHANGED, SEMANTIC_FIELD_CHANGED,
REQUIRED_FIELD_MISSING, UNSAFE_VALUE, COLLECTION_FAILED, EXTRACTION_VALIDATION_FAILED

Stage 4 may add: RETRY_EXHAUSTED, HEAL_ATTEMPTED, HEAL_VERIFIED, HEAL_FAILED.

---

## 5. ObservationEvidence

collectionFailed: boolean, retryExhausted: boolean, schemaValid: boolean,
unsafeFields: string[] (dotted paths), missingFields: string[] (dotted paths),
validationErrors: string[]

Invariant: unsafeFields and missingFields are mutually exclusive per field.

---

## 6. DriftInput

previousContract: ModelContract | null, candidate: CandidateObservation | null, evidence: ObservationEvidence

---

## 7. DriftDecision

driftType, reasonCodes, explanations, fieldDiffs, previousHash, currentHash

---

## 8. Classification Precedence

1. collectionFailed -> TRANSIENT_FAILURE
2. unsafeFields.length > 0 -> AMBIGUOUS_DRIFT
3. missingFields.length > 0 -> EXTRACTION_DRIFT
4. schemaValid === false -> EXTRACTION_DRIFT
5. previousContract === null -> NO_DRIFT (BASELINE_ESTABLISHED)
6. semanticHash unchanged -> NO_DRIFT (SEMANTIC_HASH_UNCHANGED)
7. semanticHash changed -> SEMANTIC_DRIFT

retryExhausted is context only, not a drift type.

---

## 9. Semantic Diff Contract

Canonical field order with external dotted paths:

| Internal key | External path |
|-------------|---------------|
| provider | provider |
| modelId | modelId |
| status | status |
| contextWindow | contextWindow |
| inputPrice | pricing.inputPrice |
| outputPrice | pricing.outputPrice |
| deprecationDate | deprecationDate |

Output uses dotted external paths. Provenance excluded. Invalid extractions: fieldDiffs = [].

---

## 10. DriftEvent Prisma Schema

model DriftEvent with: id, modelRecordId, observationId (nullable unique), previousContractId (nullable), driftType, reasonCodes (Json), explanations (Json), fieldDiffs (Json), previousHash, currentHash, createdAt.

Reverse relations on Model (driftEvents), Contract (previousDriftEvents via "PreviousContractDriftEvents"), Observation (driftEvent).

---

## 11. Ingest / Classify / Promote Ordering

### Previous contract identity

contractRowToModelContract MUST accept domain-level provider and modelId parameters. Empty identity causes false SEMANTIC_DRIFT on HEALTHY -> HEALTHY.

### Observation ingestion pipeline

1. provider.upsert (outside tx)
2. model.upsert (outside tx)
3. collectorVersion.upsert (outside tx)
4. BEGIN TRANSACTION
5. previousContract = contract.findUnique(modelId)
6. normalize -> track unsafeFields, missingFields
7. build candidate if valid -> validateCandidate
8. hash = semanticHash(candidate) if valid
9. observation.create(...)
10. driftDecision = classifyDrift(...)
11. driftEvent.create(...)
12. if shouldPromote -> contract.upsert(...)
13. COMMIT TRANSACTION

### Collection failure pipeline (TRANSIENT_FAILURE)

recordCollectionFailure(db, input): separate function.
Pipeline: upsert provider/model -> tx: load previous -> classifyDrift(collectionFailed=true) -> driftEvent.create(observationId=null).
Never creates Observation. Never promotes Contract.

---

## 12. Transaction Consistency

Prevents: Contract promoted but DriftEvent missing, partial writes, invalid extraction overwriting contract.
Does NOT prevent concurrent same-model races (non-goal).

---

## 13. Acceptance Matrix

| # | Previous | Current | driftType | fieldDiffs |
|---|----------|---------|-----------|------------|
| 1 | HEALTHY ($4) | HEALTHY ($4) | NO_DRIFT | [] |
| 2 | null | HEALTHY ($4) | NO_DRIFT | [] |
| 3 | HEALTHY ($4) | CHANGED_PRICE ($6) | SEMANTIC_DRIFT | [{field:"pricing.inputPrice", previous:4, current:6}] |
| 4 | HEALTHY ($4) | DEPRECATED | SEMANTIC_DRIFT | [{field:"status", previous:"active", current:"deprecated"}] |
| 5 | HEALTHY ($4) | BROKEN_SELECTOR | EXTRACTION_DRIFT | [] |
| 6 | HEALTHY ($4) | MISSING_FIELD | EXTRACTION_DRIFT | [] |
| 7 | HEALTHY ($4) | AMBIGUOUS | AMBIGUOUS_DRIFT | [] |
| 8 | any | collection failure | TRANSIENT_FAILURE | [] |
| 9 | any | collection + retry exhausted | TRANSIENT_FAILURE | [] |
| 10 | HEALTHY ($4) | extraction + retry exhausted | EXTRACTION_DRIFT | [] |
| 11 | HEALTHY ($4) | provenance-only change | NO_DRIFT | [] |
| 12 | HEALTHY ($4) | ambiguous + retry exhausted | AMBIGUOUS_DRIFT | [] |
| 13 | HEALTHY ($4, out=$12) | output $15 | SEMANTIC_DRIFT | [{field:"pricing.outputPrice", previous:12, current:15}] |
| 14 | HEALTHY ($4) | validation error | EXTRACTION_DRIFT | [] |

---

## 14. Stage 3 / Stage 4 Boundary

Stage 3: classifyDrift, semanticDiff, DriftEvent, recordCollectionFailure, ingestion refactor.
Stage 4: retry orchestration, quarantine, healing, repair verification, approval.
Stage 6: compatibility. Stage 7: judge UI.

---

## 15. Test Requirements

Unit semantic-diff.test.ts: 8 tests with dotted paths (pricing.inputPrice, pricing.outputPrice).
Unit classify-drift.test.ts: 14 tests covering all 5 drift types + invariants.
Integration drift-classification.test.ts: 12 tests including variant matrix, round-trip, collection failure, rollback.
Regression observation-ingestion.test.ts: 6 new tests including HEALTHY->HEALTHY baseline, identity fix, rollback.

---

## 16. Files Expected to Change

| File | Change |
|------|--------|
| packages/core/src/drift.ts | Add ReasonCode type |
| packages/core/src/semantic-diff.ts | NEW - SemanticFieldDiff + semanticDiff with dotted paths |
| packages/core/src/classify-drift.ts | NEW - ObservationEvidence, DriftInput, DriftDecision, classifyDrift |
| packages/core/src/index.ts | Export new modules |
| packages/db/prisma/schema.prisma | Add DriftEvent model + relations |
| apps/web/lib/ingest.ts | Refactor + recordCollectionFailure |
| tests/helpers/fake-prisma.ts | driftEvent + $transaction with snapshot/rollback |
| tests/unit/semantic-diff.test.ts | NEW - 8 tests |
| tests/unit/classify-drift.test.ts | NEW - 14 tests |
| tests/integration/drift-classification.test.ts | NEW - 12 tests |
| tests/integration/observation-ingestion.test.ts | 6 new regression tests |
