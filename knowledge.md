# ModelContract — Project Knowledge (locked)

> Read this file before every stage. It is the single source of truth for scope,
> architecture, invariants, and stage gates. If a later instruction conflicts
> with this file, this file wins unless the change is explicitly locked here.

## 1. Mission

ModelContract turns unstable public AI-provider documentation into stable,
machine-readable contracts — and knows the difference between **broken scraping**
and **real model changes**.

```text
EXTRACTION DRIFT ≠ SEMANTIC DRIFT
```

- A webpage restructuring must trigger **extraction recovery**.
- A real change to model price, context window, status, or deprecation
  information must **never** be silently healed.

Submission: WeMakeDevs × Bright Data "Into the Scrape-Verse".

## 2. Deadline

- **Hard engineering completion: August 21, 2026 EOD IST.**
- August 22–23 are QA, demo, documentation, deployment verification, and
  submission buffer only — no new features, architecture, providers, or
  integrations (see Stage 8 rules).

## 3. Scope lock

### Mandatory (all required)

1. One real public AI-provider documentation/pricing source.
2. One deterministic controlled provider mutation harness.
3. One Bright Data Scraper Studio custom collector.
4. Raw and normalized observations.
5. Stable `ModelContract` schema.
6. Canonical normalization.
7. Extraction validation.
8. Semantic diffing.
9. Drift classification: `NO_DRIFT`, `TRANSIENT_FAILURE`, `EXTRACTION_DRIFT`,
   `SEMANTIC_DRIFT`, `AMBIGUOUS_DRIFT`.
10. Retry before declaring extraction drift.
11. Quarantine invalid observations.
12. Bright Data-assisted healing/collector repair.
13. Candidate repair verification.
14. Semantic invariant verification.
15. Minimal approve/reject repair action.
16. Collector/run/version provenance.
17. One downstream compatibility check.
18. Minimal judge-facing UI.
19. Deterministic automated tests.
20. Public-repo-quality README and AI-use disclosure.

### Optional (only after mandatory scope passes)

Second real provider, richer history, WARC/evidence integration, additional
compatibility policies, improved visual polish.

### Forbidden before release candidate

```text
Kafka, Kubernetes, microservices, authentication, billing, Slack integration,
mobile app, RAG, chatbot, large provider catalog, third provider, advanced
analytics, complex RBAC, generic AI agents, elaborate marketing landing page.
```

Every dependency and service must answer:

> What actual failure mode or requirement forces this to exist?

If there is no good answer, remove it. No architecture theatre.

## 4. Architecture lock

Small TypeScript monorepo, pnpm workspaces. **Do not split into separate
deployable microservices.**

```text
modelcontract/
├── apps/web/                 # application + API boundary (Next.js App Router)
│   ├── app/page.tsx
│   ├── app/contracts/[id]/page.tsx
│   ├── app/drift/[id]/page.tsx
│   ├── app/compatibility/page.tsx
│   ├── app/provider-demo/model-x/page.tsx
│   ├── app/api/observations/route.ts
│   ├── app/api/contracts/route.ts
│   ├── app/api/compatibility/check/route.ts
│   ├── app/api/drift/[id]/heal/route.ts
│   ├── app/api/heals/[id]/approve/route.ts
│   ├── app/api/heals/[id]/reject/route.ts
│   ├── app/api/demo/variant/route.ts
│   └── components/  (ContractCard, HealthBadge, DriftEventCard, HealReview, CompatibilityResult)
├── packages/core/           # framework-independent domain rules (pure TS, no deps)
│   ├── src/contract.ts
│   ├── src/drift.ts
│   ├── src/normalize.ts
│   ├── src/validate.ts
│   ├── src/semantic-diff.ts
│   ├── src/semantic-hash.ts
│   ├── src/classify-drift.ts
│   ├── src/healing.ts
│   └── src/compatibility.ts
├── packages/brightdata/     # Bright Data interaction only
│   └── src/{client,collector,runs,heal,types}.ts
├── packages/db/             # persistence (Prisma + PostgreSQL)
│   ├── prisma/schema.prisma
│   └── src/client.ts
├── packages/cli/            # downstream compatibility consumer (modelcontract check)
│   └── src/check.ts
├── fixtures/provider-demo/  # healthy, broken-selector, changed-price, missing-field, deprecated, ambiguous
├── tests/unit, tests/integration, tests/e2e
├── docs/{architecture,brightdata,demo,ai-usage}.md
├── knowledge.md
└── README.md
```

