---
applyTo: "**/*.{py,ipynb,Notebook/**}"
---

# Fabric Notebook & Spark Authoring Rules

Scoped rules for notebooks and Spark code. These extend the repo-wide `.github/copilot-instructions.md` — everything there still applies.

## Parameters cell

- **MUST**: the first cell is a `parameters`-tagged cell exposing every knob so each run is overridable per job. NEVER hardcode a date/range/mode in logic.
- **MUST** include, at minimum, these parameter shapes for an ingestion notebook:
  - a primary window selector (e.g. `YEAR`, or `START_DATE`/`END_DATE`)
  - an explicit override list (e.g. `DATES=""`) for targeted re-runs / gate tests
  - `STAGE` — which layers to build (`bronze` | `silver_gold` | `all`)
  - `SOURCE` — `cache_first` (default) | `refetch` | `cache_only` (zero external calls)
  - `FETCH_PARTITIONS`, `REQUEST_SLEEP`, `MAX_RETRIES` — throughput/politeness
  - `FORCE_REPROCESS` — re-do units already marked done
  - `RAW_ROOT` — OneLake `Files/` raw landing path
- **MUST**: sensible, safe defaults (cache-first, modest parallelism, backoff on).

## Idempotent write pattern

- **MUST**: per unit → delete-then-append that unit's rows, then upsert its control row in the same logical step. Wrap each unit in try/except: on failure record `status='error'` and continue the loop (don't abort the whole batch).
- **NEVER** write with a blanket `overwrite` that wipes prior units' durable progress.
- **MUST**: reads for reprocessing come from OneLake/bronze, not the external source, when `SOURCE=cache_only`.

## Keys in Spark

- **MUST**: `id = xxhash64(concat_ws('|', <natural cols>))` cast to bigint. Normalize inputs first (trim, consistent case) so the hash is stable.
- **NEVER** `monotonically_increasing_id()` for any persisted key.

## Star schema & facts

- **MUST**: pick an explicit grain per fact table; roll child/detail rows up to that grain with dedup-on-grain before aggregating (e.g. patent-grain → application grain).
- **MUST**: reconcile every additive measure to source in the validation gate — Σ(measure) == source child-row count or distinct-entity count (e.g. Σ `publication_count` == total publications; Σ `inventor_count` == bridge row count).
- **MUST**: model many-to-many via a bridge table with a FK to each dimension's surrogate key; NEVER put a many-valued FK directly on the fact row.

## Column typing

- **MUST**: profile every column, then assign the tightest LOSSLESS type — never default to `varchar(8000)`.
- **MUST**: dates → real `date`/`timestamp` (prove 0 unparseable); true numerics (counts/sequences) → `int`/`bigint` only if all-numeric, in-range, no meaningful leading zeros.
- **MUST**: identifier/code columns (patent/application/publication numbers, classification symbols, country/kind codes) stay `varchar` even if they look numeric — casting risks stripping leading zeros / overflow / format loss.
- **MUST**: all other text → right-sized `VARCHAR(n)` where `n = measured MAX(length)` + headroom (prove 0 rows with `length > n`). Fabric has NO `nvarchar` — Unicode lives in UTF-8 `varchar`.
- **MUST**: verify the assigned types at the SQL analytics endpoint (`INFORMATION_SCHEMA.COLUMNS`), not the `varchar(8000)` default.
- **NEVER** rely on DataFrame `.cast("varchar(n)")` / `VarcharType` to persist length — it doesn't reach Delta; the endpoint shows `varchar(8000)`. The ONLY method that propagates length is DDL: `CREATE TABLE t (col VARCHAR(n), key BIGINT, dt DATE) USING DELTA`, then append. Verified on Fabric Lakehouse Delta.
- **CHARS vs BYTES**: the endpoint reports `CHARACTER_MAXIMUM_LENGTH` in BYTES = 4× declared char length (UTF-8). `VARCHAR(512)` → `varchar(2048)`. Declare in CHARS = measured-max + headroom; keep under ~2000 chars so ×4 stays below the 8000-byte default. After every schema change, verify empirically and divide `CHARACTER_MAXIMUM_LENGTH` by 4 to read back the declared char length.

## Semantic model (DirectLake)

- **MUST**: DirectLake stores an explicit per-column `dataType` that must match the physical Delta type — it does NOT self-heal on reframe. A stale string-vs-typed declaration (e.g. a `seq` left as string after the column became smallint) needs an explicit TMDL edit + refresh. Verify model column dtypes after any lakehouse schema change.
- **MUST**: keep the model's column set in sync with its source — a column dropped from Delta but still referenced breaks framing (refresh fails "column not found"). Prune removed columns before refreshing.
- **MUST**: after any lakehouse schema/data change, reframe the model and confirm its counts against a fresh lakehouse read — a DirectLake model can silently serve a stale snapshot until reframed. Never trust a model number without a post-change refresh.
- **MUST-KNOW / workaround**: XMLA and the Power BI modeling connectors fail on workspace names with spaces (URL-encoded → workspace-not-found). Use Fabric REST `getDefinition`/`updateDefinition` (TMDL) + Power BI `executeQueries` (DAX), keyed off the workspace GUID (never the name), as the reliable edit + prove path.

## Access & resources

- **MUST**: use the default lakehouse mount (`/lakehouse/default/Files/...`) inside `mapPartitions`/UDF workers; use `notebookutils.fs` for directory ops.
- **MUST**: externalize workspace/lakehouse/item IDs as params or resolve at runtime; NEVER paste GUIDs inline.

## Before declaring a notebook done

- **MUST** report: params used, per-unit control-table summary (done/empty/error + counts), fresh table row counts, key proofs (`count==distinct(id)`, 0 nulls, FK integrity), zero-external-call proof when applicable, and confirmation of which layers were (not) built.
