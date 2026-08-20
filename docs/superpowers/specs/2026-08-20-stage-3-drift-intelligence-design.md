# Stage 3 — Drift Intelligence Design Specification

**Date:** 2026-08-20
**Branch:** `feat/stage-3-drift-intelligence`
**Status:** FROZEN — do not modify after this commit

---

## 1. Goal

Given a previous valid `ModelContract` and a new observation/run, determine what kind of drift occurred. The classifier must structurally enforce the critical invariant:

```
EXTRACTION_DRIFT ≠ SEMANTIC_DRIFT
```

A broken extraction that yields null/missing fields must never be classified as a semantic price change. An unsafe value like "Contact sales" must never be fabricated into a number or treated as an extraction failure.

---

## 2. Scope

### Stage 3 MAY implement

- Pure drift classifier (`classifyDrift`)
- Field-level semantic diff (`semanticDiff`)
- Machine-readable reason codes (`ReasonCode`)
- Minimal `DriftEvent` persistence (Prisma entity)
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

The classifier may **consume** evidence such as `retryExhausted`, but must not own retry orchestration.

---

## 3. DriftType Taxology

Defined in `packages/core/src/drift.ts` (existing, unchanged):

```ts
export type DriftType =
  | "NO_DRIFT"
  | "TRANSIENT_FAILURE"
  | "EXTRACTION_DRIFT"
  | "SEMANTIC_DRIFT"
  | "AMBIGUOUS_DRIFT";
```

| Type | Meaning |
|------|---------|
| `NO_DRIFT` | Semantic hash unchanged, or first observation (baseline) |
| `TRANSIENT_FAILURE` | Collection/network failure before any extraction data exists |
| `EXTRACTION_DRIFT` | Extraction produced invalid/missing data (broken selector, absent element) |
| `SEMANTIC_DRIFT` | Extraction succeeded but normalized semantic values changed |
| `AMBIGUOUS_DRIFT` | Field present but unparseable (e.g., "Contact sales" for inputPrice) |

---

## 4. ReasonCode Taxology

Defined in `packages/core/src/drift.ts` (extended):

```ts
export type ReasonCode =
  | "BASELINE_ESTABLISHED"
  | "SEMANTIC_HASH_UNCHANGED"
  | "SEMANTIC_FIELD_CHANGED"
  | "REQUIRED_FIELD_MISSING"
  | "UNSAFE_VALUE"
  | "COLLECTION_FAILED"
  | "EXTRACTION_VALIDATION_FAILED";
```

| Code | Meaning | Used by |
|------|---------|---------|
| `BASELINE_ESTABLISHED` | First observation, no previous contract | NO_DRIFT |
| `SEMANTIC_HASH_UNCHANGED` | Same hash after normalization | NO_DRIFT |
| `SEMANTIC_FIELD_CHANGED` | Specific field value changed | SEMANTIC_DRIFT |
| `REQUIRED_FIELD_MISSING` | Field absent from raw extraction | EXTRACTION_DRIFT |
| `UNSAFE_VALUE` | Field present but unnormalizeable | AMBIGUOUS_DRIFT |
| `COLLECTION_FAILED` | Collection/network/timeout failure | TRANSIENT_FAILURE |
| `EXTRACTION_VALIDATION_FAILED` | Structural validation failed on normalized data | EXTRACTION_DRIFT |

Stage 4 may add: `RETRY_EXHAUSTED`, `HEAL_ATTEMPTED`, `HEAL_VERIFIED`, `HEAL_FAILED`.

---

## 5. ObservationEvidence

Built by the ingestion pipeline during normalization. Passed to the classifier so it never needs to re-normalize.

```ts
export type ObservationEvidence = {
  /** Collection run itself failed (network, timeout, 5xx). No extraction data exists. */
  collectionFailed: boolean;
  /** Retry policy exhausted. Context only — does not determine drift type. */
  retryExhausted: boolean;
  /** Whether the normalized candidate passed schema validation. */
  schemaValid: boolean;
  /**
   * Fields that WERE PRESENT in the raw observation but could NOT be safely
   * normalized (e.g., inputPrice = "Contact sales").
   * Field names use dotted paths: "pricing.inputPrice".
   */
  unsafeFields: string[];
  /**
   * Required fields that were ABSENT from the raw observation
   * (e.g., selector broke, element removed).
   */
  missingFields: string[];
  /** Raw validation errors from validateCandidate (when candidate was built). */
  validationErrors: string[];
};
```

