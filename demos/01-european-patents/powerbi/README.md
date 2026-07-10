# European Patents — Power BI Report

A 3-page Power BI report (PBIR) over the EPO **European Patents** Direct Lake
semantic model in Microsoft Fabric.

## Contents

- `European Patents.pbip` — Power BI project file (open this in Power BI Desktop).
- `European Patents.Report/` — the report definition (PBIR format).
- `eps_report_gen.mjs` — deterministic generator that produces the `.Report`
  folder. Re-run with `node eps_report_gen.mjs` to regenerate after edits.

## Pages

1. **Overview** — KPI cards (Total Patents, Distinct Applicants, Distinct
   Inventors, Avg Inventors/Patent), slicers (Year-Month, IPC Section, Kind
   Code, Language), Patents by Year-Week, Patents by IPC Section, Patents by
   Kind Code.
2. **Technology & Classification** — Scheme/Section slicers, Section by
   Patents-per-Classification, Symbol treemap, Section × Symbol matrix.
3. **Applicants & Inventors** — Top-15 applicants, Top-15 inventors, applicant
   country map, applicant detail matrix.

## How to publish (Power BI Desktop)

> The report is validated (0 errors) but this Fabric tenant's Power BI ring
> currently rejects PBIR **API** import (`version.json` schema too new).
> Publishing from Power BI Desktop negotiates the version client-side and works.

1. Install / open the latest **Power BI Desktop**.
2. Enable the PBIP format: **File → Options and settings → Options → Preview
   features → "Power BI Project (.pbip) save option"** (on recent builds this is
   already enabled).
3. Open **`European Patents.pbip`**. When prompted, sign in with the Fabric
   tenant account (`admin@M365CPI55671697.onmicrosoft.com`). The report is a
   thin/live report bound to the published semantic model
   (`semanticmodelid=4ff3efcc-8540-4349-9d2e-0dcf149e3332`).
4. Verify the visuals render, then **Home → Publish → European Patents**
   workspace.

## Semantic model

- Workspace: **European Patents**
- Model: **European Patents** (Direct Lake over `eps_lakehouse`)
- Data: EPO European Publication Server, January 2026 (~23,343 patents).

## Key insights (Jan 2026)

- Top IPC fields: **H (Electricity) 5,596**, G (Physics) 4,951, A 4,357.
- Top applicants: **Huawei 191**, Samsung 148, LG Energy 113, Qualcomm 104.
- Top applicant countries: **US 2,061**, DE 1,206, JP 981, CN 890, KR 653.
- Busiest week: **2026-W05 (6,763 publications)**.
- Kind codes: A1 (first publication) 11,784 vs B1 (granted) 8,498.
