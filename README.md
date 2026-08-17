# ModelContract

**ModelContract turns unstable AI documentation into stable, machine-readable
contracts — and knows the difference between broken scraping and real model
changes.**

> `EXTRACTION DRIFT ≠ SEMANTIC DRIFT`
>
> A webpage restructuring triggers extraction recovery. A real change to model
> price, context window, status, or deprecation information is **never**
> silently healed.

Built for the WeMakeDevs × Bright Data **Into the Scrape-Verse** hackathon.

## What it does

1. A **Bright Data Scraper Studio collector** scrapes public AI-provider
   documentation pages (the controlled demo provider and one real public
   source — Anthropic Models Overview).
2. **ModelContract** normalizes the raw extraction into a stable
   `ModelContract` (status, context window, pricing, deprecation) and persists
   raw + normalized observations with full collector/run/version provenance.
3. Each observation is classified: `NO_DRIFT`, `TRANSIENT_FAILURE`,
   `EXTRACTION_DRIFT`, `SEMANTIC_DRIFT`, or `AMBIGUOUS_DRIFT`.
4. Broken extractions are **quarantined and repaired** with a Bright Data
   collector heal, then verified against the previously known semantic
   contract before approval.
5. Real semantic changes are **never healed** — they are propagated to a
   downstream compatibility consumer (`modelcontract check`).

## Repository layout

```text
apps/web        Next.js application + API boundary
packages/core   Framework-independent domain rules (normalize, validate,
                semantic hash/diff, drift classification, healing, compatibility)
packages/brightdata  Bright Data Scraper Studio interaction
packages/db     Prisma + PostgreSQL persistence
packages/cli    Downstream compatibility consumer (`modelcontract check`)
tests/          unit, integration (incl. opt-in live Bright Data), e2e
fixtures/       Controlled demo-provider mutation fixtures
docs/           Architecture, Bright Data, demo, AI-use disclosure
knowledge.md    Locked scope, architecture, invariants, and stage gates
```

## Prerequisites

- Node.js ≥ 20.9
- pnpm ≥ 9 (workspace uses pnpm 11)
- PostgreSQL (for persistence; the app reports `503` honestly when
  `DATABASE_URL` is unset)

## Commands

```bash
pnpm install          # install all workspace dependencies

pnpm dev              # run the Next.js app (http://localhost:3000)
pnpm build            # production build (apps/web)
pnpm start            # serve the production build

pnpm db:generate      # generate the Prisma client (after install / schema change)
pnpm db:migrate       # apply migrations to PostgreSQL (needs DATABASE_URL)

pnpm test             # run unit + integration tests (vitest; live tests skip without credentials)
pnpm test:unit        # unit tests only
pnpm test:integration # integration tests only
pnpm test:watch       # watch mode

pnpm typecheck        # typecheck packages + tests + web app
pnpm lint             # ESLint (flat config)
pnpm check            # typecheck + lint + tests in one pass
```

Per-package typecheck:

```bash
pnpm --filter @modelcontract/core typecheck
pnpm --filter @modelcontract/web typecheck
```

## Environment variables

Copy `.env.example` to your local env file and fill in values:

```bash
cp .env.example .env.local   # apps/web or repo root as needed
```

| Variable | Purpose | Used from |
|----------|---------|-----------|
| `DATABASE_URL` | PostgreSQL connection string | Stage 2 |
| `BRIGHT_DATA_API_TOKEN` | Bright Data Scraper Studio API token | Stage 2 |
| `BRIGHT_DATA_DEMO_COLLECTOR_ID` | Collector for the controlled demo provider | Stage 2 |
| `BRIGHT_DATA_REAL_COLLECTOR_ID` | Collector for the real AI-provider source | Stage 2 |

**Never commit real credentials.** The Bright Data token exists only in
environment variables; tests mock the HTTP boundary so CI needs no secrets.

## API

```text
POST /api/observations       ingest a raw collector observation (normalize →
                             validate → semantic hash → persist → promote contract)
GET  /api/contracts          current contracts with provider/model provenance
GET  /api/contracts/:id      single contract
POST /api/demo/variant       set the controlled provider variant (DemoState)
```

Example — set the demo provider to a broken DOM under the same URL:

```bash
curl -X POST http://localhost:3000/api/demo/variant \
  -H 'Content-Type: application/json' \
  -d '{"variant":"BROKEN_SELECTOR"}'
```

`/provider-demo/model-x` then renders `BROKEN_SELECTOR` markup at the same
URL — persisted `DemoState` replaces the Stage 1 `?variant=` control for the
canonical demo path (`?variant=` still works as a fallback without a database).

## Status

| Stage | State |
|-------|-------|
| 0 — Repository guardrails | ✅ Done |
| 1 — Contract core + deterministic provider | ✅ Done |
| 2 — Persistence + real Bright Data ingestion | 🚧 In progress (code + tests complete; live runs blocked on credentials) |
| 3 — Drift engine | — |
| 4 — Quarantine + self-healing | — |
| 5 — Semantic-change propagation | — |
| 6 — Downstream compatibility proof | — |
| 7 — Judge UI + release candidate | — |
| 8 — Buffer (QA/docs/demo) | — |

## Controlled demo provider

The deterministic mutation harness lives at `/provider-demo/model-x` (served by
`pnpm dev`). Its variant is controlled by persisted `DemoState`
(`POST /api/demo/variant`) so the **same URL** mutates underneath the scraper —
that is what makes true extraction drift demonstrable. Without a database, the
`variant` query parameter falls back for development:

```text
/provider-demo/model-x                          → HEALTHY
/provider-demo/model-x?variant=HEALTHY          → healthy contract
/provider-demo/model-x?variant=BROKEN_SELECTOR  → same semantics, restructured DOM
/provider-demo/model-x?variant=CHANGED_PRICE    → input price $4 → $6
/provider-demo/model-x?variant=MISSING_FIELD    → input-price element removed
/provider-demo/model-x?variant=DEPRECATED       → status active → deprecated
/provider-demo/model-x?variant=AMBIGUOUS        → input price "Contact sales"
```

Fixture definitions live in `fixtures/provider-demo/` and are shared with the
unit and integration tests. See `docs/brightdata.md` for the collector setup.

Deadline: **August 21, 2026 EOD IST**. See `knowledge.md` for the locked scope,
invariants, and stage gates, and `docs/ai-usage.md` for the AI-use disclosure.
