# Architecture

Small TypeScript monorepo (pnpm workspaces). See `knowledge.md` §4 for the
locked architecture tree and boundary ownership.

- `apps/web` — Next.js application + API boundary.
- `packages/core` — framework-independent domain rules.
- `packages/brightdata` — Bright Data Scraper Studio interaction.
- `packages/db` — Prisma/PostgreSQL persistence.
- `packages/cli` — downstream compatibility consumer.

Full architecture documentation will be written at Stage 8.