**Invariant:** `unsafeFields` and `missingFields` are mutually exclusive for any given field. A field cannot be both present-and-unsafe AND absent.

---

## 6. DriftInput

```ts
export type DriftInput = {
  /** Previous healthy contract, or null if first observation for this model. */
  previousContract: ModelContract | null;
  /**
   * The normalized candidate. Built only when ALL normalizations succeed.
   * Null when normalization failed (unsafe value or missing field) or
   * when collection failed entirely.
   */
  candidate: CandidateObservation | null;
  /** Evidence from the ingestion pipeline. */
  evidence: ObservationEvidence;
};
```

Key design decision: `candidate` is nullable. EXTRACTION_DRIFT, AMBIGUOUS_DRIFT, and TRANSIENT_FAILURE cases may not have a valid `CandidateObservation`. The classifier uses `evidence` to determine the drift type when `candidate` is null.

---

## 7. DriftDecision

```ts
export type DriftDecision = {
  driftType: DriftType;
  /** Machine-readable reason codes. Stable across stages. */
  reasonCodes: ReasonCode[];
  /** Human-readable explanations for debugging/demo. */
  explanations: string[];
  /** Field-level diffs. Populated ONLY for SEMANTIC_DRIFT. Empty array otherwise. */
  fieldDiffs: SemanticFieldDiff[];
  /** Semantic hash of the previous contract (null if first observation). */
  previousHash: string | null;
  /** Semantic hash of the new candidate (null if candidate is null). */
  currentHash: string | null;
};
```

---

## 8. Classification Precedence

The classifier evaluates conditions in this exact order. The first match wins.

```
1. evidence.collectionFailed === true
   → TRANSIENT_FAILURE
   reasonCodes: ["COLLECTION_FAILED"]
   candidate: null, currentHash: null

2. evidence.unsafeFields.length > 0
   → AMBIGUOUS_DRIFT
   reasonCodes: ["UNSAFE_VALUE"]
   explanations: list each unsafe field + its raw value
   candidate: null, currentHash: null

3. evidence.missingFields.length > 0
   → EXTRACTION_DRIFT
   reasonCodes: ["REQUIRED_FIELD_MISSING"]
   explanations: list each missing field
   candidate: null, currentHash: null

4. evidence.schemaValid === false
   → EXTRACTION_DRIFT
   reasonCodes: ["EXTRACTION_VALIDATION_FAILED"]
   explanations: list validation errors
   candidate: null or valid (but not promoted), currentHash: null

5. previousContract === null
   → NO_DRIFT
   reasonCodes: ["BASELINE_ESTABLISHED"]
   currentHash: semanticHash(candidate)

6. previousContract !== null
   AND semanticHash(candidate) === previousContract.semanticHash
   → NO_DRIFT
   reasonCodes: ["SEMANTIC_HASH_UNCHANGED"]
   currentHash: same as previousHash

7. previousContract !== null
   AND semanticHash(candidate) !== previousContract.semanticHash
   → SEMANTIC_DRIFT
   reasonCodes: ["SEMANTIC_FIELD_CHANGED"]
   fieldDiffs: semanticDiff(previousSemanticFields, currentSemanticFields)
   currentHash: semanticHash(candidate)
```

### Why this order is correct

- **Step 1** catches collection failure before any extraction logic. No data exists.
- **Step 2** catches "Contact sales" — field present, unparseable. This is NOT extraction failure.
- **Step 3** catches missing selector — field absent. This IS extraction failure.
- **Step 4** catches validation failures on already-normalized data (e.g., structural issues in the candidate object).
- **Steps 5–7** only run when extraction succeeded. Hash comparison is safe.

### Why AMBIGUOUS_DRIFT cannot be swallowed by EXTRACTION_DRIFT

Step 2 (unsafeFields) precedes step 3 (missingFields). If `inputPrice` is "Contact sales" (unsafe) AND `outputPrice` is missing, the AMBIGUOUS_DRIFT diagnosis for `inputPrice` takes precedence. This is correct: ambiguity is the more specific failure — the scraper found text but couldn't parse it, which is a different problem than the element being absent.

### retryExhausted is context, not a type

`retryExhausted` does not appear in `reasonCodes` in Stage 3. It is context only:

