# Stage 3 — Drift Intelligence Implementation Plan

**Date:** 2026-08-20
**Branch:** `feat/stage-3-drift-intelligence`
**Spec:** `docs/superpowers/specs/2026-08-20-stage-3-drift-intelligence-design.md`
**Method:** TDD — failing test first, minimum implementation, passing verification

---

## TASK 1: ReasonCode + semanticDiff

### Goal
Add `ReasonCode` type to `drift.ts` and implement the pure `semanticDiff` function.

### Interfaces consumed
- `SemanticFields` from `packages/core/src/semantic-hash.ts`

### Interfaces produced
- `ReasonCode` type in `packages/core/src/drift.ts`
- `SemanticFieldDiff` type + `semanticDiff()` in `packages/core/src/semantic-diff.ts`

### Files
- `packages/core/src/drift.ts` (modify)
- `packages/core/src/semantic-diff.ts` (new)
- `packages/core/src/index.ts` (modify — add exports)
- `tests/unit/semantic-diff.test.ts` (new)

### Step 1: Write failing tests

Create `tests/unit/semantic-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { semanticDiff, type SemanticFieldDiff } from "../../packages/core/src/semantic-diff";
import type { SemanticFields } from "../../packages/core/src/semantic-hash";

function fields(overrides: Partial<SemanticFields> = {}): SemanticFields {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "active",
    contextWindow: 128000,
    inputPrice: 4,
    outputPrice: 12,
    ...overrides,
  };
}

describe("semanticDiff", () => {
  it("returns empty array when fields are identical", () => {
    expect(semanticDiff(fields(), fields())).toEqual([]);
  });

  it("returns one diff when inputPrice changes ($4 → $6)", () => {
    const diffs = semanticDiff(fields(), fields({ inputPrice: 6 }));
    expect(diffs).toEqual([
      { field: "inputPrice", previous: 4, current: 6 },
    ]);
  });

  it("returns one diff when status changes (active → deprecated)", () => {
    const diffs = semanticDiff(fields(), fields({ status: "deprecated" }));
    expect(diffs).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);
  });

  it("returns multiple diffs when multiple fields change", () => {
    const diffs = semanticDiff(fields(), fields({ inputPrice: 6, status: "deprecated" }));
    expect(diffs).toHaveLength(2);
    expect(diffs[0].field).toBe("status");     // canonical order: status before inputPrice
    expect(diffs[1].field).toBe("inputPrice");
  });

  it("handles undefined → value transitions", () => {
    const prev = fields({ deprecationDate: undefined });
    const curr = fields({ deprecationDate: "2027-03-01" });
    const diffs = semanticDiff(prev, curr);
    expect(diffs).toEqual([
      { field: "deprecationDate", previous: null, current: "2027-03-01" },
    ]);
  });

  it("handles value → undefined transitions", () => {
    const prev = fields({ contextWindow: 128000 });
    const curr = fields({ contextWindow: undefined });
    const diffs = semanticDiff(prev, curr);
    expect(diffs).toEqual([
      { field: "contextWindow", previous: 128000, current: null },
    ]);
  });

  it("output order matches canonical field order", () => {
    const prev = fields({ status: "active", inputPrice: 4, contextWindow: 128000 });
    const curr = fields({ status: "deprecated", inputPrice: 6, contextWindow: 256000 });
    const diffs = semanticDiff(prev, curr);
    expect(diffs.map((d) => d.field)).toEqual(["status", "contextWindow", "inputPrice"]);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = semanticDiff(fields(), fields({ inputPrice: 6 }));
    const b = semanticDiff(fields(), fields({ inputPrice: 6 }));
    expect(a).toEqual(b);
  });
});
```

Run: `pnpm vitest run tests/unit/semantic-diff.test.ts` — expect failures (module not found).

### Step 2: Add ReasonCode to drift.ts

Add to `packages/core/src/drift.ts`:

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

### Step 3: Implement semanticDiff

Create `packages/core/src/semantic-diff.ts`:

```ts
import type { SemanticFields } from "./semantic-hash";

export type SemanticFieldDiff = {
  field: string;
  previous: unknown;
  current: unknown;
};

const CANONICAL_FIELDS: readonly (keyof SemanticFields)[] = [
  "provider",
  "modelId",
  "status",
  "contextWindow",
  "inputPrice",
  "outputPrice",
  "deprecationDate",
] as const;

export function semanticDiff(
  previous: SemanticFields,
  current: SemanticFields,
): SemanticFieldDiff[] {
  const diffs: SemanticFieldDiff[] = [];
  for (const field of CANONICAL_FIELDS) {
    const prev = previous[field];
    const curr = current[field];
    if (prev !== curr) {
      diffs.push({ field, previous: prev ?? null, current: curr ?? null });
    }
  }
  return diffs;
}
```

### Step 4: Update index.ts exports

Add to `packages/core/src/index.ts`:

```ts
export * from "./semantic-diff";
```

### Step 5: Verify

Run: `pnpm vitest run tests/unit/semantic-diff.test.ts` — all 8 pass.
Run: `pnpm typecheck` — passes.

### Commit boundary

```
git add packages/core/src/drift.ts packages/core/src/semantic-diff.ts packages/core/src/index.ts tests/unit/semantic-diff.test.ts
git commit -m "feat: add ReasonCode type and semanticDiff function"
```

---

## TASK 2: classifyDrift pure classifier

### Goal
Implement the pure drift classifier that consumes `DriftInput` and produces `DriftDecision`.

