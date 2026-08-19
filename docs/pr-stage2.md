# PR: Stage 2 — PostgreSQL persistence, Bright Data client, and observation ingestion pipeline

### Why this matters

Up to now, everything lived in memory. Scraped observations vanished on restart, there was no way to actually *query* the contracts we'd been computing, and the Bright Data integration was hand-waved. This PR makes the data real: observations land in PostgreSQL, contracts are queryable through a REST API, and the demo provider page mutates under a stable URL so a scraper always hits the same endpoint while the rendered DOM changes server-side.

### What changed

**1. PostgreSQL persistence with Prisma (`packages/db`)**

Six models — no more, no fewer:

| Model | Purpose |
|---|---|
| `Provider` | Normalized provider entity (slug-unique) |
| `Model` | Links a model ID to its provider (compound unique) |
| `Contract` | The *current* contract per model — upserted on each valid observation |
| `Observation` | Every raw scrape, plus its normalized payload, validation errors, and semantic hash |
| `CollectorVersion` | Provenance for which collector version produced what |
| `DemoState` | Singleton row controlling the demo provider's rendered variant |

The schema was generated offline and committed as a plain SQL migration (`20260817000000_stage2_init`). No `prisma migrate dev` in CI — the migration file is the source of truth.

`createPrismaClient()` returns `null` when `DATABASE_URL` is unset. Every API route checks for this and returns a `503` with an honest error message instead of crashing. No silent degradation.

**2. Bright Data Scraper Studio client (`packages/brightdata`)**

This is a real client, not a wrapper pretending to be one. The flow is:

```
triggerCollector()  →  POST /dca/trigger?collector=<c_...>&queue_next=1
                       body: [ { "url": "..." } ]
                       returns: { runId: "j_...", startEta: "..." }

getDataset()        →  GET /dca/dataset?id=<j_...>
                       404/409 = "still running"
                       JSON array = rows ready

runCollectorAndWait() → trigger + poll loop with configurable max attempts
```

Every HTTP status maps to an explicit error code:

| Status | Code | Retried? |
|--------|------|----------|
| 401/403 | `AUTH_ERROR` | never |
| 404 (trigger) | `COLLECTOR_NOT_FOUND` | never |
| 422 | `INPUT_SCHEMA_ERROR` | never |
| 5xx / network | `TRANSIENT_API_ERROR` | yes, bounded backoff |
| never completes | `TIMEOUT` | — |
| completes empty | `EMPTY_DATASET` | — |

Transient errors get exponential backoff (default: 500ms base, max 2 retries). Auth and schema errors fail immediately — no point retrying those. Every option (`fetchImpl`, `baseUrl`, `maxTransientRetries`) is injectable so tests never touch the network.

**3. The ingestion pipeline (`POST /api/observations`)**

This is the core of the PR. Raw scraped strings go in; normalized, validated, persisted data comes out.

```
raw observation
  → normalize each field (packages/core owns this)
  → validate the candidate schema
  → compute semantic hash when valid
  → persist raw payload + normalized payload + validation errors
  → upsert the current contract ONLY for schema-valid observations
```

The critical invariant: **invalid observations are stored but never promote a contract.** A scraper returning `"Contact sales"` instead of a price gets `schemaValid: false`, its errors are recorded, and the previous healthy contract is untouched. This is what lets Stage 3 classify drift without false positives from broken extractions.

The pipeline operates on an `IngestDb` type that's just a structural `Pick<PrismaClient, ...>` — which means tests can pass a fake without any mocking library magic.

**4. Contract read APIs**

| Endpoint | Returns |
|----------|---------|
| `GET /api/contracts` | All current contracts with provider/model provenance |
| `GET /api/contracts/:id` | A single contract by ID, 404 if missing |

Both include the full provenance chain: provider name, model ID, collector ID/version, source URL, observation timestamp, and semantic hash.

**5. Persisted demo state (`/provider-demo/model-x`)**

The demo provider page lives at a fixed URL. The *content* changes via `POST /api/demo/variant` which writes to the `DemoState` singleton row. The page reads the persisted state on every render, so the scraper always fetches the same URL while the DOM underneath mutates. Without a database, it falls back to the `?variant=` query parameter or defaults to `HEALTHY`.

**6. Test strategy: deterministic by default, live when opted in**

| Test file | What it covers | Runs in CI? |
|-----------|---------------|-------------|
| `tests/unit/brightdata.test.ts` | All Bright Data client behavior with mocked fetch | yes |
| `tests/integration/observation-ingestion.test.ts` | Full pipeline: normalize → validate → hash → persist with fake DB | yes |
| `tests/integration/demo-state.test.ts` | Persisted variant resolution with fake DB | yes |
| `tests/integration/live-brightdata.test.ts` | Real Bright Data → real PostgreSQL end-to-end | only with credentials |

The `fake-prisma.ts` helper is a hand-written in-memory stand-in that implements exactly the Prisma delegate methods the app uses — `provider.upsert`, `model.upsert`, `contract.upsert/findMany/findUnique`, `observation.create`, `collectorVersion.upsert`, `demoState.upsert/findUnique`. It's not a mock of PrismaClient; it's a minimal reimplementation of the behavior we depend on.

Live tests use `describe.runIf(live)` and check for `BRIGHT_DATA_API_TOKEN`, `DATABASE_URL`, and `BRIGHT_DATA_DEMO_COLLECTOR_ID` — all three must be set. Without them, the tests are silently skipped. CI never touches real infrastructure.

### Files changed (33)

```
packages/db/prisma/schema.prisma          — 6-model Prisma schema
packages/db/prisma/migrations/...         — offline-generated SQL migration
packages/db/src/client.ts                 — lazy singleton, null when no DATABASE_URL
packages/db/src/index.ts                  — re-exports
packages/brightdata/src/client.ts         — trigger + dataset polling
packages/brightdata/src/errors.ts         — explicit error model
packages/brightdata/src/runs.ts           — trigger + poll loop
packages/brightdata/src/types.ts          — input/output/poll option types
packages/brightdata/src/index.ts          — re-exports
apps/web/lib/ingest.ts                    — normalize → validate → hash → persist
apps/web/lib/demo-state.ts                — persisted demo variant helpers
apps/web/app/api/observations/route.ts    — POST ingestion endpoint
apps/web/app/api/contracts/route.ts       — GET all contracts
apps/web/app/api/contracts/[id]/route.ts  — GET single contract
apps/web/app/api/demo/variant/route.ts    — POST persist demo variant
apps/web/app/provider-demo/model-x/page.tsx — reads persisted state
tests/helpers/fake-prisma.ts              — in-memory Prisma stand-in
tests/helpers/contract-from-variant.ts    — fixture → normalized contract
tests/unit/brightdata.test.ts             — 12 tests, mocked fetch
tests/integration/observation-ingestion.test.ts — 8 tests, fake DB
tests/integration/demo-state.test.ts      — 5 tests, fake DB
tests/integration/live-brightdata.test.ts — 2 tests, opt-in live
.github/workflows/ci.yml                 — added db:generate step
.env.example                             — documented all env vars
README.md                                — updated commands and layout
docs/brightdata.md                       — detailed API contract and setup
```

### What this does NOT do

- No drift classification (Stage 3)
- No collector healing (Stage 4)
- No CLI consumer (Stage 5)
- No compatibility checking (Stage 6)
- No `DriftEvent`, `HealAttempt`, or `CompatibilityCheck` models

The schema, the API surface, and the test infrastructure are all built to accommodate those stages without breaking changes.
