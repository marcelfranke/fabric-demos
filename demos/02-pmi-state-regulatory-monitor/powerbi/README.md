# PMI Dynamic Pricing — Power BI Report

A 5-page Power BI report (PBIR) over the **PMI Dynamic Pricing** Direct Lake
semantic model in Microsoft Fabric — an executive dashboard that tells the full
story end-to-end: state regulatory **rules** → per-state **Pricing Signal** →
**revenue at risk** → **demand forecast** → **what-if price simulation**. Styled in
**PMI's real corporate identity** (from PMI's official *Value Report 2025*): a
confident light + deep-blue two-tone system (brand blue `#0074C2`, near-black
navy headlines `#14213D`, Lato + Roboto typography, deep-blue KPI hero cards with
white numbers).

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

Every page carries a slim **top nav-pill strip** (a white rounded pill with the 5
page names as tabs — the active tab bold near-navy `#14213D` with a brand-blue
`#0074C2` underline; a right-aligned `Philip Morris International · State
Regulatory Monitor` wordmark + a `0N / 05` page indicator) over a big near-black
Lato page title, on a near-white `#F7F9FC` canvas — mirroring the *Value Report
2025* section headers (pp. 2/6).

1. **Command Center** — a compact **"three rule types" framing strip** (EXCISE TAX →
   moves the margin floor · FLAVOR BAN → SKU illegal, delist · PMTA REGISTRY LAW →
   gates the assortment, each with its action-colour dot); 5 KPI cards rendered as
   solid **deep-blue hero cards with large white Lato numbers** + white uppercase
   captions (the *Value Report 2025* p6 "pop": Total Signals · Restricted or Banned
   States · Avg Tax Burden % · **Revenue at Risk** `$3.66M` · Signals Needing Price
   Change); a **US filled map** coloured by `pricing_action`; a bar of
   signals-by-`pricing_action`; a Product-line (ZYN/VEEV/IQOS) slicer; and a
   state-reactive **Pricing Decision** card that reads the state selected on the map
   (× the product slicer) and shows Sellable? / Tax burden % / pricing action (in its
   action colour) / recommendation. It **defaults to New Jersey** (the flavor-ban
   delist — the dramatic aha) whenever no single state is cross-filtered, so it always
   renders a real, populated decision (map-click and the product slicer override it).
   Driven by `SELECTEDVALUE`/`CALCULATE` measures over the real `gold_pricing_signal`
   rows — no fabricated values.
2. **Tax & Margin** — states by tax burden (bar, sorted desc; Colorado tops at
   62%), avg tax burden by program, an Avg Tax Burden KPI, and a table of the 34
   taxed states with tax burden + pricing action + recommendation.
3. **Compliance & Assortment** — clustered bar of signals-by-action per program
   (per-visual action palette), a State × Program list of `pricing_action`, and a
   list of the gated states (delist / restricted / watch_pending).
4. **Revenue at Risk** — the money the rules put on the table. 4 deep-blue KPI heroes
   (Total Revenue `$18.65M` · Baseline Revenue `$22.30M` · **Revenue at Risk** `$3.66M`
   · Total Units `1.88M`); an actual-vs-baseline revenue line by year; a revenue-at-risk
   column by year; a **risk-by-banned-state** bar (CA `$911K`, NY `$669K`, MA `$533K`,
   NJ `$428K`, DC, UT …); and a **risk-by-program** donut (VEEV `$2.21M` / 60% · ZYN
   `$1.45M` / 40%). Revenue at Risk = baseline revenue on SKUs a state's rules make
   unsellable, coupled to each ban's effective date. The 2026 dip is a truthful
   partial-year artifact (data ends 2026-06). Carries the CDC-dated honesty note.
5. **Forecast & Price Simulation** — 4 deep-blue KPI heroes (Forecast Units `512.7K` ·
   Forecast Revenue `$5.00M` · **Sim Revenue @ +12%** `$17.61M` · **Sim Δ @ +12%**
   `$217K`); a units line with **actual + forecast + lower/upper confidence band** by
   month; a **price-optimization curve** (Sim Revenue Δ vs Price Change %, a textbook
   concave parabola peaking ≈ +$217K near +12%); and **Price change %** + **Elasticity**
   what-if slider slicers. The two Sim KPI cards are pinned via a visual-level filter to
   the +12% optimum so the exported PDF shows a live sim; the optimization curve is left
   unfiltered so the full response renders. Elasticity held at −0.8.

### Light + deep-blue theme (PMI *Value Report 2025* identity)

The report registers a custom theme
(`StaticResources/RegisteredResources/PMIPricing.json`) built from PMI's official
*Value Report 2025* design system — a confident **light + deep-blue two-tone**
look (not flat-light, not dark):

- **Canvas** near-white `#F7F9FC` (very slightly cool).
- **White cards** with a thin blue `#CFE0F2` border + `#E6EBF2` hairline dividers,
  rounded ~14-16px.