- `collectionFailed + retryExhausted` → TRANSIENT_FAILURE (step 1)
- `extraction failure + retryExhausted` → EXTRACTION_DRIFT (step 3 or 4)
- `ambiguous value + retryExhausted` → AMBIGUOUS_DRIFT (step 2)

Stage 4 will use `retryExhausted` to decide whether to quarantine.

---

## 9. Semantic Diff Contract

### Function signature

```ts
// packages/core/src/semantic-diff.ts

import type { SemanticFields } from "./semantic-hash";

export type SemanticFieldDiff = {
  field: string;
  previous: unknown;
  current: unknown;
};

export function semanticDiff(
  previous: SemanticFields,
  current: SemanticFields,
): SemanticFieldDiff[];
```

### Canonical field order

Explicitly defined, matching `semanticHashOf` serialization order:

```ts
const CANONICAL_FIELDS: readonly (keyof SemanticFields)[] = [
  "provider",
  "modelId",
  "status",
  "contextWindow",
  "inputPrice",
  "outputPrice",
  "deprecationDate",
] as const;
```

### Behavior

- Iterates `CANONICAL_FIELDS` in order
- Compares `previous[field] !== current[field]` (strict equality, all primitives)
- Reports only fields that changed
- `undefined` → value transitions reported (field added)
- Value → `undefined` transitions reported (field removed)
- Output order matches `CANONICAL_FIELDS` order — deterministic
- Provenance excluded (SemanticFields already excludes it)
- Invalid extractions: `semanticDiff` is never called; classifier sets `fieldDiffs: []`

### Determinism proof

- `CANONICAL_FIELDS` is a fixed tuple
- All `SemanticFields` values are primitives: `string | number | undefined`
- No floating-point comparison — values are already normalized integers/strings
- `undefined` vs `null` normalization: diff uses `null` in output for missing values (`previous: prev ?? null, current: curr ?? null`)

---

## 10. DriftEvent Prisma Schema

```prisma
model DriftEvent {
  id                  String     @id @default(cuid())
  modelRecordId       String
  observationId       String?
  previousContractId  String?
  driftType           String
  reasonCodes         Json
  explanations        Json
  fieldDiffs          Json
  previousHash        String?
  currentHash         String?
  createdAt           DateTime   @default(now())

  model               Model       @relation(fields: [modelRecordId], references: [id], onDelete: Cascade)
  observation         Observation? @relation(fields: [observationId], references: [id], onDelete: SetNull)
  previousContract    Contract?   @relation("PreviousContractDriftEvents", fields: [previousContractId], references: [id], onDelete: SetNull)

  @@index([modelRecordId])
  @@index([driftType])
  @@index([createdAt])
  @@unique([observationId])
}
```

### Relation additions to existing models

```prisma
model Model {
  // ... existing fields ...
  driftEvents  DriftEvent[]
}

model Contract {
  // ... existing fields ...
  previousDriftEvents DriftEvent[] @relation("PreviousContractDriftEvents")
}

model Observation {
  // ... existing fields ...
  driftEvent DriftEvent?
}
```

### Field semantics

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | String | no | cuid primary key |
| `modelRecordId` | String | no | FK → Model.id (the DB record, not the domain modelId string) |
| `observationId` | String? | yes | FK → Observation.id. Null for TRANSIENT_FAILURE where no observation exists. `@unique` ensures one Observation produces at most one DriftEvent. Multiple NULLs permitted (multiple TRANSIENT_FAILUREs). |
| `previousContractId` | String? | yes | FK → Contract.id. Null on baseline (first observation). `onDelete: SetNull` preserves DriftEvent if Contract is deleted. |
| `driftType` | String | no | DriftType enum value |
| `reasonCodes` | Json | no | `string[]` — machine-readable reason codes |
| `explanations` | Json | no | `string[]` — human-readable explanations |
| `fieldDiffs` | Json | no | `SemanticFieldDiff[]` — empty for non-SEMANTIC types |
| `previousHash` | String? | yes | Semantic hash before (null on baseline) |
| `currentHash` | String? | yes | Semantic hash after (null if extraction failed) |
| `createdAt` | DateTime | no | Default `now()` |

### Naming rationale

