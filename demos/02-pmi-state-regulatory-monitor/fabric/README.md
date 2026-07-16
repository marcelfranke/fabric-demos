# PMI State Regulatory Monitor — Fabric Backend

Microsoft Fabric data-engineering backend for the **PMI State Regulatory Monitor**
(dynamic-pricing) demo. It ingests the U.S. CDC **STATE System** e-cigarette
legislation datasets into a Fabric OneLake Lakehouse using a medallion
architecture, computes a per-state **Pricing Signal** for each PMI product line, and
exposes the result through a Direct Lake Power BI semantic model.

This backend is a faithful PySpark port of the browser-side logic in the Angular app
(`src/app/services/cdc-state-sync.service.ts`, `pricing.service.ts`, `constants.ts`),
so the Lakehouse numbers match the app exactly.

## Overview

- **Workspace:** `Dynamic Pricing` (GUID `aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05`,
  capacity `ddddda30-aaa3-47f5-bd11-73194639ea8b`) — **separate** from the European
  Patents workspace.
- **Lakehouse:** `pmi_lakehouse` (`e3c9f128-9200-4963-890d-26c5f76bf81a`).
- **Notebook:** `02_pmi_pricing_medallion` (`904e669e-dd9c-4b36-9362-64d11051a175`) —
  Bronze → Silver → Gold in one parameterized PySpark notebook.
- **Pipeline:** `pmi_pricing_pipeline` (`47a3f4ed-e65a-41fa-919e-5c365e5aa1f2`) —
  runs the notebook on a **daily** schedule (06:00 UTC).
- **Semantic model:** `PMI Dynamic Pricing` (`6be9e165-fc81-4990-a479-a0cab935201c`)
  — Direct Lake (queries the Gold Delta tables in place, no import copy).
- **Scope:** the 5 CDC STATE System e-cigarette datasets, most-recent (year, quarter)
  per state+provision, filtered to the 50 states + DC.

## Architecture

```
CDC STATE System (Socrata SODA)  ──►  Bronze  ──►  Silver  ──►  Gold (pricing star)  ──►  Direct Lake model
   (data.cdc.gov REST, no key)         (raw)     (evidence)      (state × program)         (Power BI)
```

### Bronze — raw CDC rows

One raw Delta table per dataset (`$limit=1000&$order=year DESC`, descriptive
`User-Agent`, public no-key Socrata endpoints).

| Table | Rows | CDC dataset | Category |
|---|---:|---|---|
| `bronze_cdc_kwbr_syv2` | 1,000 | `kwbr-syv2` | tax (excise) |
| `bronze_cdc_8zea_kwnt` | 1,000 | `8zea-kwnt` | youth_access |
| `bronze_cdc_ne52_uraz` | 1,000 | `ne52-uraz` | licensure |
| `bronze_cdc_piju_vf3p` | 1,000 | `piju-vf3p` | preemption |
| `bronze_cdc_wan8_w4er` | 1,000 | `wan8-w4er` | smokefree_air |

> **Dataset fix:** the smokefree indoor-air *summary* dataset `i8t6-whzd` returns
> empty provision fields and is **not** used. The non-summary
> **`wan8-w4er`** ("CDC STATE System E-Cigarette Legislation - Smokefree Indoor Air")
> is used instead. Smokefree air is context only, not a pricing driver.

### Silver — normalized evidence + curated facts