### Interfaces consumed
- `SemanticFields`, `extractSemanticFields`, `semanticHash` from `packages/core/src/semantic-hash.ts`
- `SemanticFieldDiff`, `semanticDiff` from `packages/core/src/semantic-diff.ts`
- `DriftType`, `ReasonCode` from `packages/core/src/drift.ts`
- `CandidateObservation` from `packages/core/src/validate.ts`
- `ModelContract` from `packages/core/src/contract.ts`

### Interfaces produced
- `ObservationEvidence` type
- `DriftInput` type
- `DriftDecision` type
- `classifyDrift()` function
- All in `packages/core/src/classify-drift.ts`

### Files
- `packages/core/src/classify-drift.ts` (new)
- `packages/core/src/index.ts` (modify — add export)
- `tests/unit/classify-drift.test.ts` (new)

### Step 1: Write failing tests

Create `tests/unit/classify-drift.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyDrift,
  type DriftInput,
  type ObservationEvidence,
} from "../../packages/core/src/classify-drift";
import type { ModelContract } from "../../packages/core/src/contract";

const BASE_CONTRACT: ModelContract = {
  provider: "demo-ai",
  modelId: "model-x",
  status: "active",
  contextWindow: 128000,
  pricing: { inputPrice: 4, outputPrice: 12, currency: "USD", unit: "per_1m_tokens" },
  source: {
    url: "https://demo.example/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  },
  validation: { schemaValid: true, confidence: 0.99, warnings: [] },
};

const HEALTHY_CANDIDATE: DriftInput["candidate"] = {
  provider: "demo-ai",
  modelId: "model-x",
  status: "active",
  contextWindow: 128000,
  pricing: { inputPrice: 4, outputPrice: 12, currency: "USD", unit: "per_1m_tokens" },
  source: {
    url: "https://demo.example/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  },
};

function evidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    collectionFailed: false,
    retryExhausted: false,
    schemaValid: true,
    unsafeFields: [],
    missingFields: [],
    validationErrors: [],
    ...overrides,
  };
}

describe("classifyDrift", () => {
  it("NO_DRIFT: same hash → SEMANTIC_HASH_UNCHANGED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: HEALTHY_CANDIDATE,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.previousHash).toBe(result.currentHash);
  });

  it("NO_DRIFT: provenance-only change → SEMANTIC_HASH_UNCHANGED", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE,
      source: { ...HEALTHY_CANDIDATE!.source, observedAt: "2031-01-01T00:00:00.000Z" },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });

  it("NO_DRIFT: first observation → BASELINE_ESTABLISHED", () => {
    const result = classifyDrift({
      previousContract: null,
      candidate: HEALTHY_CANDIDATE,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("BASELINE_ESTABLISHED");
    expect(result.previousHash).toBeNull();
    expect(result.currentHash).toBeTruthy();
  });

  it("SEMANTIC_DRIFT: $4 → $6 with fieldDiff", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE,
      pricing: { ...HEALTHY_CANDIDATE!.pricing!, inputPrice: 6 },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_FIELD_CHANGED");
    expect(result.fieldDiffs).toEqual([
      { field: "inputPrice", previous: 4, current: 6 },
    ]);
  });

  it("SEMANTIC_DRIFT: active → deprecated with fieldDiff", () => {
    const candidate = { ...HEALTHY_CANDIDATE, status: "deprecated" as const };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);
  });

  it("EXTRACTION_DRIFT: schemaInvalid → EXTRACTION_VALIDATION_FAILED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, validationErrors: ["inputPrice required"] }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.reasonCodes).toContain("EXTRACTION_VALIDATION_FAILED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.currentHash).toBeNull();
  });

  it("EXTRACTION_DRIFT: missingFields → REQUIRED_FIELD_MISSING (4→null is NOT SEMANTIC_DRIFT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, missingFields: ["pricing.inputPrice"] }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.reasonCodes).toContain("REQUIRED_FIELD_MISSING");
    expect(result.driftType).not.toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("AMBIGUOUS_DRIFT: unsafeFields → UNSAFE_VALUE", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ schemaValid: false, unsafeFields: ["pricing.inputPrice"] }),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.reasonCodes).toContain("UNSAFE_VALUE");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("TRANSIENT_FAILURE: collectionFailed → COLLECTION_FAILED", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ collectionFailed: true, schemaValid: false }),
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
    expect(result.reasonCodes).toContain("COLLECTION_FAILED");
    expect(result.fieldDiffs).toEqual([]);
    expect(result.currentHash).toBeNull();
  });

  it("TRANSIENT_FAILURE: collectionFailed + retryExhausted → still TRANSIENT_FAILURE", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({ collectionFailed: true, retryExhausted: true, schemaValid: false }),
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
  });

  it("EXTRACTION_DRIFT + retryExhausted → EXTRACTION_DRIFT (not TRANSIENT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({
        retryExhausted: true,
        schemaValid: false,
        missingFields: ["pricing.inputPrice"],
      }),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.driftType).not.toBe("TRANSIENT_FAILURE");
  });

  it("AMBIGUOUS_DRIFT + retryExhausted → AMBIGUOUS_DRIFT (not TRANSIENT)", () => {
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate: null,
      evidence: evidence({
        retryExhausted: true,
        schemaValid: false,
        unsafeFields: ["pricing.inputPrice"],
      }),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.driftType).not.toBe("TRANSIENT_FAILURE");
  });

  it("critical invariant: invalid observation NEVER produces SEMANTIC_DRIFT", () => {
    const cases: DriftInput[] = [
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false, missingFields: ["pricing.inputPrice"] }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ schemaValid: false, unsafeFields: ["pricing.inputPrice"] }),
      },
      {
        previousContract: BASE_CONTRACT,
        candidate: null,
        evidence: evidence({ collectionFailed: true, schemaValid: false }),
      },
    ];
    for (const input of cases) {
      expect(classifyDrift(input).driftType).not.toBe("SEMANTIC_DRIFT");
    }
  });

  it("multi-field diff: inputPrice + outputPrice change in canonical order", () => {
    const candidate = {
      ...HEALTHY_CANDIDATE,
      pricing: { ...HEALTHY_CANDIDATE!.pricing!, inputPrice: 6, outputPrice: 15 },
    };
    const result = classifyDrift({
      previousContract: BASE_CONTRACT,
      candidate,
      evidence: evidence(),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs.map((d) => d.field)).toEqual(["inputPrice", "outputPrice"]);
  });
});
```