- `modelRecordId`: Unambiguous FK to `Model.id` (cuid), distinct from domain-level `modelId` ("claude-fable-5"). Existing tables (Contract, Observation) use `modelId` for this FK, which is confusing. DriftEvent uses `modelRecordId` for clarity.
- `previousContractId`: Named to indicate this is the contract that existed BEFORE the drift event, not the contract after.
- `observationId` nullable + `@unique`: PostgreSQL allows multiple NULLs in a unique column. This means multiple TRANSIENT_FAILURE events (no observation) are permitted, but a real Observation can have at most one DriftEvent.

### No Stage 4 fields

The schema deliberately omits: `confidence`, `status`, `resolution`, `healAttemptId`. These belong to Stage 4 quarantine/healing.

---

## 11. Ingest / Classify / Promote Ordering

### Pipeline steps

```
1.  provider.upsert                              (idempotent, outside transaction)
2.  model.upsert                                 (idempotent, outside transaction)
3.  collectorVersion.upsert                      (idempotent, outside transaction)
4.  BEGIN TRANSACTION
5.    previousContract = contract.findUnique(modelId)
6.    normalize raw fields → track unsafeFields, missingFields
7.    if all normalizations OK → build candidate → validateCandidate → track schemaValid
8.    hash = semanticHash(candidate) if valid
9.    observation.create(rawPayload, normalizedPayload, schemaValid, ...)
10.   driftDecision = classifyDrift({ previousContract, candidate, evidence })
11.   driftEvent.create(driftDecision fields)
12.   if schemaValid AND driftType is NOT extraction/ambiguous/transient
       → contract.upsert(new semantics)
13. COMMIT TRANSACTION
```

### Promotion guard (step 12)

```ts
const shouldPromote =
  schemaValid &&
  candidate !== null &&
  decision.driftType !== "EXTRACTION_DRIFT" &&
  decision.driftType !== "AMBIGUOUS_DRIFT" &&
  decision.driftType !== "TRANSIENT_FAILURE";
```

- `EXTRACTION_DRIFT` → invalid extraction, must NOT overwrite valid contract
- `AMBIGUOUS_DRIFT` → unsafe values, must NOT overwrite valid contract
- `TRANSIENT_FAILURE` → no observation data, must NOT overwrite valid contract
- `SEMANTIC_DRIFT` → valid observation with real change, MUST promote
- `NO_DRIFT` → valid observation, MUST promote (keeps contract current with fresh provenance)

### Proof: $4 → $6 cannot compare against already-promoted $6

The `previousContract` is loaded at step 5, inside the transaction. The contract is only upserted at step 12, AFTER classification at step 10. The classifier uses the `previousContract` from step 5, not the database state after promotion. The contract promotion happens last, after the DriftEvent is persisted. Even if a concurrent ingestion promotes a different contract, our transaction's `previousContract` reference is fixed at load time.

---

## 12. Transaction Consistency Guarantee

### What the transaction prevents

1. **Contract promoted but DriftEvent missing** → impossible (same transaction)
2. **DriftEvent persisted while Observation failed** → impossible (Observation created first in same transaction)
3. **Invalid extraction overwrites valid contract** → impossible (step 12 guard)
4. **Partial writes** → impossible (Prisma `$transaction` rolls back on any error)

### What the transaction does NOT prevent

Concurrent same-model ingestion races. If two observations for the same model arrive simultaneously:

```
Tx1: load previous ($4) → classify → promote ($6)
Tx2: load previous ($4) → classify → promote ($8)
```

Both Tx1 and Tx2 see the same previous contract ($4). Both classify correctly. Both promote. The final contract depends on commit order — Tx2's $8 wins if it commits last. This is acceptable: both classifications are correct relative to the $4 baseline, and the final contract reflects the most recent valid observation.

### Concurrency position

Concurrent same-model ingestion is a **non-goal** for Stage 3. The system is single-ingestion-path (Bright Data collector runs sequentially). Adding distributed locks or queues is out of scope.

### Optional hardening (not Stage 3 scope)

Prisma supports transaction isolation options. If `SERIALIZABLE` isolation is needed later, it can be added:

```ts
await db.$transaction(async (tx) => { ... }, {
  isolationLevel: "Serializable",
});
```

This is mentioned for awareness, not required for Stage 3.

---

## 13. Acceptance Matrix