`silver_regulatory_item` is the Silver "evidence" grain: one row per state
regulatory provision (columns match the app's `RegulatoryItem`). Applies the same
normalization as `cdc-state-sync.service.ts`: suffix bare-number tax rates with `%`,
extract lat/long from the `geolocation` object, `provisionvalue == 'No Provision'` →
`no_provision`, filter to 50 states + DC (drop territories + the national US row),
and dedupe to the most-recent `(year, quarter)` per `(state, provision)`.

| Table | Rows | Notes |
|---|---:|---|
| `silver_regulatory_item` | 3,941 | Normalized CDC provisions, deduped to most-recent year/quarter |
| `silver_program` | 3 | IQOS / ZYN / VEEV |
| `silver_flavor_ban` | 6 | Curated statewide flavor bans: CA, MA, NJ, NY, RI, UT → ZYN + VEEV |
| `silver_pmta_registry` | 11 | Curated PMTA registry laws: AL, FL, KY, LA, NC, OK, VA, WI, MS enacted; IA, UT pending → VEEV |
| `silver_tax_sample` | 10 | Curated VEEV excise sample (incl. CO 62%) |
| `silver_fda_milestones` | 4 | Federal FDA milestones (state = US, context only) |

CDC vapor legislation maps to the **VEEV** program; the curated flavor-ban layer
applies to **ZYN + VEEV** (flavored SKUs); IQOS is federal/context only.

### Gold — pricing star (`gold_` prefix)

Grain = **state × product line** (`state`, `product_code`). `gold_pricing_signal` is
the serving table the whole UI reads. Computed with the exact precedence logic from
the app's `pricing.service.ts` `computeSignals()`.

| Table | Rows | Role |
|---|---:|---|
| `gold_pricing_signal` | 57 | Fact — one pricing signal per state × program (VEEV 51, ZYN 6) |
| `gold_dim_state` | 51 | State dimension (50 + DC) with lat/long |
| `gold_dim_program` | 3 | Program dimension (IQOS / ZYN / VEEV) |
| `gold_signals_by_action` | 5 | Rollup: signals per `pricing_action` |
| `gold_signals_by_program` | 2 | Rollup: signals per product line |
| `gold_state_tax_burden` | 34 | Rollup: taxed states with tax burden % |

## Pricing Signal computation

For each `(state, product_code)`:

- `flavor_banned` = an enacted `flavor_ban` exists **and** the program is ZYN or VEEV
  (IQOS heated tobacco is exempt).
- `registry_gated` = an enacted state-level `pmta_registry` exists.
- `has_pending` = any `pending` item exists.
- `tax_burden` (%, decimal) = parsed from the state's `tax` provision value. A
  percentage is used directly; a per-unit `$` value is converted to an approximate %
  via an **assumed reference retail price** (`ASSUMED_ML_PER_PACK = 5`,
  `ASSUMED_RETAIL_PRICE_USD = 20`) — flagged as a demo assumption. Null when the
  program has no e-cig excise (e.g. ZYN pouches ≠ e-cigarettes).
- `sellable` = `NOT (flavor_banned OR registry_gated)`.
- `pricing_action` by precedence:
  1. `flavor_banned` → `delist_banned`
  2. `registry_gated` → `restricted_assortment`
  3. `has_pending` → `watch_pending`
  4. `tax_burden > 20` → `adjust_for_tax`
  5. else → `price_freely`
- `recommendation` = one-line headline per action (e.g. CO: "Adjust for tax: 62%
  excise — raise price to protect margin"; NJ: "Delist: ZYN flavored SKUs banned").

Utah's flavor ban overrides its pending registry → `delist_banned`.

## Validation gate — reconciled counts

The notebook's final cell prints per-table counts and reconciles them with the app's
live numbers. Verified live (`Files/_run/summary.json`, the pipeline run, and Direct
Lake DAX):

| Metric | Value |
|---|---:|
| Normalized CDC rows (`silver_regulatory_item`) | 3,941 |
| Pricing signals (`gold_pricing_signal`) | 57 |
| — VEEV / ZYN | 51 / 6 |
| Distinct states with a signal | 51 |
| `price_freely` | 26 |
| `delist_banned` | 12 |
| `adjust_for_tax` | 9 |
| `restricted_assortment` | 9 |
| `watch_pending` | 1 |
| Taxed states | 34 |
| Avg tax burden | ~24.2% |

Key integrity: `count == distinct(id)` and 0 null ids on every keyed Silver/Gold
table.

## Semantic model

Direct Lake star over the Gold tables: fact `PricingSignal` (`gold_pricing_signal`)
+ `State` (`gold_dim_state`) + `Program` (`gold_dim_program`) dimensions. Measures:

| Measure | Value |
|---|---:|
| Total Signals | 57 |
| Restricted or Banned States | 15 |
| Avg Tax Burden | 24.2 |
| Pending Risk States | 1 |
| Signals Needing Price Change | 31 |

Reframed (refreshed) after each load so Direct Lake picks up the latest Delta tables.
The committed TMDL under [`semantic-model/`](./semantic-model) is the source of truth;
the Git-synced export lives under `../workspace-sync/PMI Dynamic Pricing.SemanticModel`.

## Engineering canon

- **Deterministic surrogate keys** — `bigint` via `xxhash64` of the natural business
  key (stable across reprocessing; verified `count == distinct(id)`).
- **Medallion validation gates** — key integrity + additive-measure reconciliation
  between the app and the Lakehouse.
- **Idempotent loads** — Gold recomputes from Silver every run (overwrite); the
  deterministic keys converge, so a re-run is safe.
- **Polite CDC access** — descriptive `User-Agent`, most-recent year/quarter only,
  `$limit=1000` per dataset.
- **Self-diagnosing driver** — the notebook wraps the pipeline in a try/except and
  writes `Files/_run/summary.json` (counts) or `Files/_run/error.txt` (traceback) to
  OneLake Files, readable headlessly via the OneLake DFS REST API.

## Data source

- **CDC STATE System** — https://data.cdc.gov (Socrata SODA API).
- Open data — **no authentication or API key** required.
- Endpoint pattern: `https://data.cdc.gov/resource/{id}.json?$limit=1000&$order=year%20DESC`.

The curated flavor-ban / PMTA-registry / tax-sample / FDA-milestone facts are a
point-in-time snapshot seeded from the app's `constants.ts` (CDC has no dataset for
them).

## How to build

1. **Create the Lakehouse** `pmi_lakehouse` in the `Dynamic Pricing` workspace.
2. **Deploy the notebook** — UPSERT-deploys to the workspace via the Fabric REST API:

   ```bash
   node fabric/notebooks/build_notebook.mjs
   ```

   Requires Node.js and an authenticated Azure CLI session (`az login`) against the
   target tenant. `SKIP_DEPLOY=1` exports the `.py` only.
3. **Run the notebook** (or the pipeline) to load Bronze → Silver → Gold and prove the
   reconciled counts:

   ```bash
   node fabric/notebooks/run_notebook.mjs
   ```

4. **Deploy the pipeline** (runs the notebook daily):

   ```bash
   node fabric/notebooks/build_pipeline.mjs
   ```

5. **Deploy + reframe the semantic model:**

   ```bash
   node fabric/notebooks/build_semantic_model.mjs
   ```

   Deploys the Direct Lake TMDL and triggers a refresh so it picks up the Gold tables.

### Notebook run knobs (override per job)

`DATASET_LIMIT` (rows per CDC dataset), `WRITE_MODE` (`overwrite` | `append`),
`RAW_ROOT`. Defaults are safe (cache-first, `$limit=1000`).

## Environment / configuration

Environment-specific values (workspace ID, lakehouse ID, notebook ID, tenant ID,
OneLake paths) must be updated for a different tenant or workspace. These are **Azure
resource identifiers, not secrets** — authentication is always performed at runtime
via the Azure CLI (`az account get-access-token`). **No credentials are stored in this
repository.**

## Known limitations / caveats

- **CDC data is legislation tracking, not real-time enforcement.** It reflects statute
  status per quarter, not on-shelf enforcement.
- **Curated flavor-ban / registry / tax lists are a point-in-time snapshot** and should
  be dated; they are seeded facts, not a live feed.
- **The `$` → % tax conversion is a demo heuristic** (assumed reference retail price);
  the `> 20%` high-tax threshold is a demo cutoff.
- **ZYN has no CDC excise data** (pouches are not e-cigarettes), so ZYN signals are
  driven by flavor bans / pending bills, not tax.
- **Smokefree indoor-air is context only** — it does not drive a pricing action.
