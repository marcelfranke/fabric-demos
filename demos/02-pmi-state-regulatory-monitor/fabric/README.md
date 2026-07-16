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
- **Sales notebook:** `02_pmi_sales_forecast` (`4042f0e7-8678-4f4c-bf7c-22a4d7e648e1`)
  — **synthetic** sales facts + demand forecast, coupled to the pricing signal (see
  [Synthetic sales & demand forecast](#synthetic-sales--demand-forecast) below).
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
| `silver_regulatory_item` | 3,947 | Normalized CDC provisions, deduped to most-recent year/quarter |
| `silver_program` | 3 | IQOS / ZYN / VEEV |
| `silver_flavor_ban` | 9 | Statewide flavor bans: CA, DC, MA, MD, ME, NJ, NY, RI, UT → ZYN + VEEV (source-upgraded — see below) |
| `silver_pmta_registry` | 11 | Curated PMTA registry laws: AL, FL, KY, LA, NC, OK, VA, WI, MS enacted; IA, UT pending → VEEV |
| `silver_tax_sample` | 10 | Curated VEEV excise sample (incl. CO 62%) |
| `silver_fda_milestones` | 4 | Federal FDA milestones (state = US, context only) |

CDC vapor legislation maps to the **VEEV** program; the curated flavor-ban layer
applies to **ZYN + VEEV** (flavored SKUs); IQOS is federal/context only.

#### Flavor-ban source upgrade (2026-07-16)

The statewide flavor-ban list was upgraded from a hand-curated 6-state set
(`CA, MA, NJ, NY, RI, UT`) to a **cross-validated 9-state set**
(`CA, DC, MA, MD, ME, NJ, NY, RI, UT`):

- **Primary source** — Public Health Law Center "U.S. Sales Restrictions on
  Flavored Tobacco Products" map, **State Policy rows only** (= statewide, not
  city/county local-only). Retrieved 2026-07-16; PHLC current-as-of 2026-05-01.
  A reproducible snapshot is committed at
  [`reference/phlc_flavor_restrictions_2026-05-01.json`](reference/phlc_flavor_restrictions_2026-05-01.json)
  (+ [`.md`](reference/phlc_flavor_restrictions_2026-05-01.md)).
- **Cross-validation** — JAMA Network Open 2025 (Cheng et al., article 2836918)
  independently confirms statewide e-cig flavor bans in MA, MD, NJ, NY, RI, UT.
- **NJ = curated override** — NJ enacted a real statewide e-cig flavor ban in
  2020 (P.L.2019 c.462), but PHLC's tobacco-broad lens lists only Jersey City +
  Paterson (local-only), so NJ uses its statute URL rather than the PHLC `/nj`
  page.
- **CA, DC** = PHLC statewide (JAMA excluded them for insufficient post-policy
  survey data). **ME** = PHLC-only (JAMA did not measure it).
- **Limitation** — "statewide" here means a PHLC State Policy row exists;
  product/menthol scope (menthol-only vs all-flavor vs e-cig-only) is **not**
  modeled in this version (deferred column-extension).

### Gold — pricing star (`gold_` prefix)

Grain = **state × product line** (`state`, `product_code`). `gold_pricing_signal` is
the serving table the whole UI reads. Computed with the exact precedence logic from
the app's `pricing.service.ts` `computeSignals()`.

| Table | Rows | Role |
|---|---:|---|
| `gold_pricing_signal` | 60 | Fact — one pricing signal per state × program (VEEV 51, ZYN 9) |
| `gold_dim_state` | 51 | State dimension (50 + DC) with lat/long |
| `gold_dim_program` | 3 | Program dimension (IQOS / ZYN / VEEV) |
| `gold_signals_by_action` | 5 | Rollup: signals per `pricing_action` |
| `gold_signals_by_program` | 2 | Rollup: signals per product line |
| `gold_state_tax_burden` | 34 | Rollup: taxed states with tax burden % |
| `gold_dim_date` | 6,381 | Calendar date dimension (daily grain, 2010-01-11 → 2027-07-01, 18 years) over the real dates in the CDC data |

`gold_pricing_signal` also carries three **CDC-sourced date columns** —
`reporting_year`, `reporting_quarter`, `effective_date` — populated **only** for
signals whose tax provision is a real CDC row (`dataset_id != "seed"`). Seed-driven
flavor-ban / PMTA signals leave all three NULL by design (see "CDC-only date
connection" below).

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
| Normalized CDC rows (`silver_regulatory_item`) | 3,947 |
| Pricing signals (`gold_pricing_signal`) | 60 |
| — VEEV / ZYN | 51 / 9 |
| Distinct states with a signal | 51 |
| `price_freely` | 25 |
| `delist_banned` | 18 |
| `adjust_for_tax` | 7 |
| `restricted_assortment` | 9 |
| `watch_pending` | 1 |
| Taxed states | 34 |
| Avg tax burden | ~24.2% |
| `gold_dim_date` rows | 6,381 (2010-01-11 → 2027-07-01, 18 years) |
| Signals with a CDC reporting year / effective date | 34 / 34 |
| — by action (`delist_banned` / `restricted_assortment` / `adjust_for_tax` / `price_freely`) | 9 / 5 / 7 / 13 |
| Seed-driven signals with NULL dates | 26 |

The 34 date-connected signals are exactly the CDC tax-carrying rows (= `gold_state_tax_burden`); the 26 NULL-date signals are the seed-driven flavor-ban / PMTA and ZYN rows. `34 + 26 = 60`, and the `pricing_action` distribution is unchanged — this change is additive columns only.

Key integrity: `count == distinct(id)` and 0 null ids on every keyed Silver/Gold
table.

## Semantic model

Direct Lake star over the Gold tables: fact `PricingSignal` (`gold_pricing_signal`)
+ `State` (`gold_dim_state`) + `Program` (`gold_dim_program`) + `Date`
(`gold_dim_date`) dimensions. Measures:

| Measure | Value |
|---|---:|
| Total Signals | 60 |
| Restricted or Banned States | 18 |
| Avg Tax Burden | 24.2 |
| Pending Risk States | 2 |
| Signals Needing Price Change | 35 |
| Signals with Effective Date | 34 |

### Date dimension — CDC-only connection (design decision)

`Date` is a Direct Lake table over `gold_dim_date`, marked as the model date table
(`dataCategory: Time` on the table, `Date` column keyed). It is joined to the fact
by **one** relationship — `PricingSignal.'Effective Date'` → `Date.Date`
(single-direction, many-to-one). The fact also exposes `Reporting Year` /
`Reporting Quarter`.

Because only CDC-sourced signals carry a non-null `Effective Date`, **only they
participate in date slicing** — this is the deliberate "connect only for CDC
sources" rule. The honest consequence: the seed-driven flavor-ban / PMTA signals
(the `delist_banned` / `restricted_assortment` hero rows) are **not date-sliceable
by design** — we do not fabricate dates for curated seeds. Verified live via
`executeQueries`: slicing `[Total Signals]` by `Date[Year]` returns 34 signals
across 2013-2027 plus a blank-year bucket of 26 (the seed rows).

Reframed (refreshed) after each load so Direct Lake picks up the latest Delta tables.
The committed TMDL under [`semantic-model/`](./semantic-model) is the source of truth;
the Git-synced export lives under `../workspace-sync/PMI Dynamic Pricing.SemanticModel`.

## Synthetic sales & demand forecast

> **⚠️ Synthetic data.** There is **no real PMI point-of-sale data** in this demo.
> The sales facts below are **generated deterministically** (fixed hash seed, no RNG
> draws) by the `02_pmi_sales_forecast` notebook. They are realistic-*shaped* — Poisson
> demand, population-weighted volume, seasonality, a mild uptrend — but **fabricated**,
> and exist purely to demonstrate how sales couple to the regulatory pricing signal.
> Every run reproduces the identical numbers.

A second, self-contained medallion notebook (`02_pmi_sales_forecast`) builds a daily
transaction-style sales fact, rolls it up to a monthly modeling grain, and produces a
demand forecast — all **coupled to `gold_pricing_signal`** so the regulatory story
drives the revenue story. It reads the existing `gold_pricing_signal` (coupling),
`gold_dim_date`, and `gold_dim_state`; it does **not** touch the pricing medallion or
its tables.

Grain: **daily** base fact (`date × state × city × shop × sku`, sparse — only rows with
`units > 0`) → **monthly** shop×SKU aggregate (the modeling layer) → **forecast** on the
monthly rollup. Only the two flavored heroes **ZYN + VEEV** are modeled (IQOS sales are
not invented).

| Table | Rows | Role |
|---|---:|---|
| `dim_city` | 110 | City dimension (city, state, population_weight) |
| `dim_shop` | 152 | Shop dimension (shop_id, name, city, state, channel ∈ convenience/tobacco/grocery) |
| `dim_sku` | 8 | SKU dimension (ZYN ×4 + VEEV ×4: program, flavor, pack) |
| `fact_sales_daily` | 1,240,390 | Daily transaction fact — units, unit_price, revenue (units > 0 only) |
| `gold_sales_monthly` | 88,128 | Monthly month×state×city×shop×sku — units, revenue, avg_price, baseline, revenue_at_risk |
| `gold_demand_forecast` | 11,856 | Actuals + forecast + 80% band, per program and program×state (104 series) |
| `gold_sales_by_program` | 2 | Rollup: units + revenue + revenue-at-risk per program |
| `ctl_sales_years` | 9 | Control table — per-year load status (resumable) |

Window **2018-01-01 → 2026-06-30** (contains all 9 VEEV flavor-ban cliffs); forecast
horizon **12 months** (Jul 2026 → Jun 2027).

### The coupling (sales are inseparable from the regulatory signal)

1. **Ban cliff** — for VEEV state×SKU under a flavor ban that has a real CDC
   `effective_date`, daily units run at baseline then **taper to zero** over
   `TAPER_DAYS` (45) ending at the effective date — a visible revenue cliff. **9
   cliffs**: CA (2022-07-01), DC (2021-10-01), MA (2020-06-01), MD (2024-06-01),
   ME (2020-01-02), NJ (2018-09-30), NY (2019-12-01), RI (2025-01-01), UT (2020-07-01).
   Real effective dates only — none fabricated.
2. **Revenue at risk** — for ZYN flavor-ban states (banned, no CDC date), in-market
   sales are forced to ~0 but the counterfactual baseline is retained as a
   `revenue_at_risk` measure. **9 at-risk state×SKUs** (ZYN in the same 9 states);
   total revenue-at-risk **$3,656,525**.
3. **Price / tax** — `unit_price` scales up with the state's `tax_burden` for
   `adjust_for_tax` states (50% pass-through); `price_freely` states stay at baseline;
   price varies slightly by channel. Volume scales with city `population_weight` +
   seasonality (summer/holiday lift) + a mild 6%/yr uptrend.

### Demand forecast

`gold_demand_forecast` fits each monthly series (per program, and per program×state
including a `state = "ALL"` national series — **104 series**) with **Holt-Winters
additive** (`statsmodels`, available in the Fabric runtime; a seasonal-naive +
linear-trend fallback is used if it is not). It stores actuals + forecast + lower/upper
**80% band** (±1.28σ) over a 12-month horizon. Fully seeded/deterministic.

### Validation gate — reconciled counts (verified live)

From `Files/_run/sales_summary.json` on the GREEN full-window run
(instance `02ce51af-…`):

| Metric | Value |
|---|---:|
| `fact_sales_daily` rows | 1,240,390 |
| `gold_sales_monthly` rows | 88,128 |
| Total units (daily == monthly) | 1,882,518 |
| Total revenue (daily == monthly) | $18,646,356.10 |
| Revenue at risk (banned, forgone) | $3,656,525.35 |
| Ban-cliff state×SKUs (VEEV) | 9 |
| At-risk state×SKUs (ZYN) | 9 |
| Forecast series | 104 (Holt-Winters additive) |

Key integrity: `count == distinct(id)` and 0 null ids on every keyed table. FK: 0 orphan
`date_key` / `shop_id` / `sku_id`. Additive-measure reconciliation: Σ daily units ==
Σ monthly units and Σ daily revenue == Σ monthly revenue (exact).

### Sales-notebook run knobs (override per job)

`YEARS` (e.g. `"2018"` for a single-year smoke; omit for the full window), `WRITE_MODE`,
`FORCE_REPROCESS`, `START_DATE`, `END_DATE`, `FORECAST_HORIZON`, `LAMBDA_BASE` (demand
scale — primary row-count knob), `TAPER_DAYS`, `TAX_PASSTHROUGH`, `TREND_ANNUAL`.
Per-year loop + `ctl_sales_years` control table make loads resumable. Build/run:

```bash
node fabric/notebooks/build_sales_notebook.mjs   # UPSERT-deploy (SKIP_DEPLOY=1 = export only)
node fabric/notebooks/run_sales_notebook.mjs      # run + poll (NB_PARAMS='{"YEARS":"2018"}' to scope)
```



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