Boundary ownership:

- `apps/web` — application/API boundary.
- `packages/core` — framework-independent domain rules (normalize, validate,
  semantic hash/diff, drift classification, healing verification, compatibility).
- `packages/brightdata` — Bright Data client/collector/run/heal interaction.
- `packages/db` — persistence.
- `packages/cli` — only the small downstream compatibility consumer.

## 5. Domain model lock

```ts
export type ModelContract = {
  provider: string;
  modelId: string;
  status: "active" | "deprecated" | "unknown";
  contextWindow?: number;
  pricing?: {
    inputPrice?: number;
    outputPrice?: number;
    currency: "USD";
    unit: "per_1m_tokens";
  };
  deprecationDate?: string;
  source: {
    url: string;
    collectorId: string;
    collectorVersion: string;
    observedAt: string;
  };
  validation: {
    schemaValid: boolean;
    confidence: number;
    warnings: string[];
  };
};
```

Do not expand this schema unless a mandatory use case requires it.

```ts
export type DriftType =
  | "NO_DRIFT"
  | "TRANSIENT_FAILURE"
  | "EXTRACTION_DRIFT"
  | "SEMANTIC_DRIFT"
  | "AMBIGUOUS_DRIFT";
```

## 6. Absolute classification order

```text
1. Did collection fail because of timeout/network/run failure?
   YES → TRANSIENT_FAILURE

2. Retry once.

3. Did retry also fail?
   YES → quarantine/suspect.

4. Did output violate structural/schema requirements?
   YES → EXTRACTION_DRIFT

5. Can required values be normalized confidently?
   NO → AMBIGUOUS_DRIFT

6. Is current normalized semantic hash identical to previous healthy hash?
   YES → NO_DRIFT

7. Are normalized semantic values different?
   YES → SEMANTIC_DRIFT
```

Critical invariant:

```text
INVALID EXTRACTION must never be processed as NORMAL SEMANTIC CHANGE.
```

Example: previous `inputPrice = 4`, broken scrape `inputPrice = null`
must produce `EXTRACTION_DRIFT`, **never** `SEMANTIC_DRIFT: 4 → null`.

A schema-invalid extraction must never be reported as a normal semantic change.
A valid real semantic change must never automatically trigger healing.

## 7. Normalization rules

```text
"128k"               → 128000
"128,000 tokens"     → 128000

"$4"                 → 4
"$4.00"              → 4
"$4 / 1M tokens"     → 4

"Active"             → "active"
"DEPRECATED"         → "deprecated"

"March 1, 2027"      → "2027-03-01"
```

All semantic comparisons occur **after normalization**. Never compare raw
scraped strings directly when determining semantic drift.

## 8. Semantic hash

Deterministic hash of semantic fields only:

```ts
{ provider, modelId, status, contextWindow, inputPrice, outputPrice, deprecationDate }
```

Excluded (provenance, not semantics): source URL, timestamp, collector run ID,
collector version, HTML structure, validation metadata.

## 9. Healing definition

> Healing means producing or applying a repaired Bright Data collector /
> extraction definition for a structurally changed page **and verifying** that
> it returns schema-valid data **without unintentionally changing** the
> previously known semantic contract.

A heal is **not successful merely because JSON is returned**. Success requires:

```text
candidate extraction succeeds
AND schema validation succeeds
AND normalization succeeds
AND semantic verification succeeds
```

