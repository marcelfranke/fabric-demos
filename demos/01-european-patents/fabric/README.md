# European Patents — Fabric Backend

Microsoft Fabric data-engineering backend for the **European Patents** demo. It ingests
European Patent Office (EPO) publication data into a Fabric OneLake Lakehouse using a
medallion architecture, models it as an application-grain Kimball star, and exposes it
through a Direct Lake Power BI semantic model.

## Overview

- **Lakehouse:** `eps_lakehouse` in the **European Patents** Fabric workspace.
- **Semantic model:** `European Patents` — Direct Lake (queries the Delta tables in
  place, no import/refresh copy).
- **Scope:** EP publications for calendar years **2010 + 2011** — 104 weekly bulletins
  loaded (control table `ctl_loaded_weeks` = 104).
- **Storage:** Delta tables in OneLake, plus a cache-first raw landing zone in
  `Files/raw` (~4.6 GB) so Silver/Gold can rebuild with **zero EPO calls**
  (`SOURCE=onelake_only`).

## Architecture

```
EPO Publication Server  ──►  Bronze  ──►  Silver  ──►  Gold (Kimball star)  ──►  Direct Lake model
   (REST, SDOBI XML)         (raw)       (normalized)   (application grain)       (Power BI)
```

### Bronze — raw

| Table | Rows | Notes |
|---|---:|---|
| `bronze_weekly_lists` | 420,894 | Weekly publication lists used to enumerate patents |
| `bronze_patent_sdobi` | 420,894 | Raw SDOBI biblio XML, one row per patent |

Raw XML is also landed cache-first in OneLake `Files/raw` so the source is never re-hit
to rebuild downstream layers.

### Silver — normalized, parsed from SDOBI

| Table | Rows | Notes |
|---|---:|---|
| `silver_patents` | 420,844 | Deduped from 420,894 bronze — 50 re-published patents collapsed to one row per `patent_number` |
| `silver_patent_titles` | 1,262,532 | Titles (multi-language) |
| `silver_patent_classifications` | 1,029,715 | IPC symbols (distinct 49,469) |
| `silver_patent_applicants` | 132,750 | |
| `silver_patent_inventors` | 1,150,241 | |
| `silver_patent_priorities` | 491,586 | |
| `silver_applicant_dim` | 52,165 | Applicant star — 1 row per EPO applicant register id (`iid`) |
| `silver_patent_applicant_bridge` | 132,750 | Patent ↔ applicant bridge |

### Gold — application-grain Kimball star (`gold_` prefix)

Grain = **application** (`application_number`). Dimensions, a fact spine, and three
many-to-many bridges:

| Table | Rows | Role |
|---|---:|---|
| `gold_fact_application` | 390,751 | Fact spine (grain = application) |
| `gold_dim_application` | 390,751 | Application dimension |
| `gold_dim_publication` | 420,844 | Publication dimension |
| `gold_dim_inventor` | 666,284 | Inventor dimension |
| `gold_dim_ipc` | 49,469 | IPC classification dimension |
| `gold_dim_country` | 173 | Country dimension |
| `gold_dim_tech_area` | 36 | WIPO-35 technology fields |
| `gold_bridge_application_applicant` | 131,819 | Application ↔ applicant (M:M) |
| `gold_bridge_application_inventor` | 1,069,964 | Application ↔ inventor (M:M) |
| `gold_bridge_application_ipc` | 959,567 | Application ↔ IPC (M:M) |

`dim_applicant` is reused from `silver_applicant_dim` (52,165). A simpler flat serving
table, `gold_patent_summary` (420,844 — 1 row per publication), also still exists.

## Key data facts

- **Application grain sits above publication grain.** One application can have several
  publications (e.g. `A2` → `A3` → `B1`): **390,751 applications** vs **420,844
  publications**.
- **Grant is derivable from `kind_code`** (`B*` = granted): **122,653 granted
  applications**, grant rate **~31.4%**, average pendency **~2,011 days**.
- **Classification is IPC only** in this source (no CPC).
- This EPO biblio source does **not** carry family id, forward/backward citations
  (in Silver), examiner, or legal status. Those are **out of scope** and would require
  EPO OPS / DOCDB or EP Register feeds.

## Semantic model

