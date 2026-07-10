# European Patents — Fabric Backend

Microsoft Fabric data-engineering backend for the **European Patents** demo. It ingests
European Patent Office (EPO) publication data into a Fabric OneLake Lakehouse using a
medallion architecture and exposes it through a Direct Lake Power BI semantic model that
feeds the Angular dashboard frontend.

## Overview

EPO patent publications are ingested into a Fabric OneLake Lakehouse (`eps_lakehouse`)
using a Bronze/Silver/Gold medallion architecture and exposed via a Direct Lake Power BI
semantic model (`European Patents`).

- **Scope:** January 2026 publications (~23,343 patents across the four weekly publication
  dates: `20260107`, `20260114`, `20260121`, `20260128`).
- **Storage:** Delta tables in OneLake, queried in place by the semantic model (Direct
  Lake — no import/refresh copy of the data into the model).

## Architecture

```
EPO Publication Server  ──►  Bronze  ──►  Silver  ──►  Gold  ──►  Direct Lake model
   (REST, SDOBI XML)         (raw)       (normalized)  (facts)     (Power BI)
```

- **Bronze** — raw SDOBI biblio XML captured per patent, plus the weekly publication
  lists used to enumerate patents.
- **Silver** — normalized relational tables parsed out of the SDOBI XML: `patents`,
  `titles`, `classifications`, `applicants`, `inventors`, and `priorities`.
- **Gold** — a `gold_patent_summary` fact table plus rollups derived from the Silver
  layer.

The semantic model is a **star schema**:

- **Patent** fact table
- **Classification**, **Applicant**, **Inventor**, **Priority**, and **Title** bridge
  tables
- a **Date** dimension

Relationships and column definitions live in the TMDL under
[`semantic-model/`](./semantic-model).

## Data source

- **EPO Publication Server REST API** — https://data.epo.org/publication-server/
- No authentication or API keys are required for this open data.
- The ingestion notebook first downloads the **weekly publication lists**, then fetches
  the **per-patent SDOBI biblio XML** for each patent it discovers.

## How to build

1. **Create a Fabric Lakehouse** named `eps_lakehouse` in your target Fabric workspace.
2. **Create the ingestion notebook** — run the builder, which creates the
   `01_ingest_eps_2026` notebook in the workspace via the Fabric REST API:

   ```bash
   node fabric/notebooks/build_notebook.mjs
   ```

   Requires Node.js and an authenticated Azure CLI session (`az login`) against the
   target tenant. (`fabric/notebooks/build_notebook.py` is the equivalent Python builder.)
3. **Run the notebook** to load the 12 Delta tables (Bronze → Silver → Gold) into
   `eps_lakehouse`.
4. **Deploy the semantic model** from [`semantic-model/`](./semantic-model) via the
   Fabric REST `createItemWithDefinition` API, then trigger a **full refresh** so the
   Direct Lake model picks up the tables.

## Environment / configuration

The following values are **environment-specific** and must be updated for a different
tenant or workspace:

- Workspace ID, Lakehouse ID, and tenant ID — defined near the top of
  [`notebooks/build_notebook.mjs`](./notebooks/build_notebook.mjs).
- The OneLake Direct Lake path — defined in
  [`semantic-model/definition/expressions.tmdl`](./semantic-model/definition/expressions.tmdl).

These are **Azure resource identifiers, not secrets**. Authentication is always performed
at runtime via the Azure CLI (`az account get-access-token`) — **no credentials are stored
in this repository**.

## Known data-quality note

Approximately **63%** of these EP publications omit the applicant party in the biblio, so
`applicant_country` is blank for those patents. Inventor country is nearly complete and
can serve as a fallback "origin country" in a future iteration.
