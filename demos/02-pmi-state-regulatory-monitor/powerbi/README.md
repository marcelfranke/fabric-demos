# PMI Dynamic Pricing — Power BI Report

A 4-page Power BI report (PBIR) over the **PMI Dynamic Pricing** Direct Lake
semantic model in Microsoft Fabric — a pricing-decision dashboard that turns 50
states of tobacco/vapor law into a per-state **Pricing Signal**. Styled with a
dark, premium **"midnight ink + chartreuse"** corporate identity.

## Contents

- `PMI Dynamic Pricing.pbip` — Power BI project file (open this in Power BI Desktop).
- `PMI Dynamic Pricing.Report/` — the report definition (PBIR format), bound
  `byConnection` to the deployed semantic model
  (`semanticmodelid=6be9e165-fc81-4990-a479-a0cab935201c`).
- `pmi_report_gen.mjs` — deterministic generator that produces the `.Report`
  folder. Re-run with `node pmi_report_gen.mjs` to regenerate after edits.
- `deploy_report.mjs` — Fabric REST UPSERT deploy (auth via `az` at runtime; no
  stored secrets). This publishes the report to the workspace via the API — see
  the deploy note below.

## Pages

Every page carries a hero header band (dark `#141221` strip, Georgia cream title,
a thin chartreuse rule, and a right-aligned `PMI · STATE REGULATORY MONITOR`
wordmark) over a midnight-ink `#0A0911` canvas.