Run: `pnpm vitest run tests/unit/classify-drift.test.ts` — expect failures (module not found).

### Step 2: Implement classifyDrift

Create `packages/core/src/classify-drift.ts`:

```ts
import type { ModelContract } from "./contract";
import type { CandidateObservation } from "./validate";
import type { DriftType, ReasonCode } from "./drift";
import type { SemanticFieldDiff } from "./semantic-diff";
import { extractSemanticFields, semanticHash, semanticHashOf } from "./semantic-hash";
import { semanticDiff } from "./semantic-diff";

export type ObservationEvidence = {
  collectionFailed: boolean;
  retryExhausted: boolean;
  schemaValid: boolean;
  unsafeFields: string[];
  missingFields: string[];
  validationErrors: string[];
};

export type DriftInput = {
  previousContract: ModelContract | null;
  candidate: CandidateObservation | null;
  evidence: ObservationEvidence;
};

export type DriftDecision = {
  driftType: DriftType;
  reasonCodes: ReasonCode[];
  explanations: string[];
  fieldDiffs: SemanticFieldDiff[];
  previousHash: string | null;
  currentHash: string | null;
};

export function classifyDrift(input: DriftInput): DriftDecision {
  const { previousContract, candidate, evidence } = input;
  const previousHash = previousContract ? semanticHash(previousContract) : null;
  const currentHash = candidate ? semanticHash(candidate) : null;

  // Step 1: collection failure
  if (evidence.collectionFailed) {
    return {
      driftType: "TRANSIENT_FAILURE",
      reasonCodes: ["COLLECTION_FAILED"],
      explanations: ["collection run failed — network or timeout error"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 2: unsafe values (field present but unparseable)
  if (evidence.unsafeFields.length > 0) {
    return {
      driftType: "AMBIGUOUS_DRIFT",
      reasonCodes: ["UNSAFE_VALUE"],
      explanations: evidence.unsafeFields.map((f) => `${f} has unparseable value`),
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 3: missing fields (field absent from extraction)
  if (evidence.missingFields.length > 0) {
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["REQUIRED_FIELD_MISSING"],
      explanations: evidence.missingFields.map((f) => `${f} is missing from extraction`),
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 4: validation failure on normalized data
  if (!evidence.schemaValid) {
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["EXTRACTION_VALIDATION_FAILED"],
      explanations: evidence.validationErrors.length > 0
        ? evidence.validationErrors
        : ["schema validation failed"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Steps 5-7: valid candidate — compare semantic hashes
  if (!candidate) {
    // Should not reach here if evidence is consistent, but handle defensively
    return {
      driftType: "EXTRACTION_DRIFT",
      reasonCodes: ["EXTRACTION_VALIDATION_FAILED"],
      explanations: ["candidate is null despite schemaValid=true"],
      fieldDiffs: [],
      previousHash,
      currentHash: null,
    };
  }

  // Step 5: first observation (baseline)
  if (previousContract === null) {
    return {
      driftType: "NO_DRIFT",
      reasonCodes: ["BASELINE_ESTABLISHED"],
      explanations: ["first observation — baseline contract established"],
      fieldDiffs: [],
      previousHash: null,
      currentHash,
    };
  }

  const previousFields = extractSemanticFields(previousContract);
  const currentFields = extractSemanticFields(candidate);

  // Step 6: same semantic hash
  if (previousHash === currentHash) {
    return {
      driftType: "NO_DRIFT",
      reasonCodes: ["SEMANTIC_HASH_UNCHANGED"],
      explanations: ["semantic hash unchanged — only provenance changed"],
      fieldDiffs: [],
      previousHash,
      currentHash,
    };
  }

  // Step 7: different semantic values
  const diffs = semanticDiff(previousFields, currentFields);
  const explanations = diffs.map(
    (d) => `${d.field} changed: ${JSON.stringify(d.previous)} → ${JSON.stringify(d.current)}`,
  );

  return {
    driftType: "SEMANTIC_DRIFT",
    reasonCodes: ["SEMANTIC_FIELD_CHANGED"],
    explanations,
    fieldDiffs: diffs,
    previousHash,
    currentHash,
  };
}
```

### Step 3: Update index.ts

Add to `packages/core/src/index.ts`:

```ts
export * from "./classify-drift";
```

### Step 4: Verify

Run: `pnpm vitest run tests/unit/classify-drift.test.ts` — all 14 pass.
Run: `pnpm typecheck` — passes.

### Commit boundary

