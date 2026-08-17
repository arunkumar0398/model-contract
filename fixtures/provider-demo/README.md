# Demo provider fixtures

Deterministic variant definitions for the controlled `/provider-demo/model-x`
mutation harness. Each file exports a `DemoVariant` (id, label, raw semantic
values, and the exact HTML fragment rendered by the page). `shared.ts` exposes
the registry and `resolveVariantId`.

| Variant | Structure vs HEALTHY | Semantics vs HEALTHY | Expected drift |
|---|---|---|---|
| `HEALTHY` | — | — | NO_DRIFT |
| `BROKEN_SELECTOR` | restructured (table, new ids) | identical | EXTRACTION_DRIFT |
| `CHANGED_PRICE` | identical | input price `$4` → `$6` | SEMANTIC_DRIFT |
| `MISSING_FIELD` | input-price element removed | inputPrice absent | EXTRACTION_DRIFT |
| `DEPRECATED` | identical | status `Active` → `Deprecated` | SEMANTIC_DRIFT |
| `AMBIGUOUS` | identical | input price `Contact sales` | AMBIGUOUS_DRIFT |

Select the variant with `?variant=<ID>` (case-insensitive, kebab-case
accepted); unknown values fall back to `HEALTHY`.