For the controlled extraction-drift demo:

```text
semanticHash(beforeBreak) === semanticHash(afterCandidateRepair)
```

must hold, else `HEAL_VERIFICATION_FAILED` and manual review required.

Never fake collector versions, run IDs, repair results, external results, or
status transitions.

## 10. Bright Data must remain visible

Never hide Bright Data behind a generic `scrape()` abstraction in UI/demo.
Persist/display where available: `collectorId`, `collectorVersion`, `runId`,
`sourceUrl`, `observedAt`, raw extracted payload, normalized payload, heal
attempt, candidate collector/version, verification result.

The judge must understand: what Bright Data collected, what failed, what Bright
Data repaired, what ModelContract verified.

## 11. Database scope

Only these conceptual entities (Prisma):

```text
Provider, Model, Contract, Observation, CollectorVersion, DriftEvent,
HealAttempt, CompatibilityCheck, DemoState
```

Key observation fields: `rawPayload`, `normalizedPayload`, `schemaValid`,
`driftType`, `confidence`, `semanticHash`, `collectorId`, `collectorVersion`,
`runId`, `sourceUrl`, `observedAt`.

Key heal attempt fields: `previousCollectorVersion`, `candidateCollectorVersion`,
`candidateOutput`, `schemaValid`, `semanticMatch`, `confidence`, `status`.

## 12. API scope

```text
POST /api/observations
GET  /api/contracts
GET  /api/contracts/:id
POST /api/drift/:id/heal
POST /api/heals/:id/approve
POST /api/heals/:id/reject
POST /api/compatibility/check
POST /api/demo/variant
```

`POST /api/observations` pipeline:

```text
receive → persist raw input → validate extraction → retry/classify when
required → normalize → semantic hash → compare with last healthy contract →
classify drift → persist observation → emit/update drift event → update health
```

## 13. Controlled mutation harness

One stable public URL: `/provider-demo/model-x`. Rendered HTML changes by demo
state (see `POST /api/demo/variant`).

| Variant          | Semantic change? | Expected classification     |
|------------------|------------------|-----------------------------|
| HEALTHY          | —                | NO_DRIFT                    |
| BROKEN_SELECTOR  | none (active, 128k, $4, $12) | EXTRACTION_DRIFT |
| CHANGED_PRICE    | $4 → $6          | SEMANTIC_DRIFT (no healing) |
| MISSING_FIELD    | pricing removed   | EXTRACTION_DRIFT            |
| DEPRECATED       | active → deprecated | SEMANTIC_DRIFT            |
| AMBIGUOUS        | "Contact sales"  | AMBIGUOUS_DRIFT (never fabricate a number) |

## 14. Real source rule

Exactly **one** real public AI-provider documentation/pricing source during
mandatory scope: publicly accessible, no login, no paywall, no private/user
data, reliably fetchable by Bright Data, ≥2–3 useful model-contract fields.

Process: inspect live page → verify public accessibility → one Bright Data
trial → continue only if reliable. Strict timebox; if a source becomes
unexpectedly complex, switch to another public provider.

## 15. Compatibility consumer

One minimal policy (no policy engine):

```yaml
provider: demo-ai
model: model-x
requirements:
  minimum_context_window: 100000
  maximum_input_price: 5
  allow_deprecated: false
```

CLI: `modelcontract check`. Healthy → PASS. `$4 → $6` → FAIL with
field-specific violation (`pricing.inputPrice`). Deprecated where disallowed → FAIL.

## 16. UI scope

Three judge-oriented views only:

- **Contract view** — provider, model, status, context, pricing, deprecation,
  health, collector ID/version, latest run, source, last verified, recent events.
- **Drift/Heal view** — drift type, confidence, reasons, failed field, previous
  vs candidate extraction, previous vs candidate collector version, schema
  valid, semantic match, Approve / Reject.
- **Compatibility view** — policy, current contract, per-requirement pass/fail,
  violations, source evidence.

