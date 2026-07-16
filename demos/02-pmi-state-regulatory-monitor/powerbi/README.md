# PMI Dynamic Pricing — Power BI Report

A 4-page Power BI report (PBIR) over the **PMI Dynamic Pricing** Direct Lake
semantic model in Microsoft Fabric — a pricing-decision dashboard that turns 50
states of tobacco/vapor law into a per-state **Pricing Signal**. Styled in
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

Every page carries a slim **top nav-pill strip** (a white rounded pill with the 6
page names as tabs — the active tab bold near-navy `#14213D` with a brand-blue
`#0074C2` underline; a right-aligned `Philip Morris International · State
Regulatory Monitor` wordmark + a `0N / 06` page indicator) over a big near-black
Lato page title, on a near-white `#F7F9FC` canvas — mirroring the *Value Report
2025* section headers (pp. 2/6).

1. **Command Center** — a compact **"three rule types" framing strip** (EXCISE TAX →
   moves the margin floor · FLAVOR BAN → SKU illegal, delist · PMTA REGISTRY LAW →
   gates the assortment, each with its action-colour dot); 5 KPI cards rendered as
   solid **deep-blue hero cards with large white Lato numbers** + white uppercase
   captions (the *Value Report 2025* p6 "pop": Total Signals · Restricted or Banned
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
5. **Demand & Revenue** *(synthetic sales — Phase 3)* — 4 deep-blue hero KPIs
   (**Total Units ≈ 1.88M** · **Total Revenue $18.65M** · **Avg Price $9.91** ·
   **Revenue at Risk $3.66M**); a units-by-product column, a **revenue by product ×
   channel** clustered column (per-visual convenience/grocery/tobacco colours), an
   **avg price by state × channel** matrix, a **top shops & cities** table (sorted by
   revenue desc), a **recent transactions (POS)** table (sorted date desc), and a
   Product-line slicer. Bound to the additive `SalesMonthly`/`SalesDaily` tables. A
   prominent note states the sales are **synthetic** (no real PMI POS).
6. **Forecast & Simulation** *(demand outlook + price what-if — Phase 3)* — 4 hero
   KPIs (**Baseline Revenue (Sellable) $17.39M** · **Sim Revenue** · **Revenue Delta**
   · **Revenue at Risk $3.66M**); a **national demand forecast + 80% band** line
   (`Forecast[State] = ALL` to avoid double-counting the per-state series), a
   **ban-cliff-over-time** line filtered to `Is Banned = true` (VEEV visibly tapers to
   zero as flavor bans take effect; ZYN flat at zero), a **Baseline vs Simulated**
   clustered column, a **revenue-at-risk by product** column (delist-red), and two
   **what-if slicers** — *Price change %* (−20%…+30%) and *Elasticity* (−1.5…0.0).
   The slicers rest **unselected**, so Sim Revenue == Baseline (Delta $0) until the
   presenter dials a value; `Sim Revenue` is forced to 0 where a SKU is banned.

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
  **Roboto**. Georgia and Segoe UI are fully removed.

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
  Direct Lake). All 6 pages render.

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
locally. All 6 pages verified: near-white `#F7F9FC` canvas, the white top nav-pill
strip (active tab underlined in brand blue) + wordmark + `0N / 06` page indicator
+ big near-black Lato page title, **deep-blue KPI hero cards with white numbers**,
light readable p16-style tables (near-black header on `#EAF3FB` tint + bottom rule,
`#F4F6FA` banding, navy text; matrix left column solid brand-blue + white text),
the per-visual action-palette map + bars, amber tax bars, the brand-blue timeline
line/column, the Command Center **framing strip** and state-reactive **Pricing
Decision** card (defaults to New Jersey + VEEV — rendered populated in the
exported PDF: "New Jersey", No - delisted, 0.1%, `delist_banned` in rose, "Delist:
VEEV flavored SKUs banned in New Jersey").

Pages 5–6 (Phase 3) were re-exported and inspected after the *Value Report 2025*
reskin: **Demand & Revenue** binds the synthetic sales star (hero KPIs 1.88M units
/ $18.65M / $9.91 / $3.66M at-risk; per-channel revenue colours; top-shops and
recent-POS tables sorted desc). **Forecast & Simulation** rests at baseline
(Simulated $17.39M == Baseline, Delta **$0**) until a slider is dialled, the
national forecast line shows the 80% band + amber forecast tail, and the ban-cliff
line (filtered to `Is Banned = true`) shows VEEV tapering to zero as bans take
effect. All series colours are per-visual so they survive the theme-less ExportTo.

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
>   `#7A5CD0`); tax bars are single-fill amber `#E8A23D`; the timeline line **and**
>   quarter column are brand blue `#0074C2`. These render on-brand in the exported
>   PDF — no monochrome base-blue.
> - **Tables (per-visual light objects):** `tableEx`/`pivotTable` set explicit
>   p16-style light `values` / `columnHeaders` / `total` / `grid` (+ matrix
>   `rowHeaders`): near-black bold header on a light `#EAF3FB` tint with a bottom
>   rule, white/`#F4F6FA` alternating rows, navy ink text, `#E6EBF2` gridlines, and
>   (on the matrix) a solid brand-blue left category column with white text. On a
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
