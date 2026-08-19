# Bright Data Integration

ModelContract uses the **Scraper Studio batch-collection API** (`/dca/trigger`,
`/dca/dataset`) exactly as documented at
<https://docs.brightdata.com/datasets/scraper-studio/quickstart>. No behavior
is invented: `collection_id` (`j_...`) is the run/snapshot ID used to poll
results.

## API contract (verified against current Bright Data docs, 2026-08-17)

```text
POST https://api.brightdata.com/dca/trigger?collector=<c_...>&queue_next=1
Authorization: Bearer <token>
Content-Type: application/json
Body: JSON array of input objects matching the collector's input schema,
      e.g. [ { "url": "https://<host>/provider-demo/model-x" } ]

Response: { "collection_id": "j_...", "start_eta": "..." }
          → collection_id is the run/snapshot ID

GET https://api.brightdata.com/dca/dataset?id=<j_...>
→ collected rows as a JSON array once the collection completes
```

`packages/brightdata` implements this with an explicit error model:

| HTTP / condition          | Error code              | Retried? |
|---------------------------|-------------------------|----------|
| 401 / 403                 | `AUTH_ERROR`            | no       |
| 404 (trigger)             | `COLLECTOR_NOT_FOUND`   | no       |
| 422                       | `INPUT_SCHEMA_ERROR`    | no       |
| 5xx / network failure     | `TRANSIENT_API_ERROR`   | yes (bounded backoff) |
| dataset never completes   | `TIMEOUT`               | —        |
| dataset completes empty   | `EMPTY_DATASET`         | —        |
| other                     | `UNKNOWN_ERROR`         | no       |

A 404/409 on the *dataset* endpoint is treated as "still running" (collection
in progress), not a hard failure.

## Collectors to create in Scraper Studio (one-time setup)

These are built in the Bright Data Scraper Studio UI (requires an account with
a token). The repo never contains fake collector IDs or fake run results.

### 1. Controlled demo collector (`BRIGHT_DATA_DEMO_COLLECTOR_ID`)

- **Input schema:** single field `url` (string).
- **Target:** the canonical controlled page `http://<host>/provider-demo/model-x`
  — same URL in every run; the page's DOM changes via persisted `DemoState`
  (`POST /api/demo/variant`).
- **Output fields (per row), raw strings as rendered:**
  `provider`, `modelId`, `status`, `contextWindow`, `inputPrice`,
  `outputPrice`, `deprecationDate`, `sourceUrl`.
  For HEALTHY the row should be roughly:
  ```json
  {
    "provider": "demo-ai",
    "modelId": "model-x",
    "status": "Active",
    "contextWindow": "128k",
    "inputPrice": "$4 / 1M tokens",
    "outputPrice": "$12 / 1M tokens",
    "deprecationDate": null,
    "sourceUrl": "http://<host>/provider-demo/model-x"
  }
  ```
- **Selectors (HEALTHY markup):** `#model-status`, `#context-window`,
  `#input-price`, `#output-price` inside `#model-card`. These break under
  `BROKEN_SELECTOR` (table-based markup) — that structural break is what the
  extraction-drift demo (Stage 3/4) exercises.

### 2. Real public source collector (`BRIGHT_DATA_REAL_COLLECTOR_ID`)

- **Source:** Anthropic public Models Overview
  (`https://platform.claude.com/docs/en/about-claude/models/overview`) —
  publicly accessible, no login, no paywall (verified HTTP 200, 2026-08-19).
- **Input schema:** single field `url` (string).
- **Output fields (per model row):** `provider` ("anthropic"), `modelId`,
  `status`, `contextWindow`, `inputPrice`, `outputPrice`, `deprecationDate`
  (optional), `sourceUrl`.
- `modelId` must use the machine-readable Claude API ID from the page
  (e.g. `claude-fable-5`), **not** the display name (e.g. `Claude Fable 5`).
- `status`: for records extracted from the "Latest models comparison" table,
  output `active`. Do not infer status for legacy/deprecation sections.
- Extract only the model overview table; keep output raw (strings). Normalization
  is owned by `packages/core`, never by the collector.

**First live acceptance model:** Claude Fable 5 (`claude-fable-5`).
Claude Sonnet 5 is excluded from the first acceptance path because its current
documentation contains time-limited introductory pricing, which is unnecessary
ambiguity for this gate.

Expected raw output for Claude Fable 5 (raw strings, not normalized):
```json
{
  "provider": "anthropic",
  "modelId": "claude-fable-5",
  "status": "active",
  "contextWindow": "1M tokens",
  "inputPrice": "$10 / input MTok",
  "outputPrice": "$50 / output MTok",
  "sourceUrl": "https://platform.claude.com/docs/en/about-claude/models/overview"
}
```

## Environment

```text
DATABASE_URL=postgresql://...
BRIGHT_DATA_API_TOKEN=...
BRIGHT_DATA_DEMO_COLLECTOR_ID=c_...
BRIGHT_DATA_REAL_COLLECTOR_ID=c_...
```

Never commit real credentials; never print the token (tests and scripts keep
it in environment variables only).

## Live run (opt-in)

`tests/integration/live-brightdata.test.ts` is skipped when credentials are
absent, so normal CI is deterministic. With all env vars set it performs the
real flow:

```bash
pnpm db:migrate                 # against a real PostgreSQL
pnpm dev                        # or pnpm start (production build)
pnpm test:integration            # runs the opt-in live tests
```

Output includes real `runId` (`j_...`), row counts, and the resulting contract
IDs / semantic hashes. Results are then readable via:

```bash
curl http://localhost:3000/api/contracts
```

## Provenance

Every stored observation keeps `collectorId`, `collectorVersion`, `runId`,
`sourceUrl`, `observedAt`, plus the raw Bright Data payload. Bright Data is
never hidden behind a generic scrape() abstraction in this project.