```
git add packages/core/src/classify-drift.ts packages/core/src/index.ts tests/unit/classify-drift.test.ts
git commit -m "feat: implement pure drift classifier with classification precedence"
```

---

## TASK 3: DriftEvent Prisma schema + migration

### Goal
Add the `DriftEvent` entity to the Prisma schema with correct relations.

### Interfaces consumed
- Existing `Model`, `Contract`, `Observation` models

### Interfaces produced
- Updated `schema.prisma` with `DriftEvent` model
- Migration SQL

### Files
- `packages/db/prisma/schema.prisma` (modify)
- `packages/db/prisma/migrations/` (new migration directory)

### Step 1: Update schema.prisma

Add to `packages/db/prisma/schema.prisma`:

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

Add reverse relations to existing models:

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

### Step 2: Generate migration

```bash
cd packages/db
pnpm prisma migrate dev --name stage_3_drift_event
```

### Step 3: Verify

Run: `pnpm prisma generate` — succeeds.
Run: `pnpm typecheck` — passes.
Run: `pnpm test` — existing tests still pass (no behavioral change yet).

### Commit boundary

```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add DriftEvent schema with relations to Model, Contract, Observation"
```

---

## TASK 4: fake-prisma transaction / DriftEvent support

### Goal
Extend `createFakeDb` to support `driftEvent` delegate, `$transaction`, and `__driftEvents` accessor.

### Interfaces consumed
- Current `createFakeDb()` from `tests/helpers/fake-prisma.ts`

### Interfaces produced
- Updated `createFakeDb()` with `driftEvent` delegate
- `$transaction` support (synchronous in-memory execution)
- `__driftEvents` accessor on FakeDb

### Files
- `tests/helpers/fake-prisma.ts` (modify)

### Step 1: Write a minimal integration test that exercises the fake

Add a new test to `tests/integration/drift-classification.test.ts` (Task 6 will expand this):

```ts
import { describe, expect, it } from "vitest";
import { createFakeDb } from "../helpers/fake-prisma";

describe("fake-prisma DriftEvent support", () => {
  it("supports driftEvent.create inside $transaction", async () => {
    const db = createFakeDb();
    const result = await (db as any).$transaction(async (tx: any) => {
      const event = await tx.driftEvent.create({
        data: {
          modelRecordId: "model_1",
          observationId: "obs_1",
          driftType: "NO_DRIFT",
          reasonCodes: ["BASELINE_ESTABLISHED"],
          explanations: ["first observation"],
          fieldDiffs: [],
          createdAt: new Date(),
        },
      });
      return event;
    });
    expect(result.id).toBeTruthy();
    expect(result.driftType).toBe("NO_DRIFT");
  });
});
```

### Step 2: Implement fake-prisma changes

Add to `tests/helpers/fake-prisma.ts`:

Inside `createFakeDb()`, add:

```ts
const driftEvents: Json[] = [];
```

Add to the `db` object:

```ts
driftEvent: {
  create: vi.fn(async (args: { data: Json }) => {
    const row = { id: nextId(), createdAt: new Date(), ...args.data };
    driftEvents.push(row);
    return row;
  }),
  findMany: vi.fn(async () => [...driftEvents]),
  findUnique: vi.fn(async (args: { where: { id: string } }) => {
    for (const e of driftEvents) if (e.id === args.where.id) return e;
    return null;
  }),
},
```

Add `$transaction` support:

```ts
$transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
  // Execute synchronously in-memory — provides tx-scoped API
  return fn(db);
}),
```

Add accessor:

```ts
return {
  ...db,
  __observations: observations,
  __contracts: contracts,
  __driftEvents: driftEvents,
} as unknown as FakeDb;
```

Update `FakeDb` type:

```ts
export type FakeDb = PrismaClient & {
  __observations: Json[];
  __contracts: Map<string, Json>;
  __driftEvents: Json[];
};
```

Update `IngestDb` type in `apps/web/lib/ingest.ts` to include `driftEvent` and `$transaction`:

```ts
export type IngestDb = Pick<
  PrismaClient,
  "provider" | "model" | "contract" | "observation" | "collectorVersion" | "driftEvent" | "$transaction"
>;
```

### Step 3: Verify

Run: `pnpm vitest run tests/integration/drift-classification.test.ts` — passes.
Run: `pnpm vitest run tests/helpers/fake-prisma.test.ts` or equivalent — passes.
Run: `pnpm test` — all existing tests still pass.
Run: `pnpm typecheck` — passes.

### Commit boundary

```
git add tests/helpers/fake-prisma.ts tests/integration/drift-classification.test.ts apps/web/lib/ingest.ts
git commit -m "feat: extend fake-prisma with DriftEvent delegate and $transaction support"
```

---

## TASK 5: ingest refactor — load previous, normalize/evidence, classify, DriftEvent, promote

### Goal
Refactor `ingestObservation` to: load previous contract, compute `ObservationEvidence`, classify before promotion, persist DriftEvent, all within a transaction.

### Interfaces consumed
- `classifyDrift`, `DriftInput`, `ObservationEvidence` from `packages/core/src/classify-drift.ts`
- `semanticHash`, `extractSemanticFields` from `packages/core/src/semantic-hash.ts`
- `validateCandidate` from `packages/core/src/validate.ts`
- All normalize functions from `packages/core/src/normalize.ts`

### Interfaces produced
- Updated `IngestResult` with `driftType` and `driftEventId`
- Updated `ingestObservation` with transaction + classify-before-promote

### Files
- `apps/web/lib/ingest.ts` (modify)
- `tests/integration/observation-ingestion.test.ts` (modify — add new tests)

