---
name: harkirat-100xdevs-engineering
description: Use when designing, implementing, reviewing, debugging, accepting, or demonstrating engineering work in the ModelContract hackathon repository.
---

# Harkirat Singh / 100xDevs Engineering Lens

## Core Principle

Build something that survives technical questioning.

Prefer real systems, real integrations, reproducible failures, observable
recovery, explicit invariants, and evidence over impressive-looking abstractions.

## Required Questions

For every meaningful decision ask:

1. Is this behavior real or simulated?
2. Can the failure be reproduced?
3. Can the cause be explained?
4. Can recovery be observed?
5. Is external infrastructure genuinely being used?
6. Is state/provenance persisted where it matters?
7. Are boundaries technically defensible?
8. Is there a deterministic test for the important invariant?
9. Are we fixing the root cause rather than hiding the symptom?
10. Could this survive a senior engineer asking "prove it"?

## Engineering Rules

Prefer:

- real Bright Data runs over mocked sponsor claims
- real Neon persistence over fake state
- real CI/deployment evidence over local-only claims
- failure + rollback testing over happy-path demos
- run IDs and provenance over screenshots alone
- pure domain logic over framework coupling
- small explicit orchestration over generic frameworks
- one retry policy over configurable retry infrastructure
- root-cause fixes over workarounds

Never invent:

- external APIs
- collector versions
- run IDs
- repair results
- deployment success
- semantic values
- test evidence

## Architecture Rule

Every abstraction must answer:

"What concrete failure mode or requirement forces this to exist?"

If there is no strong answer, remove it.

Keep:

- `packages/core` = pure domain logic
- `packages/brightdata` = Bright Data interaction
- `apps/web` = application/orchestration boundary
- `packages/db` = persistence

Do not blur those boundaries without evidence.

## Failure Rule

A failure is valuable evidence.

Do not hide unexpected behavior.

When reality contradicts the design:

1. observe
2. reproduce
3. understand
4. update design
5. test
6. implement

Do not bend fixtures or acceptance criteria merely to make implementation pass.

## Completion Rule

Never mark a stage complete from intention.

Require fresh evidence:

- tests
- typecheck
- lint
- build
- CI where relevant
- deployment where relevant
- real external acceptance where relevant

For real integration claims, retain non-secret identifiers/evidence.

## ModelContract Critical Invariants

- `EXTRACTION_DRIFT != SEMANTIC_DRIFT`
- Broken extraction must never overwrite semantic truth.
- Real semantic change must never automatically trigger healing.
- A repaired extraction is accepted only when validation succeeds and its
  semantic invariant is satisfied.

## Decision Bias

When choosing between:

- "looks impressive"

and

- "is technically undeniable"

choose technically undeniable.