| # | Previous | Current | driftType | reasonCodes | fieldDiffs |
|---|----------|---------|-----------|-------------|------------|
| 1 | HEALTHY (active, $4) | HEALTHY (active, $4) | `NO_DRIFT` | `["SEMANTIC_HASH_UNCHANGED"]` | `[]` |
| 2 | null (no contract) | HEALTHY (active, $4) | `NO_DRIFT` | `["BASELINE_ESTABLISHED"]` | `[]` |
| 3 | HEALTHY (active, $4) | CHANGED_PRICE (active, $6) | `SEMANTIC_DRIFT` | `["SEMANTIC_FIELD_CHANGED"]` | `[{field:"pricing.inputPrice", previous:4, current:6}]` |
| 4 | HEALTHY (active, $4) | DEPRECATED (deprecated, $4) | `SEMANTIC_DRIFT` | `["SEMANTIC_FIELD_CHANGED"]` | `[{field:"status", previous:"active", current:"deprecated"}]` |
| 5 | HEALTHY (active, $4) | BROKEN_SELECTOR (extraction fails) | `EXTRACTION_DRIFT` | `["REQUIRED_FIELD_MISSING"]` | `[]` |
| 6 | HEALTHY (active, $4) | MISSING_FIELD (inputPrice absent) | `EXTRACTION_DRIFT` | `["REQUIRED_FIELD_MISSING"]` | `[]` |
| 7 | HEALTHY (active, $4) | AMBIGUOUS ("Contact sales") | `AMBIGUOUS_DRIFT` | `["UNSAFE_VALUE"]` | `[]` |
| 8 | any valid | simulated collection failure | `TRANSIENT_FAILURE` | `["COLLECTION_FAILED"]` | `[]` |
| 9 | any valid | collection failure + retry exhausted | `TRANSIENT_FAILURE` | `["COLLECTION_FAILED"]` | `[]` |
| 10 | HEALTHY (active, $4) | extraction failure + retry exhausted | `EXTRACTION_DRIFT` | `["REQUIRED_FIELD_MISSING"]` | `[]` |
| 11 | HEALTHY (active, $4) | provenance-only change (different observedAt) | `NO_DRIFT` | `["SEMANTIC_HASH_UNCHANGED"]` | `[]` |
| 12 | HEALTHY (active, $4) | "Contact sales" + retry exhausted | `AMBIGUOUS_DRIFT` | `["UNSAFE_VALUE"]` | `[]` |
| 13 | HEALTHY (active, $4, output=$12) | output $12 → $15 | `SEMANTIC_DRIFT` | `["SEMANTIC_FIELD_CHANGED"]` | `[{field:"pricing.outputPrice", previous:12, current:15}]` |
| 14 | HEALTHY (active, $4) | validation error on normalized data | `EXTRACTION_DRIFT` | `["EXTRACTION_VALIDATION_FAILED"]` | `[]` |

### Critical invariant checks

- Row 6: `inputPrice` missing because selector broke → EXTRACTION_DRIFT, **never** SEMANTIC_DRIFT with "4 → null"
- Row 7: `inputPrice` = "Contact sales" → AMBIGUOUS_DRIFT, **never** EXTRACTION_DRIFT or fabricated number
- Row 11: provenance-only change → NO_DRIFT, **never** SEMANTIC_DRIFT

---

## 14. Stage 3 / Stage 4 Boundary

| Concern | Stage 3 | Stage 4 |
|---------|---------|---------|
| Drift classification | classifyDrift | — |
| Field-level semantic diff | semanticDiff | — |
| DriftEvent persistence | DriftEvent entity + persist | — |
| Reason codes / explanations | reasonCodes + explanations | — |
| Ingestion pipeline refactor | classify before promotion, transaction | — |
| Retry orchestration | — | retry before EXTRACTION_DRIFT |
| Quarantine / SUSPECT state | — | quarantine management |
| Healing (Bright Data repair) | — | collector repair |
| Repair verification | — | semantic verify after heal |
| Approve / reject repair | — | approval flow |
| HealAttempt entity | — | persistence |
| Health state transitions | — | HEALTHY → SUSPECT → QUARANTINED → HEALING → VERIFIED |
| Compatibility policies | — | Stage 6 |
| Judge UI | — | Stage 7 |

---

## 15. Test Requirements

### Unit tests: `tests/unit/semantic-diff.test.ts`