### Step 1: Write failing tests

Add to `tests/integration/observation-ingestion.test.ts`:

```ts
it("persists a DriftEvent for every valid ingestion", async () => {
  const db = createFakeDb();
  const result = await ingestObservation(db, healthyInput());
  expect(result.driftType).toBe("NO_DRIFT");
  expect(result.driftEventId).toBeTruthy();
  const events = db.__driftEvents;
  expect(events.length).toBe(1);
  expect(events[0].driftType).toBe("NO_DRIFT");
  expect(events[0].observationId).toBe(result.observationId);
});

it("classifies $4 → $6 as SEMANTIC_DRIFT before promoting contract", async () => {
  const db = createFakeDb();
  await ingestObservation(db, healthyInput());
  const result2 = await ingestObservation(db, healthyInput({ inputPrice: "$6 / 1M tokens" }));
  expect(result2.driftType).toBe("SEMANTIC_DRIFT");
  expect(result2.driftEventId).toBeTruthy();
  const events = db.__driftEvents as any[];
  expect(events.length).toBe(2);
  expect(events[1].driftType).toBe("SEMANTIC_DRIFT");
  expect(events[1].fieldDiffs).toEqual(
    expect.arrayContaining([expect.objectContaining({ field: "inputPrice" })]),
  );
  // Contract should be promoted with new $6 price
  const contract = [...db.__contracts.values()][0] as any;
  expect(contract.inputPrice).toBe(6);
});

it("does NOT promote contract for EXTRACTION_DRIFT", async () => {
  const db = createFakeDb();
  await ingestObservation(db, healthyInput());
  const result = await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));
  expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
  // Contract should still be $4 from first ingestion
  const contract = [...db.__contracts.values()][0] as any;
  expect(contract.inputPrice).toBe(4);
});

it("IngestResult includes driftType and driftEventId", async () => {
  const db = createFakeDb();
  const result = await ingestObservation(db, healthyInput());
  expect(result).toHaveProperty("driftType");
  expect(result).toHaveProperty("driftEventId");
  expect(typeof result.driftType).toBe("string");
  expect(typeof result.driftEventId).toBe("string");
});
```

Run: `pnpm vitest run tests/integration/observation-ingestion.test.ts` — new tests fail.

### Step 2: Refactor ingestObservation

Rewrite `apps/web/lib/ingest.ts`. The key changes:

1. Add `classifyDrift`, `extractSemanticFields` to imports
2. Compute `unsafeFields` and `missingFields` during normalization
3. Wrap observation + driftEvent + contract promotion in `$transaction`
4. Load previous contract inside transaction before classification
5. Classify before promotion
6. Update `IngestResult` type