The target model is rewired onto the Kimball star: a `fact_application` spine +
dimensions + three many-to-many bridges (applicant / inventor / IPC) + a **Date**
dimension (calendar 2010 → current). Direct Lake, so it queries the Delta tables in
place with no import copy.

Sample measures:

| Measure | Value |
|---|---:|
| Total Applications | 390,751 |
| Granted | 122,653 |
| Grant Rate | 31.4% |
| Avg Pendency | ~2,011 days |
| Total Publications | 420,844 |

Plus inventor / applicant link counts via the bridges.

> **Note on the committed TMDL.** The live model is rewired to the application-grain
> Kimball star above, but the Git export under [`semantic-model/`](./semantic-model) may
> lag. As committed, the TMDL still reflects the **older publication-grain star** — a
> `Patent` fact sourced from `gold_patent_summary` with `Applicant`, `Classification`,
> `Inventor`, `Priority`, and `Title` bridge tables plus a `Date` dimension. Reconcile
> the export against the live definition before relying on it.

## Engineering canon

- **Deterministic surrogate keys** — `bigint` via `xxhash64` of the natural business key
  (stable across reprocessing; verify `count == distinct(id)`).
- **Explicit typing via DDL** — every column typed (`DATE` / `SMALLINT` / right-sized
  `VARCHAR(n)`), never left at the default `varchar(8000)`.
- **Medallion validation gates** — `count == distinct(PK)`, 0-null keys, 0-orphan FKs,
  and additive-measure reconciliation between layers.
- **Resumable / idempotent ingestion** — per-week checkpointing with a control table
  (`ctl_loaded_weeks`); a re-run skips already-loaded weeks.
- **Cache-first raw landing** — raw payloads landed in OneLake `Files/raw` before parsing.
- **Polite EPO access** — descriptive `User-Agent`, exponential backoff, bounded
  parallelism.

## Data source

- **EPO Publication Server REST API** — https://data.epo.org/publication-server/
- Open data — no authentication or API keys required.
- Ingestion downloads the **weekly publication lists**, then fetches the **per-patent
  SDOBI biblio XML** for each patent discovered.

## How to build

1. **Create a Fabric Lakehouse** named `eps_lakehouse` in your target Fabric workspace.
2. **Create the ingestion notebook** — run the builder, which UPSERT-deploys the notebook
   to the workspace via the Fabric REST API:

   ```bash
   node fabric/notebooks/build_notebook.mjs
   ```

   Requires Node.js and an authenticated Azure CLI session (`az login`) against the
   target tenant. (`fabric/notebooks/build_notebook.py` is the equivalent Python builder.)
3. **Run the notebook** to load the Bronze → Silver → Gold Delta tables into
   `eps_lakehouse`. Prove a small batch at the validation gate before scaling.
4. **Deploy the semantic model** from [`semantic-model/`](./semantic-model) via the
   Fabric REST API, then **refresh (reframe)** so the Direct Lake model picks up the
   tables.

### Ingestion run knobs (override per job)

`YEAR` / `DATES` / `START_DATE` / `END_DATE`, `STAGE` (`bronze` | `silver_gold` | `all`),
`SOURCE` (`cache_first` | `refetch` | `onelake_only`), `FETCH_PARTITIONS`,
`REQUEST_SLEEP`, `MAX_RETRIES`, `FORCE_REPROCESS`, `RAW_ROOT`. Defaults are safe
(cache-first, modest parallelism, backoff on).

## Environment / configuration

Environment-specific values (workspace ID, lakehouse ID, tenant ID, OneLake paths) must
be updated for a different tenant or workspace. These are **Azure resource identifiers,
not secrets** — authentication is always performed at runtime via the Azure CLI
(`az account get-access-token`). **No credentials are stored in this repository.**

## Known limitations

- **Partial applicant coverage.** The applicant party is present on ~**124,251** of the
  420,844 publications (applicant details are carried mainly on granted **B**-documents),
  so applicant coverage is partial; inventor coverage is much higher.
- **`iid` is a registration key, not a company master.** It is an EPO **registration**
  identifier, not a deduplicated organization master — the same firm can hold many `iid`s,
  so distinct-applicant counts are applicant-**registrations**, not unique organizations.