No analytics dashboard. Statuses: `HEALTHY`, `SUSPECT`, `QUARANTINED`,
`HEALING`, `AWAITING APPROVAL`, `VERIFIED`, `FAILED`.

## 17. Engineering priorities

```text
1. Real Bright Data Scraper Studio integration.
2. Correct extraction-vs-semantic classification.
3. Deterministic controlled mutation harness.
4. Quarantine.
5. Verifiable self-healing.
6. Semantic invariants.
7. Downstream compatibility proof.
8. Demo reliability.
9. Minimal UI.
10. Everything else.
```

## 18. Development method

For every behavior: **test first → confirm failure → minimum implementation →
focused test → affected suite → review**. One stage at a time. Do not implement
future stages early. Do not perform unrelated refactors. Do not add libraries
when stdlib or existing dependencies suffice. If a Bright Data capability
differs from assumptions, stop, inspect current official documentation, and
adapt honestly.

Stage gates and commits:

| Stage | Gate | Commit |
|-------|------|--------|
| 0 — Repository guardrails | clean install + test runner + typecheck + lint + production build | `chore: initialize ModelContract workspace` |
| 1 — Contract core + deterministic provider | controlled source; six variants render deterministically; ModelContract type; normalization tests pass; semantic hashing works | `feat: establish ModelContract domain and demo provider` |
| 2 — Persistence + real Bright Data ingestion | real public provider → Bright Data → raw extraction → normalization → DB → GET /api/contracts; controlled provider → Bright Data → DB | `feat: ingest Bright Data observations into contracts` |
| 3 — Drift engine | all deterministic drift cases produce exact intended classification, no false semantic changes | `feat: distinguish extraction and semantic drift` |
| 4 — Quarantine + self-healing | full break→detect→quarantine→heal→validate→semantic-verify→approve→rerun→healthy loop passes 3× consecutively | `feat: verify and recover extraction drift` |
| 5 — Semantic-change propagation | real semantic change → semantic event → ZERO heal attempt | `feat: propagate semantic contract changes` |
| 6 — Downstream compatibility proof | healthy → check → PASS; price change → SEMANTIC_DRIFT → check → FAIL | `feat: enforce downstream model compatibility` |
| 7 — Judge UI + release candidate | three consecutive full demo passes (Scenarios A and B) | `release: complete ModelContract hackathon build` |
| 8 — Buffer | bug fixes, QA, docs, demo recording, deployment verification only | — |

After every stage: focused tests, full tests, typecheck, lint, production
build, git diff review, strict self-review, report acceptance-gate evidence,
then stop. Never claim a stage complete without demonstrating its gate.

## 19. Mandatory test matrix (before release candidate)

```text
Healthy extraction                                  → NO_DRIFT
Network/run transient failure then success          → TRANSIENT_FAILURE → recovered
Persistent extraction failure                       → quarantine
Broken selector / HTML restructure                  → EXTRACTION_DRIFT
Missing required field                              → EXTRACTION_DRIFT
128k → 128,000 tokens (equivalent representation)   → NO_DRIFT after normalization
$4 → $4.00 (equivalent price)                       → NO_DRIFT
$4 → $6 (actual price)                              → SEMANTIC_DRIFT
active → deprecated                                 → SEMANTIC_DRIFT
$4 → Contact sales (unsafe normalization)           → AMBIGUOUS_DRIFT
Successful repair, same semantic values             → verified
Repair, different semantic values                   → verification failure / review
Semantic drift                                      → zero heal attempts
Price above threshold                               → FAIL
Deprecated where disallowed                         → FAIL
```

## 20. Definition of done (project level)

All twenty mandatory scope items are demonstrable end-to-end; the judge-facing
demo (Scenario A: extraction drift recovery; Scenario B: semantic drift +
compatibility violation) passes three consecutive times from reset state; all
automated tests, typecheck, lint, and production build pass; README and
AI-use disclosure are public-repo-quality; release candidate tagged.