```ts
import type { PrismaClient } from "@modelcontract/db";
import {
  normalizeContextWindow,
  normalizeDate,
  normalizePrice,
  normalizeStatus,
  semanticHash,
  validateCandidate,
  extractSemanticFields,
  classifyDrift,
  type CandidateObservation,
  type ModelContract,
  type DriftType,
} from "@modelcontract/core";

// ... jsonSafe, RawObservation remain unchanged ...

export type IngestResult = {
  observationId: string;
  schemaValid: boolean;
  contractId: string | null;
  semanticHash: string | null;
  driftType: DriftType;
  driftEventId: string | null;
  errors: string[];
  warnings: string[];
};

export type IngestDb = Pick<
  PrismaClient,
  "provider" | "model" | "contract" | "observation" | "collectorVersion" | "driftEvent" | "$transaction"
>;

// ... nonEmptyString remains unchanged ...

export async function ingestObservation(db: IngestDb, raw: RawObservation): Promise<IngestResult> {
  // Extract raw strings (unchanged from Stage 2)
  const provider = nonEmptyString(raw.provider) ? raw.provider : "";
  const modelId = nonEmptyString(raw.modelId) ? raw.modelId : "";
  const sourceUrl = nonEmptyString(raw.sourceUrl) ? raw.sourceUrl : "";
  const collectorId = nonEmptyString(raw.collectorId) ? raw.collectorId : "";
  const collectorVersion = nonEmptyString(raw.collectorVersion) ? raw.collectorVersion : null;
  const runId = nonEmptyString(raw.runId) ? raw.runId : null;
  const observedAt = nonEmptyString(raw.observedAt) ? raw.observedAt : new Date().toISOString();

  // --- Normalize and compute evidence (new in Stage 3) ---
  const errors: string[] = [];
  const warnings: string[] = [];
  const unsafeFields: string[] = [];
  const missingFields: string[] = [];

  const statusRes = normalizeStatus(raw.status);
  if (!statusRes.ok) errors.push(`status: ${statusRes.reason}`);

  const contextRes = ...; // unchanged
  if (!contextRes.ok) errors.push(`contextWindow: ${contextRes.reason}`);

  // inputPrice: distinguish "present but unsafe" from "absent"
  const inputRes =
    raw.inputPrice !== undefined && raw.inputPrice !== null && raw.inputPrice !== ""
      ? normalizePrice(raw.inputPrice)
      : { ok: false as const, reason: "inputPrice is missing" };
  if (!inputRes.ok) {
    errors.push(`pricing.inputPrice: ${inputRes.reason}`);
    if (raw.inputPrice !== undefined && raw.inputPrice !== null && raw.inputPrice !== "") {
      unsafeFields.push("pricing.inputPrice");  // present but unparseable
    } else {
      missingFields.push("pricing.inputPrice");  // absent
    }
  }

  // ... outputRes, dateRes unchanged ...

  // --- Build candidate + validate (unchanged logic) ---
  let schemaValid = false;
  let candidate: CandidateObservation | null = null;

  if (statusRes.ok && contextRes.ok && inputRes.ok && outputRes.ok && dateRes.ok) {
    candidate = { ... }; // same as before
    const validation = validateCandidate(candidate);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
    schemaValid = errors.length === 0;
  }

  const hash = candidate && schemaValid ? semanticHash(candidate as ModelContract) : null;

  // --- Evidence for classifier ---
  const observationEvidence = {
    collectionFailed: false,  // Stage 2 always has data; Stage 4 will set this
    retryExhausted: false,
    schemaValid,
    unsafeFields,
    missingFields,
    validationErrors: errors,
  };

  // --- Idempotent upserts (outside transaction) ---
  const providerRow = await db.provider.upsert({ ... }); // unchanged
  const modelRow = await db.model.upsert({ ... }); // unchanged
  if (collectorVersion) await db.collectorVersion.upsert({ ... }); // unchanged

  // --- Atomic transaction: observation + classify + driftEvent + promote ---
  const txResult = await db.$transaction(async (tx) => {
    // Load previous contract INSIDE transaction
    const previousRow = await tx.contract.findUnique({
      where: { modelId: modelRow.id },
    });
    const previousContract = previousRow
      ? contractRowToModelContract(previousRow)
      : null;

    // Persist observation
    const observation = await tx.observation.create({
      data: {
        modelId: modelRow.id,
        rawPayload: jsonSafe(raw),
        normalizedPayload: candidate ? jsonSafe(candidate) : null,
        schemaValid,
        validationErrors: errors,
        validationWarnings: warnings,
        semanticHash: hash,
        collectorId,
        collectorVersion,
        runId,
        sourceUrl,
        observedAt,
      },
    });

    // Classify BEFORE promotion
    const decision = classifyDrift({
      previousContract,
      candidate: schemaValid ? candidate : null,
      evidence: observationEvidence,
    });

    // Persist DriftEvent
    const driftEvent = await tx.driftEvent.create({
      data: {
        modelRecordId: modelRow.id,
        observationId: observation.id,
        previousContractId: previousRow?.id ?? null,
        driftType: decision.driftType,
        reasonCodes: decision.reasonCodes,
        explanations: decision.explanations,
        fieldDiffs: decision.fieldDiffs,
        previousHash: decision.previousHash,
        currentHash: decision.currentHash,
      },
    });

    // Promote contract ONLY for valid observations
    let contractId: string | null = null;
    const shouldPromote =
      schemaValid &&
      candidate !== null &&
      decision.driftType !== "EXTRACTION_DRIFT" &&
      decision.driftType !== "AMBIGUOUS_DRIFT" &&
      decision.driftType !== "TRANSIENT_FAILURE";

    if (shouldPromote) {
      const c = candidate!;
      const contractRow = await tx.contract.upsert({
        where: { modelId: modelRow.id },
        create: { modelId: modelRow.id, status: c.status, ... },
        update: { status: c.status, ... },
      });
      contractId = contractRow.id;
    }

    return {
      observationId: observation.id,
      driftEventId: driftEvent.id,
      contractId,
      driftType: decision.driftType,
    };
  });

  return {
    observationId: txResult.observationId,
    schemaValid,
    contractId: txResult.contractId,
    semanticHash: hash,
    driftType: txResult.driftType,
    driftEventId: txResult.driftEventId,
    errors,
    warnings,
  };
}
```

Add helper:

```ts
function contractRowToModelContract(row: any): ModelContract {
  return {
    provider: "", // loaded from model.provider.name in real DB
    modelId: "",  // loaded from model.modelId in real DB
    status: row.status,
    contextWindow: row.contextWindow ?? undefined,
    pricing: {
      inputPrice: row.inputPrice ?? undefined,
      outputPrice: row.outputPrice ?? undefined,
      currency: row.currency,
      unit: row.pricingUnit,
    },
    deprecationDate: row.deprecationDate ?? undefined,
    source: {
      url: row.sourceUrl,
      collectorId: row.collectorId,
      collectorVersion: row.collectorVersion,
      observedAt: row.observedAt,
    },
    validation: { schemaValid: true, confidence: 0.99, warnings: [] },
  };
}
```

### Step 3: Verify

Run: `pnpm vitest run tests/integration/observation-ingestion.test.ts` — all pass (existing + new).
Run: `pnpm vitest run tests/unit/` — all pass.
Run: `pnpm typecheck` — passes.
Run: `pnpm test` — full suite passes.

### Commit boundary

```
git add apps/web/lib/ingest.ts tests/integration/observation-ingestion.test.ts
git commit -m "feat: refactor ingestion to classify before promotion with DriftEvent persistence"
```

---

## TASK 6: Deterministic provider variant integration matrix

### Goal
Test the complete variant matrix: each provider variant produces the expected drift classification when compared against a HEALTHY baseline.

### Interfaces consumed
- `contractFromVariant` from `tests/helpers/contract-from-variant.ts`
- `demoVariants` from `fixtures/provider-demo/shared.ts`
- `classifyDrift` from `packages/core/src/classify-drift.ts`
- `createFakeDb` from `tests/helpers/fake-prisma.ts`
- `ingestObservation` from `apps/web/lib/ingest.ts`

### Files
- `tests/integration/drift-classification.test.ts` (new — full file)