- **Deep-blue KPI hero cards** — solid `#0A5AB5` fill with large **white Lato**
  numbers + white uppercase captions. This is the signature *Value Report 2025* p6
  "pop." (Power BI PBIR card backgrounds don't support real CSS gradients in this
  ring, so the deep-blue "gradient" is a **solid `#0A5AB5` fill** approximation —
  it still reads as the on-brand deep-blue hero.)
- **Light-blue tint cards** `#EAF3FB` for secondary/notes surfaces (the framing
  strip, the Pricing Decision panel).
- **Near-black navy headlines** `#14213D` (INK — the big Lato page titles look
  almost black, matching the report's section heads).
- Signature **PMI brand blue `#0074C2`** for key series, the nav underline, and
  accents; deep navy `#00335C` for secondary heads.
- Headlines / KPI numbers are **Lato** (Black/Bold), body / labels / tables are
  **Roboto**. Georgia is fully removed. Display textbox runs (page titles, section
  labels, framing-strip headings) carry an explicit `Lato, sans-serif` family so the
  ExportTo-PDF renderer — which does not embed Lato — resolves to a clean sans face
  instead of substituting a serif; a bare `Lato` with no fallback renders serif in
  the export and is avoided everywhere.

Supporting blue tints `#4BA3DB` / `#7FC4E8` / `#D6E8F5` carry program splits and
secondary series — one dominant colour (blue) + tints, with the saturated status
palette reserved for the `pricing_action` encoding.

### Pricing-action colours

The status palette is set **per-visual** (see the QA note) and resaturated to
read on white cards. Categories are sorted **alphabetically** so each action gets
its intended colour:

| pricing_action | colour |
|---|---|
| `adjust_for_tax` | amber `#E8A23D` |
| `delist_banned` | red/rose `#E0523E` |
| `price_freely` | green `#2E9E6B` |
| `restricted_assortment` | blue `#3D7DD8` |
| `watch_pending` | purple `#7A5CD0` |

## Semantic model binding

- Workspace: **Dynamic Pricing** (`aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05`)
- Model: **PMI Dynamic Pricing** (`6be9e165-fc81-4990-a479-a0cab935201c`) — Direct
  Lake over `pmi_lakehouse` Gold tables.
- Tables referenced: `PricingSignal` (fact = `gold_pricing_signal`), `State`
  (`gold_dim_state`, lat/long), `Program` (`gold_dim_program`), `Date`
  (`gold_dim_date`, a daily calendar), plus the revenue/forecast layer:
  `SalesMonthly` (`gold_sales_monthly` — synthetic monthly sales fact),
  `Forecast` (`gold_forecast` — actual + forecast units with a confidence band),
  and the what-if parameter tables `Price Change %` and `Elasticity`.
- Fact date columns (CDC-sourced only): `Effective Date`, `Reporting Year`,
  `Reporting Quarter`.
- Regulatory measures: Total Signals, Restricted or Banned States, Avg Tax Burden,
  Pending Risk States, Signals Needing Price Change, `Signals with Effective Date`
  (= 34), and the Pricing Decision `Selected …` measures.
- Revenue/forecast measures: `Total Revenue`, `Baseline Revenue`, `Revenue at Risk`,
  `Total Units`, `Baseline Units`, `Avg Price` (SalesMonthly); `Actual Units`,
  `Forecast Units`, `Forecast Revenue`, `Forecast Lower`, `Forecast Upper` (Forecast);
  and `Sim Revenue` / `Sim Revenue Delta` (what-if, over `Price Change %` × `Elasticity`).

### CDC-only date connection

The `Date` table relates to the fact **only** through
`PricingSignal[Effective Date]`, which is populated **only for CDC-sourced
signals**. So the Revenue at Risk page's date-driven visuals slice only the **34**
CDC-dated signals; the **26** seed-driven flavor-ban / PMTA signals have a null
effective date by design and are intentionally not date-sliceable — no dates are
fabricated for them.

## How to publish (Fabric REST API — deployed)

The report is **published to the workspace via the Fabric REST API** by
`deploy_report.mjs` (UPSERT: update-if-exists else create; auth via `az` at
runtime). It is live in **Dynamic Pricing**:

- Report item id: **`424faa25-2e39-4830-8725-09c77684d11a`**
- URL: <https://app.powerbi.com/groups/aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05/reports/424faa25-2e39-4830-8725-09c77684d11a>
- Bound to dataset `6be9e165-fc81-4990-a479-a0cab935201c` (PMI Dynamic Pricing,
  Direct Lake). All 5 pages render.

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

**Regulatory signal layer**

- **60** pricing signals across **51** states (VEEV 51, ZYN 9; IQOS = federal
  context only).
- **18** state×program combinations are `delist_banned` (statewide flavor bans:
  CA, DC, MA, MD, ME, NJ, NY, RI, UT × ZYN + VEEV) and **9** are
  `restricted_assortment` (PMTA registry states, VEEV).
- **34** states carry a vapor excise tax; **average burden ≈ 24.2%**. **Colorado
  leads at 62%** → `adjust_for_tax`. **7** signals are `adjust_for_tax`.
- Only **1** `watch_pending` signal (Iowa registry bill — pricing risk to watch);
  **2** pending-risk states.
- **35** signals need a price change this quarter (any action other than
  `price_freely`); **25** signals `price_freely`.
- **34** of 60 signals carry a CDC effective date (date-sliceable); the other
  **26** are seed-driven and undated.

**Revenue / forecast / what-if layer**

- **Total Revenue `$18.65M`** vs **Baseline Revenue `$22.30M`** →
  **Revenue at Risk `$3.66M`** across banned states (VEEV `$2.21M` / 60%, ZYN
  `$1.45M` / 40%); **1.88M** units over 88,128 monthly rows (2018-01 … 2026-06).
- Risk concentrated in CA `$911K`, NY `$669K`, MA `$533K`, NJ `$428K`, DC `$297K`,
  UT `$278K`, MD `$215K`, ME `$191K`.
- Forecast horizon to **2027-06**: **512.7K** forecast units, **`$5.00M`** forecast
  revenue, with a lower/upper confidence band.
- **What-if price simulation** (elasticity −0.8) is a concave optimization curve
  peaking at **≈ +$217K around +12%** (−20% → −$1.25M, 0% → ~$0, +30% → −$209K);
  at the +12% optimum, **Sim Revenue `$17.61M`**, **Sim Δ `$217K`**.

## QA — rendered verification

Each page was rendered and inspected. **ExportTo image (PNG) is disabled
tenant-wide** on this capacity (`403 … Export report to image is disabled on
tenant level`), so QA used the **ExportTo PDF** path (`POST
/reports/{id}/ExportTo {format:"PDF"}` → poll → GET file), rendered to PNG
locally. All **5** pages verified: near-white `#F7F9FC` canvas, the white top nav-pill
strip (active tab underlined in brand blue) + wordmark + `0N / 05` page indicator
+ big near-black Lato page title, **deep-blue KPI hero cards with white numbers**,
light readable p16-style tables, the per-visual action-palette map + bars, amber tax
bars, blue-family clustered bars, the **Revenue at Risk** page (heroes `$18.65M` /
`$22.30M` / `$3.66M` / `1.88M`, risk-by-state bar, risk-by-program donut), the
**Forecast** page (forecast confidence band, concave optimization curve, Sim Δ `$217K`
pinned to +12%), the Command Center **framing strip** and state-reactive **Pricing
Decision** card (defaults to New Jersey — rendered populated in the exported PDF:
"New Jersey", No - delisted, `delist_banned` in rose, "Delist: VEEV flavored SKUs
banned in New Jersey").

> **ExportTo caveat:** the PDF/image export path on this capacity renders with
> the **base theme** (the custom theme is dropped in export), so anything driven
> only by the theme is under-represented in the exported PNGs. To make the CI
> robust, **series colours and table surfaces are set per-visual** (not via the
> theme) so they survive both paths:
>
> - **Chart series (verified in export):** each `pricing_action` bar/map segment
>   is coloured by the status palette via per-category `dataPoint` fills
>   (adjust_for_tax amber `#E8A23D`, delist_banned rose `#E0523E`, price_freely
>   green `#2E9E6B`, restricted_assortment blue `#3D7DD8`, watch_pending purple
>   `#7A5CD0`); tax bars are single-fill amber `#E8A23D`; the revenue-at-risk
>   column/bar are rose `#E0523E`; the actual-vs-baseline, forecast band and
>   optimization-curve series are set per-series (brand blue `#0074C2`, navy
>   `#00335C`, sky `#7FC4E8`) and the risk-by-program donut per-category by program.
>   These render on-brand in the exported PDF — no monochrome base-blue.
> - **Tables (per-visual light objects):** `tableEx`/`pivotTable` set explicit
>   p16-style light `values` / `columnHeaders` / `total` / `grid` (+ matrix
>   `rowHeaders`): near-black bold header on a **white** surface with a bottom
>   rule, white/`#F4F6FA` alternating rows, navy ink text, `#E6EBF2` gridlines, and
>   (on the matrix) a solid brand-blue left category column with white text — the
>   *Value Report 2025* p16 "Business Transformation Metrics" table pattern. On a
>   **light** theme the ExportTo table renderer's opaque light cell fill is a
>   non-issue — tables render clean and consistent in both the service and the PDF
>   export (the white-primary-row artifact that fought the previous dark design no
>   longer applies).
>
> **Why per-visual (not theme):** the ExportTo renderer drops the entire custom
> theme (its `dataColors` never reach the export), and this ring silently discards
> the whole theme if the `visualStyles` block contains any unsupported property — so
> theme-only styling is unreliable in both export and service. Colours and surfaces
> are therefore set **per-visual** on every chart/table.
>
> **Minor export glyph:** the ExportTo `card`-visual renderer draws a small grey
> placeholder glyph in each KPI / decision card that `visualHeader:{show:false}`
> does not suppress in the export path (more visible on the deep-blue hero cards).
> It is **export-only** — the interactive Power BI service (where the demo is shown)
> renders the cards clean.
