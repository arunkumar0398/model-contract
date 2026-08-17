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
   documentation pages.
2. **ModelContract** normalizes the raw extraction into a stable
   `ModelContract` (status, context window, pricing, deprecation).
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
tests/          unit, integration, e2e
fixtures/       Controlled demo-provider mutation fixtures
docs/           Architecture, Bright Data, demo, AI-use disclosure
knowledge.md    Locked scope, architecture, invariants, and stage gates
```

## Prerequisites

- Node.js ≥ 20.9
- pnpm ≥ 9 (workspace uses pnpm 11)

## Commands

```bash
pnpm install          # install all workspace dependencies

pnpm dev              # run the Next.js app (http://localhost:3000)
pnpm build            # production build (apps/web)
pnpm start            # serve the production build

pnpm test             # run unit + integration tests (vitest)
pnpm test:unit        # unit tests only
pnpm test:integration # integration tests only
pnpm test:watch       # watch mode

pnpm typecheck        # typecheck packages + tests
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
| `BRIGHTDATA_ACCOUNT_ID` | Bright Data account ID | Stage 2 |
| `BRIGHTDATA_API_TOKEN` | Bright Data API token | Stage 2 |
| `BRIGHTDATA_COLLECTOR_ID` | Collector for the controlled demo provider | Stage 2 |
| `BRIGHTDATA_REAL_COLLECTOR_ID` | Collector for the real AI-provider source | Stage 2 |

## Status

| Stage | State |
|-------|-------|
| 0 — Repository guardrails | ✅ Done |
| 1 — Contract core + deterministic provider | ✅ Done |
| 2 — Persistence + real Bright Data ingestion | ⏳ Next |
| 3 — Drift engine | — |
| 4 — Quarantine + self-healing | — |
| 5 — Semantic-change propagation | — |
| 6 — Downstream compatibility proof | — |
| 7 — Judge UI + release candidate | — |
| 8 — Buffer (QA/docs/demo) | — |

## Controlled demo provider

The deterministic mutation harness lives at `/provider-demo/model-x` (served by
`pnpm dev`). Pick a variant with the `variant` query parameter
(case-insensitive, kebab-case accepted; unknown values fall back to `HEALTHY`):

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
unit tests.

Deadline: **August 21, 2026 EOD IST**. See `knowledge.md` for the locked scope,
invariants, and stage gates, and `docs/ai-usage.md` for the AI-use disclosure.