1. Returns empty array when semantic fields are identical
2. Returns one diff when inputPrice changes ($4 → $6)
3. Returns one diff when status changes (active → deprecated)
4. Returns multiple diffs when multiple fields change
5. Handles undefined → value transitions (missing → present)
6. Handles value → undefined transitions (present → missing)
7. Output order matches canonical field order
8. Deterministic — same inputs always produce same output

### Unit tests: `tests/unit/classify-drift.test.ts`

1. NO_DRIFT: same semantic hash → NO_DRIFT with SEMANTIC_HASH_UNCHANGED
2. NO_DRIFT: provenance-only change → NO_DRIFT (observedAt, collectorId differ)
3. NO_DRIFT: first observation (previousContract null) → NO_DRIFT with BASELINE_ESTABLISHED
4. SEMANTIC_DRIFT: $4 → $6 → SEMANTIC_DRIFT with fieldDiffs containing pricing.inputPrice
5. SEMANTIC_DRIFT: active → deprecated → SEMANTIC_DRIFT with fieldDiffs containing status
6. EXTRACTION_DRIFT: schemaInvalid=true → EXTRACTION_DRIFT (never reaches semantic comparison)
7. EXTRACTION_DRIFT: missingFields non-empty → EXTRACTION_DRIFT (4→null is NOT SEMANTIC_DRIFT)
8. AMBIGUOUS_DRIFT: unsafeFields non-empty → AMBIGUOUS_DRIFT
9. TRANSIENT_FAILURE: collectionFailed=true → TRANSIENT_FAILURE
10. TRANSIENT_FAILURE: collectionFailed + retryExhausted → TRANSIENT_FAILURE
11. EXTRACTION_DRIFT + retryExhausted → EXTRACTION_DRIFT (not TRANSIENT_FAILURE)
12. AMBIGUOUS_DRIFT + retryExhausted → AMBIGUOUS_DRIFT (not TRANSIENT_FAILURE)
13. Invalid observation never produces SEMANTIC_DRIFT (critical invariant)
14. Multi-field diff: both inputPrice and outputPrice change → two diffs in canonical order

### Integration tests: `tests/integration/drift-classification.test.ts`

1. Provider variant matrix: each variant pair produces expected classification
2. Full ingest → classify → persist DriftEvent round-trip with fakePrisma
3. DriftEvent has correct fieldDiffs for CHANGED_PRICE variant
4. DriftEvent has empty fieldDiffs for NO_DRIFT
5. DriftEvent has correct fieldDiffs for DEPRECATED variant
6. DriftEvent has nullable observationId=null for TRANSIENT_FAILURE
7. Contract NOT promoted for EXTRACTION_DRIFT
8. Contract NOT promoted for AMBIGUOUS_DRIFT
9. Contract promoted for SEMANTIC_DRIFT
10. Contract promoted for NO_DRIFT (baseline)

### Regression tests: `tests/integration/observation-ingestion.test.ts` (updated)

1. Existing tests continue to pass (backward compatible)
2. DriftEvent is persisted for every ingestion
3. IngestResult includes driftType and driftEventId
4. Previous $4 contract is NOT overwritten by $6 observation's DriftEvent (promotion order)

---

## 16. Files Expected to Change

| File | Change |
|------|--------|
| `packages/core/src/drift.ts` | Add `ReasonCode` type |
| `packages/core/src/semantic-diff.ts` | **NEW** — `SemanticFieldDiff` type + `semanticDiff` function |
| `packages/core/src/classify-drift.ts` | **NEW** — `ObservationEvidence`, `DriftInput`, `DriftDecision`, `classifyDrift` |
| `packages/core/src/index.ts` | Export new modules |
| `packages/db/prisma/schema.prisma` | Add `DriftEvent` model + relation fields on Model, Contract, Observation |
| `apps/web/lib/ingest.ts` | Refactor: load previous contract first, normalize+evidence, classify before promotion, persist DriftEvent in transaction |
| `tests/helpers/fake-prisma.ts` | Add `driftEvent` delegate + `$transaction` support + `__driftEvents` accessor |
| `tests/unit/semantic-diff.test.ts` | **NEW** — 8 deterministic diff tests |
| `tests/unit/classify-drift.test.ts` | **NEW** — 14 unit tests for all drift types + invariants |
| `tests/integration/drift-classification.test.ts` | **NEW** — variant matrix + full round-trip (10 tests) |
| `tests/integration/observation-ingestion.test.ts` | Update: verify DriftEvent persisted, verify promotion order (4 new tests) |