### Step 1: Write the test file

```ts
import { describe, expect, it } from "vitest";
import { classifyDrift } from "../../packages/core/src/classify-drift";
import { extractSemanticFields, semanticHash } from "../../packages/core/src/semantic-hash";
import { demoVariants } from "../../fixtures/provider-demo/shared";
import { contractFromVariant } from "../helpers/contract-from-variant";
import { createFakeDb } from "../helpers/fake-prisma";
import { ingestObservation } from "../../apps/web/lib/ingest";
import type { RawObservation } from "../../apps/web/lib/ingest";
import type { ModelContract } from "../../packages/core/src/contract";
import type { ObservationEvidence } from "../../packages/core/src/classify-drift";

const HEALTHY_CONTRACT = contractFromVariant(demoVariants.HEALTHY)!;

function evidenceForVariant(variantId: string): ObservationEvidence {
  // Simulate what the ingestion pipeline would produce for each variant
  switch (variantId) {
    case "HEALTHY":
    case "CHANGED_PRICE":
    case "DEPRECATED":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: true,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [],
      };
    case "BROKEN_SELECTOR":
      // In real extraction, selectors break → fields missing
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: ["pricing.inputPrice", "pricing.outputPrice", "status", "contextWindow"],
        validationErrors: ["provider required", "modelId required", "status invalid"],
      };
    case "MISSING_FIELD":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: ["pricing.inputPrice"],
        validationErrors: ["pricing.inputPrice: inputPrice is missing"],
      };
    case "AMBIGUOUS":
      return {
        collectionFailed: false,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: ["pricing.inputPrice"],
        missingFields: [],
        validationErrors: ["pricing.inputPrice: cannot safely normalize price from \"Contact sales\""],
      };
    default:
      throw new Error(`unknown variant: ${variantId}`);
  }
}

describe("provider variant → drift classification matrix", () => {
  it("HEALTHY → HEALTHY = NO_DRIFT", () => {
    const candidate = contractFromVariant(demoVariants.HEALTHY)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("HEALTHY"),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });

  it("HEALTHY → CHANGED_PRICE = SEMANTIC_DRIFT", () => {
    const candidate = contractFromVariant(demoVariants.CHANGED_PRICE)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("CHANGED_PRICE"),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "inputPrice" })]),
    );
  });

  it("HEALTHY → DEPRECATED = SEMANTIC_DRIFT", () => {
    const candidate = contractFromVariant(demoVariants.DEPRECATED)!;
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("DEPRECATED"),
    });
    expect(result.driftType).toBe("SEMANTIC_DRIFT");
    expect(result.fieldDiffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "status" })]),
    );
  });

  it("HEALTHY → BROKEN_SELECTOR = EXTRACTION_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("BROKEN_SELECTOR"),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("HEALTHY → MISSING_FIELD = EXTRACTION_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("MISSING_FIELD"),
    });
    expect(result.driftType).toBe("EXTRACTION_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("HEALTHY → AMBIGUOUS = AMBIGUOUS_DRIFT", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: evidenceForVariant("AMBIGUOUS"),
    });
    expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
    expect(result.fieldDiffs).toEqual([]);
  });

  it("simulated collection failure = TRANSIENT_FAILURE", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: {
        collectionFailed: true,
        retryExhausted: false,
        schemaValid: false,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [],
      },
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
  });

  it("collection failure + retry exhausted = TRANSIENT_FAILURE", () => {
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate: null,
      evidence: {
        collectionFailed: true,
        retryExhausted: true,
        schemaValid: false,
        unsafeFields: [],
        missingFields: [],
        validationErrors: [],
      },
    });
    expect(result.driftType).toBe("TRANSIENT_FAILURE");
  });

  it("provenance-only change = NO_DRIFT", () => {
    const candidate: ModelContract = {
      ...HEALTHY_CONTRACT,
      source: {
        url: "https://other.example/model-x",
        collectorId: "c_other",
        collectorVersion: "v2",
        observedAt: "2031-01-01T00:00:00.000Z",
      },
    };
    const result = classifyDrift({
      previousContract: HEALTHY_CONTRACT,
      candidate,
      evidence: evidenceForVariant("HEALTHY"),
    });
    expect(result.driftType).toBe("NO_DRIFT");
    expect(result.reasonCodes).toContain("SEMANTIC_HASH_UNCHANGED");
  });
});

describe("full ingest → DriftEvent round-trip", () => {
  it("persists DriftEvent with correct driftType for each variant", async () => {
    const db = createFakeDb();
    const baseline = await ingestObservation(db, variantToRaw("HEALTHY"));
    expect(baseline.driftType).toBe("NO_DRIFT");

    const changed = await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    expect(changed.driftType).toBe("SEMANTIC_DRIFT");

    const ambiguous = await ingestObservation(db, variantToRaw("AMBIGUOUS"));
    expect(ambiguous.driftType).toBe("AMBIGUOUS_DRIFT");

    const events = db.__driftEvents as any[];
    expect(events.length).toBe(3);
    expect(events[0].driftType).toBe("NO_DRIFT");
    expect(events[1].driftType).toBe("SEMANTIC_DRIFT");
    expect(events[2].driftType).toBe("AMBIGUOUS_DRIFT");
  });

  it("CHANGED_PRICE DriftEvent has correct fieldDiffs", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    const result = await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    const events = db.__driftEvents as any[];
    const semanticEvent = events.find((e: any) => e.driftType === "SEMANTIC_DRIFT");
    expect(semanticEvent.fieldDiffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "inputPrice", previous: 4, current: 6 })]),
    );
  });

  it("contract NOT promoted for AMBIGUOUS_DRIFT", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    await ingestObservation(db, variantToRaw("AMBIGUOUS"));
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(4); // unchanged from baseline
  });

  it("contract promoted for SEMANTIC_DRIFT", async () => {
    const db = createFakeDb();
    await ingestObservation(db, variantToRaw("HEALTHY"));
    await ingestObservation(db, variantToRaw("CHANGED_PRICE"));
    const contract = [...db.__contracts.values()][0] as any;
    expect(contract.inputPrice).toBe(6); // updated
  });
});

// Helper: convert variant semantics to RawObservation
function variantToRaw(variantId: string): RawObservation {
  const v = demoVariants[variantId as keyof typeof demoVariants];
  return {
    provider: "demo-ai",
    modelId: v.semantics.modelId,
    status: v.semantics.status,
    contextWindow: v.semantics.contextWindow,
    inputPrice: v.semantics.inputPrice ?? undefined,
    outputPrice: v.semantics.outputPrice ?? undefined,
    sourceUrl: "https://demo.example/provider-demo/model-x",
    collectorId: "c_demo",
    collectorVersion: "v1",
    observedAt: "2026-08-17T00:00:00.000Z",
  };
}
```

