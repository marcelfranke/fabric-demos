# PMI Dynamic Pricing — Power BI Report

A 3-page Power BI report (PBIR) over the **PMI Dynamic Pricing** Direct Lake
semantic model in Microsoft Fabric — a pricing-decision dashboard that turns 50
states of tobacco/vapor law into a per-state **Pricing Signal**.

## Contents

- `PMI Dynamic Pricing.pbip` — Power BI project file (open this in Power BI Desktop).
- `PMI Dynamic Pricing.Report/` — the report definition (PBIR format), bound
  `byConnection` to the deployed semantic model
  (`semanticmodelid=6be9e165-fc81-4990-a479-a0cab935201c`).
- `pmi_report_gen.mjs` — deterministic generator that produces the `.Report`
  folder. Re-run with `node pmi_report_gen.mjs` to regenerate after edits.
- `deploy_report.mjs` — Fabric REST UPSERT deploy (auth via `az` at runtime; no
  stored secrets). See the publish note below — this tenant's ring currently
  rejects PBIR **API** import, so Desktop publish is the working path.

## Pages

1. **Pricing Overview** — KPI cards (Total Signals · Restricted or Banned States ·
   Avg Tax Burden % · Pending Risk States · Signals Needing Price Change); a **US
   filled map** coloured by `pricing_action`; a bar of signals-by-`pricing_action`;
   a Product-line (ZYN/VEEV/IQOS) slicer.
2. **Tax & Margin** — states by tax burden (bar, sorted desc; Colorado tops at
   62%), avg tax burden by program, and a table of the 34 taxed states with tax
   burden + pricing action + recommendation.
3. **Compliance & Assortment** — clustered bar of signals-by-action per program,
   a State × Program matrix of `pricing_action`, and a list of the gated states
   (delist / restricted / watch_pending).

### Pricing-action colours

The report registers a custom theme (`StaticResources/RegisteredResources/PMIPricing.json`)
whose palette maps to `pricing_action` (categories are sorted ascending so each
action gets its intended colour):

| pricing_action | colour |
|---|---|
| `adjust_for_tax` | amber `#E8A317` |
| `delist_banned` | rose `#C6395F` |
| `price_freely` | green `#2E8B57` |
| `restricted_assortment` | orange `#E8703A` |
| `watch_pending` | blue/purple `#5B5FC7` |

## Semantic model binding

- Workspace: **Dynamic Pricing** (`aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05`)
- Model: **PMI Dynamic Pricing** (`6be9e165-fc81-4990-a479-a0cab935201c`) — Direct
  Lake over `pmi_lakehouse` Gold tables.
- Tables referenced: `PricingSignal` (fact = `gold_pricing_signal`), `State`
  (`gold_dim_state`, lat/long), `Program` (`gold_dim_program`).
- Measures used: Total Signals, Restricted or Banned States, Avg Tax Burden,
  Pending Risk States, Signals Needing Price Change (all defined on the model — no
  new measures were added for this report).

## How to publish (Power BI Desktop)

> The report is validated (all definition JSON parses, binds to the live model),
> but this Fabric tenant's Power BI ring currently rejects PBIR **API** import
> with:
>
> ```
> Report_Import_FailedToImportReport: Can't resolve schema '1.0.0' in
> 'version.json'. This report was edited in a newer version of Power BI that
> isn't compatible with your current version.
> ```
>
> This is the same ring limitation documented for the European Patents report.
> Publishing from Power BI Desktop negotiates the version client-side and works.

1. Install / open the latest **Power BI Desktop**.
2. Enable the PBIP format: **File → Options and settings → Options → Preview
   features → "Power BI Project (.pbip) save option"** (already on in recent builds).
3. Open **`PMI Dynamic Pricing.pbip`**. When prompted, sign in with the Fabric
   tenant account (`admin@M365CPI55671697.onmicrosoft.com`). The report is a
   thin/live report bound to the published semantic model.
4. Verify the visuals render, then **Home → Publish → Dynamic Pricing** workspace.

Once published from Desktop, the report can be committed back to Git from the
workspace (this ring is Commit-only; never run Git → workspace Update/Sync).

## Key insights (live model — reconciled with the app)

- **57** pricing signals across **51** states (VEEV 51, ZYN 6; IQOS = federal
  context only).
- **12** state×program combinations are `delist_banned` (flavor bans: CA, MA, NJ,
  NY, RI, UT × ZYN + VEEV) and **9** are `restricted_assortment` (PMTA registry
  states, VEEV).
- **34** states carry a vapor excise tax; **average burden ≈ 24.2%**. **Colorado
  leads at 62%** → `adjust_for_tax`.
- Only **1** `watch_pending` signal (Iowa registry bill — pricing risk to watch).
- **31** signals need a price change this quarter (any action other than
  `price_freely`); **26** states can `price_freely`.