1. **Command Center** — a compact **"three rule types" framing strip** (EXCISE TAX →
   moves the margin floor · FLAVOR BAN → SKU illegal, delist · PMTA REGISTRY LAW →
   gates the assortment, each with its action-colour dot); 5 KPI cards with
   chartreuse hero numbers on dark tiles (Total Signals · Restricted or Banned
   States · Avg Tax Burden % · Pending Risk States · Signals Needing Price Change);
   a **US filled map** coloured by `pricing_action`; a bar of
   signals-by-`pricing_action`; a Product-line (ZYN/VEEV/IQOS) slicer; and a
   state-reactive **Pricing Decision** card that reads the state selected on the map
   (× the product slicer) and shows Sellable? / Tax burden % / pricing action (in its
   action colour) / recommendation. It **defaults to New Jersey + VEEV** (the
   flavor-ban delist — the deck's dramatic aha) whenever no single state is
   cross-filtered, so it always renders a real, populated decision (map-click and the
   product slicer override it). Driven by `SELECTEDVALUE`/`CALCULATE` measures over the
   real `gold_pricing_signal` rows — no fabricated values.
2. **Tax & Margin** — states by tax burden (bar, sorted desc; Colorado tops at
   62%), avg tax burden by program, an Avg Tax Burden KPI, and a table of the 34
   taxed states with tax burden + pricing action + recommendation.
3. **Compliance & Assortment** — clustered bar of signals-by-action per program
   (per-visual action palette), a State × Program list of `pricing_action`, and a
   list of the gated states (delist / restricted / watch_pending).
4. **Regulatory Timeline** — showcases the Date dimension (PR #18): a line chart
   of Total Signals by `Date`-driven reporting year (peaks in 2019), a column
   chart by reporting quarter (2013-Q3 … 2027-Q3), a Reporting-year slicer, a
   `Signals with Effective Date` KPI (**34**), and an honesty note — only the
   **34** CDC-dated signals are date-sliceable; the **26** seed-driven
   flavor-ban/PMTA signals are undated by design (no fabricated dates). See the
   *CDC-only date connection* note below.

### Dark theme (corporate identity)

The report registers a custom dark theme
(`StaticResources/RegisteredResources/PMIPricing.json`): midnight-ink canvas
`#0A0911`, panel/card surfaces `#141221`, hairline borders `#2A2733`, cream text
`#F4ECDF`, muted secondary `#9A93A6`, and the signature accent **chartreuse
`#D4FF3A`** used for KPI hero numbers and the title rule. Headlines are Georgia,
body is Segoe UI. Per-page `wallpaper`/`background` objects paint the whole canvas
midnight.

### Pricing-action colours

The theme's `dataColors` map to `pricing_action` (categories are sorted
**alphabetically** so each action gets its intended colour):

| pricing_action | colour |
|---|---|
| `adjust_for_tax` | amber `#FFB020` |
| `delist_banned` | rose `#FF5C6A` |
| `price_freely` | green `#5FD08B` |
| `restricted_assortment` | sky `#5AA9FF` |
| `watch_pending` | purple `#8A7CFF` |

## Semantic model binding

- Workspace: **Dynamic Pricing** (`aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05`)
- Model: **PMI Dynamic Pricing** (`6be9e165-fc81-4990-a479-a0cab935201c`) — Direct
  Lake over `pmi_lakehouse` Gold tables.
- Tables referenced: `PricingSignal` (fact = `gold_pricing_signal`), `State`
  (`gold_dim_state`, lat/long), `Program` (`gold_dim_program`), and `Date`
  (`gold_dim_date`, a daily calendar) — added in PR #18.
- Fact date columns (PR #18, CDC-sourced only): `Effective Date`,
  `Reporting Year`, `Reporting Quarter`.
- Measures used: Total Signals, Restricted or Banned States, Avg Tax Burden,
  Pending Risk States, Signals Needing Price Change, and `Signals with Effective
  Date` (= 34; the count of CDC-dated signals).

### CDC-only date connection

The `Date` table relates to the fact **only** through
`PricingSignal[Effective Date]`, which is populated **only for CDC-sourced
signals**. So the Regulatory Timeline page slices only the **34** CDC-dated
signals; the **26** seed-driven flavor-ban / PMTA signals have a null effective
date by design and are intentionally not date-sliceable — no dates are
fabricated for them.

## How to publish (Fabric REST API — deployed)

The report is **published to the workspace via the Fabric REST API** by
`deploy_report.mjs` (UPSERT: update-if-exists else create; auth via `az` at
runtime). It is live in **Dynamic Pricing**:

- Report item id: **`424faa25-2e39-4830-8725-09c77684d11a`**
- URL: <https://app.powerbi.com/groups/aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05/reports/424faa25-2e39-4830-8725-09c77684d11a>
- Bound to dataset `6be9e165-fc81-4990-a479-a0cab935201c` (PMI Dynamic Pricing,
  Direct Lake). All 4 pages render.

```
node powerbi/deploy_report.mjs
```

### PBIR schema note (what makes the API import succeed)

An earlier attempt failed with
`Report_Import_FailedToImportReport: Can't resolve schema '1.0.0' in
'version.json'`. The fix was to match the exact PBIR schema versions this Fabric
ring accepts (verified by exporting a known-good report already in the tenant via
`GET .../reports/{id}/getDefinition?format=PBIR`):

| file | accepted `$schema` / value |
|---|---|
| `definition/version.json` | `versionMetadata/1.0.0`, `version: "2.0.0"` (was `version/1.0.0` + `"1.0"`) |
| `definition/report.json` | `report/3.3.0` (was `report/2.0.0`); **requires** a `reportVersionAtImport` object on every theme |
| `definition/pages/pages.json` | `pagesMetadata/1.0.0` (was `pagesMetadata/2.0.0`) |
| `definition.pbir` | `definitionProperties/2.0.0`, `version: "4.0"` (unchanged) |
| `page.json` / `visual.json` | `page/2.1.0` / `visualContainer/2.9.0` (already accepted) |

These versions are baked into `pmi_report_gen.mjs`, so `node pmi_report_gen.mjs`
regenerates a definition the API accepts.

### Alternative: publish from Power BI Desktop

The `.pbip` also opens and publishes cleanly from Desktop:

1. Install / open the latest **Power BI Desktop**.
2. Enable the PBIP format: **File → Options and settings → Options → Preview
   features → "Power BI Project (.pbip) save option"** (already on in recent builds).
3. Open **`PMI Dynamic Pricing.pbip`**. When prompted, sign in with the Fabric
   tenant account (`admin@M365CPI55671697.onmicrosoft.com`). The report is a
   thin/live report bound to the published semantic model.
4. Verify the visuals render, then **Home → Publish → Dynamic Pricing** workspace.

> This ring is Commit-only for Git integration; never run Git → workspace
> Update/Sync.

## Key insights (live model — reconciled with the app)

- **60** pricing signals across **51** states (VEEV 51, ZYN 9; IQOS = federal
  context only).
- **18** state×program combinations are `delist_banned` (statewide flavor bans:
  CA, DC, MA, MD, ME, NJ, NY, RI, UT × ZYN + VEEV) and **9** are
  `restricted_assortment` (PMTA registry states, VEEV).
- **34** states carry a vapor excise tax; **average burden ≈ 24.2%**. **Colorado
  leads at 62%** → `adjust_for_tax`. **7** signals are `adjust_for_tax`.
- Only **1** `watch_pending` signal (Iowa registry bill — pricing risk to watch).
- **35** signals need a price change this quarter (any action other than
  `price_freely`); **25** signals `price_freely`.
- **34** of 60 signals carry a CDC effective date (date-sliceable on the
  Regulatory Timeline page); the other **26** are seed-driven and undated.

## QA — rendered verification

Each page was rendered and inspected. **ExportTo image (PNG) is disabled
tenant-wide** on this capacity (`403 … Export report to image is disabled on
tenant level`), so QA used the **ExportTo PDF** path (`POST
/reports/{id}/ExportTo {format:"PDF"}` → poll → GET file), rendered to PNG
locally. All 4 pages verified: midnight canvas, dark hero headers with chartreuse
rules, chartreuse KPI heroes on dark cards, dark slicers/notes/charts, the
per-visual action-palette map + bars, the Command Center **framing strip** and
state-reactive **Pricing Decision** card (defaults to New Jersey + VEEV — rendered
populated in the exported PDF: "New Jersey", No - delisted, 0.1%, delist_banned in
rose, "Delist: VEEV flavored SKUs banned in New Jersey"), and the
date-trend line/column charts on the Regulatory Timeline page.

> **ExportTo caveat:** the PDF/image export path on this capacity renders with
> the **base theme** (the custom theme is dropped in export), so anything driven
> only by the theme is under-represented in the exported PNGs. To make the CI
> robust, **series colours and table surfaces are set per-visual** (not via the
> theme) so they survive both paths:
>
> - **Chart series (verified in export):** each `pricing_action` bar/map segment
>   is coloured by the status palette via per-category `dataPoint` fills
>   (adjust_for_tax amber `#FFB020`, delist_banned rose `#FF5C6A`, price_freely
>   green `#5FD08B`, restricted_assortment sky `#5AA9FF`, watch_pending purple
>   `#8A7CFF`); tax bars are single-fill amber; the timeline line **and** quarter
>   column are chartreuse `#D4FF3A`. These render on-brand in the exported PDF — no
>   more monochrome base-blue.
> - **Tables (per-visual dark objects):** `tableEx`/`pivotTable` set explicit dark
>   `values` / `columnHeaders` / `total` / `grid` (+ matrix `rowHeaders`) so they
>   are dark in the interactive service.
>
> **Why per-visual (not theme):** the ExportTo renderer drops the entire custom
> theme (its `dataColors` never reach the export), and this ring silently discards
> the whole theme if the `visualStyles` block contains any unsupported property — so
> theme-only styling is unreliable in both export and service. Colours and dark
> surfaces are therefore set **per-visual** on every chart/table.
>
> **Known ExportTo limitation (table primary rows):** on this ring the export
> renderer paints table/matrix **data cells with an opaque light fill that no
> per-visual property overrides** — only `backColorSecondary` (alternate rows),
> `total`, `columnHeaders`, matrix `rowHeaders`, and the visual container background
> survive. This was proven exhaustively across six approaches: static
> `values.backColor`, a **measure-bound conditional-format** fill, `stylePreset:'None'`,
> a **transparent** cell fill, a **rows-only "flat matrix"** (which this ring collapses
> to its first field), and a **crosstab matrix** (row headers render dark but the value
> cells stay light). Consequently, exported table **primary/odd rows appear white**
> (they render with dark, still-legible text), while every other surface — headers,
> total, alternate rows, grid, all charts, KPI cards, the framing strip, the Pricing
> Decision card, and the midnight canvas — renders dark/on-brand in the export. The
> interactive Power BI service applies the per-visual dark `values` styling, so tables
> display **fully dark in-service**; the white primary rows are an **export-only**
> residual, not a model or in-service defect.