### Step 2: Verify

Run: `pnpm vitest run tests/integration/drift-classification.test.ts` — all pass.
Run: `pnpm test` — full suite passes.

### Commit boundary

```
git add tests/integration/drift-classification.test.ts
git commit -m "test: add deterministic provider variant drift classification matrix"
```

---

## TASK 7: Transaction / invalid-promotion regression coverage

### Goal
Ensure the transaction boundary prevents invalid promotion and that DriftEvent is always persisted.

### Files
- `tests/integration/observation-ingestion.test.ts` (modify — add regression tests)

### Step 1: Add regression tests

```ts
it("DriftEvent is ALWAYS persisted even for invalid observations", async () => {
  const db = createFakeDb();
  await ingestObservation(db, healthyInput());  // baseline
  await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));  // AMBIGUOUS
  await ingestObservation(db, healthyInput({ status: "retired soon" }));  // invalid
  const events = db.__driftEvents as any[];
  expect(events.length).toBe(3);  // one DriftEvent per observation
});

it("previous $4 contract is NOT overwritten by $6 observation's baseline classification", async () => {
  const db = createFakeDb();
  await ingestObservation(db, healthyInput());  // $4 baseline
  const result = await ingestObservation(db, healthyInput({ inputPrice: "$6 / 1M tokens" }));
  expect(result.driftType).toBe("SEMANTIC_DRIFT");
  // The DriftEvent's previousHash should match the $4 contract's hash
  const events = db.__driftEvents as any[];
  const semanticEvent = events[1];
  expect(semanticEvent.previousHash).toBeTruthy();
  expect(semanticEvent.currentHash).toBeTruthy();
  expect(semanticEvent.previousHash).not.toBe(semanticEvent.currentHash);
});

it("contract is created on first valid observation (baseline)", async () => {
  const db = createFakeDb();
  const result = await ingestObservation(db, healthyInput());
  expect(result.driftType).toBe("NO_DRIFT");
  expect(result.contractId).toBeTruthy();
  expect(db.__contracts.size).toBe(1);
});

it("contract is NOT created for invalid first observation", async () => {
  const db = createFakeDb();
  const result = await ingestObservation(db, healthyInput({ inputPrice: "Contact sales" }));
  expect(result.driftType).toBe("AMBIGUOUS_DRIFT");
  expect(result.contractId).toBeNull();
  expect(db.__contracts.size).toBe(0);
});
```

### Step 2: Verify

Run: `pnpm vitest run tests/integration/observation-ingestion.test.ts` — all pass.
Run: `pnpm test` — full suite passes.

### Commit boundary

```
git add tests/integration/observation-ingestion.test.ts
git commit -m "test: add transaction and invalid-promotion regression coverage"
```

---

## TASK 8: Full Stage 3 verification

### Goal
Run the complete verification suite to confirm Stage 3 is clean.

### Commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

All must pass with zero errors.

### Commit if needed

If any fixes are required during verification, commit them individually with descriptive messages.

### Final commit (if no additional changes needed)

```
# No commit needed — all work is already committed in Tasks 1-7
```

---

## Summary

| Task | Description | Tests | Commit |
|------|-------------|-------|--------|
| 1 | ReasonCode + semanticDiff | 8 unit tests | `feat: add ReasonCode type and semanticDiff function` |
| 2 | classifyDrift pure classifier | 14 unit tests | `feat: implement pure drift classifier with classification precedence` |
| 3 | DriftEvent Prisma schema | migration | `feat: add DriftEvent schema with relations` |
| 4 | fake-prisma DriftEvent + $transaction | 1 integration test | `feat: extend fake-prisma with DriftEvent and $transaction` |
| 5 | ingest refactor | 4 integration tests | `feat: refactor ingestion to classify before promotion` |
| 6 | variant integration matrix | 12 integration tests | `test: add provider variant drift classification matrix` |
| 7 | regression coverage | 4 regression tests | `test: add transaction and invalid-promotion regression coverage` |
| 8 | full verification | — | (no commit if clean) |

**Total new tests:** ~43 (8 + 14 + 1 + 4 + 12 + 4)

**No Stage 4 work included.** No healing, no quarantine, no compatibility, no judge UI.
