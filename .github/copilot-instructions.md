# Copilot Instructions — Fabric Demo Projects

> Canonical engineering standards for Microsoft Fabric demo projects.
> Copilot MUST follow these rules in every session. They are written as
> MUST / NEVER / PREFER directives — treat them as hard constraints, not
> suggestions. When a request conflicts with a rule, stop and flag it.

## 0. Golden rules (read first)

- **MUST** prove a design on a small batch (a "validation gate") before running it at scale.
- **MUST** make every long-running job resumable and idempotent — a stop/failure loses at most one unit of work.
- **NEVER** hardcode dates, resource IDs, connection strings, or secrets in code or notebooks.
- **MUST** externalize all environment-specific values as parameters (dev/test/prod parameterization).
- **NEVER** delegate a data-loss-capable action (drop/overwrite/delete) without an explicit checkpoint or backup first.

## 1. Data modeling & keys

- **MUST**: every Silver and Gold table has a **deterministic BIGINT surrogate key** computed as `xxhash64(concat_ws('|', <natural business columns>))` (cast to bigint). Rationale: compact integer keys perform far better than 64-char hex strings for joins, semantic-model relationships, and storage.
- **NEVER** use `monotonically_increasing_id()`, `row_number()` without a stable order, GUIDs, or any non-deterministic id — keys MUST be stable across reprocessing so the semantic model and ontology relationships never break.
- **NOTE**: the deterministic-hash key stays stable across reprocessing; verify `count == distinct(id)` to catch the astronomically-rare hash collision (salt/widen if one ever occurs). xxhash64 values may be negative — that's fine for keys.
- **MUST**: child/detail tables carry (a) their own deterministic row id from their natural columns and (b) a foreign key to the parent's surrogate key.
- **MUST**: verify `count == distinct(id)` and `0 null ids` on every keyed table, and FK integrity (every child FK exists in the parent) before declaring done.
- **MUST**: dedup detail rows on their true natural grain (e.g. classifications on `(entity_id, scheme, symbol)`) before assigning ids.
- **MUST**: choose an explicit grain per fact table, and roll child/detail rows up to that grain with dedup-on-grain before aggregating (e.g. patent-grain rows rolled to application grain).
- **MUST**: reconcile every additive fact measure to its source as part of the validation gate — Σ(measure) must equal the source child-table row count or distinct-entity count (e.g. Σ `publication_count` == total publications; Σ `inventor_count` == bridge row count).
- **MUST**: model true many-to-many via a bridge table with a FK to each dimension's surrogate key; NEVER put a many-valued FK directly on the fact row.
- **PREFER**: add id columns without changing existing column names/types — additive schema evolution over rewrites.

**Column data types — right-type every column (never default to varchar(8000)):**

- **MUST** profile every column over the full data and assign the tightest LOSSLESS type; NEVER leave string columns at the default `varchar(8000)`.
- **MUST**: dates stored as strings (e.g. `YYYYMMDD`) become a real `date`/`timestamp` type (prove 0 unparseable rows).
- **MUST**: columns that are genuinely numeric (counts, sequences) become `int`/`smallint`/`bigint` (or `decimal`), ONLY IF every value is numeric, fits range, and has no meaningful leading zeros.
- **MUST**: identifier/code columns (patent/application/publication numbers, classification symbols, country/kind codes) stay `varchar` even if they look numeric — casting them risks stripping leading zeros, overflow, or format loss.
- **MUST**: all other text → right-sized `VARCHAR(n)` where `n = MAX(length)` rounded up with headroom, never below observed max (prove 0 rows with `length > n`). Fabric has NO `nvarchar` — Unicode lives in UTF-8 `varchar`; do not use `nvarchar`.
- **MUST** verify the SQL analytics endpoint actually reflects the assigned types (`INFORMATION_SCHEMA.COLUMNS`), not the `varchar(8000)` default. If length-annotated `VARCHAR(n)` doesn't propagate from a Lakehouse Delta table, consider a Warehouse-served serving layer.

**Persisting VARCHAR(n) so it reaches the SQL analytics endpoint (verified on Fabric Lakehouse Delta):**

- **NEVER** rely on a DataFrame `.cast("varchar(n)")` (or `VarcharType` in a DataFrame schema) to right-size storage — it does NOT persist the length to Delta; it reads back as a plain string and the SQL endpoint shows `varchar(8000)`.
- **MUST**: the ONLY method that propagates length is declaring the table with DDL — `CREATE TABLE t (col VARCHAR(n), key BIGINT, dt DATE) USING DELTA` — then appending rows into it. DDL-declared `VARCHAR(n)`/`BIGINT`/`DATE` all propagate: the endpoint reports right-sized `varchar`, `bigint`, and `date` (never the flat `varchar(8000)` default).
- **BYTES vs CHARS gotcha**: the endpoint reports `CHARACTER_MAXIMUM_LENGTH` in BYTES = 4× the declared char length (Fabric UTF-8 varchar). So `VARCHAR(32 chars)` shows as `varchar(128)`, `VARCHAR(512)` → `varchar(2048)`. Size in CHARS = measured-max-chars + headroom; to guarantee a column reads as clearly right-sized (below the 8000-byte default), keep the declared char length under ~2000 (2000 chars → 8000 bytes). Free-text columns: pick a char length whose ×4 stays under 8000 (e.g. 1500 chars → `varchar(6000)`).
- **MUST** verify empirically after every schema change: query the endpoint's `INFORMATION_SCHEMA.COLUMNS` (`COLUMN_NAME`, `DATA_TYPE`, `CHARACTER_MAXIMUM_LENGTH`) and confirm nothing reports `varchar(8000)`. Divide `CHARACTER_MAXIMUM_LENGTH` by 4 to read back the declared char length.

## 2. Ingestion & idempotency

- **MUST**: checkpoint per unit of work (per week / per file / per partition) — fetch unit → write its data (delete-then-append) → write a control-table row immediately → next. NEVER checkpoint only at the end of a batch.
- **MUST**: maintain a control table (e.g. `ctl_loaded_*`) recording status (`done` / `empty` / `error`) + counts per unit. This is the live progress meter and the resume source of truth.
- **MUST**: a re-run skips already-`done` units and re-fetches nothing already cached, unless an explicit `FORCE_REPROCESS` flag is set.
- **MUST**: distinguish "no data" from "failure" — verify how the source signals emptiness (e.g. HTTP 200 + empty body vs 404) and classify accordingly.
- **PREFER**: watermark / high-water-mark orchestration for incremental loads.

## 3. Raw landing zone (cache-first)

- **MUST**: land the raw source payload durably in OneLake `Files/` (partitioned, compressed — e.g. gzip) *before* parsing, so data can be rebuilt without re-hitting the source.
- **MUST**: provide a `SOURCE` parameter with at least: cache-first (default), force-refetch, and **zero-source-call rebuild** modes. Prove the zero-call mode performs no external requests.
- **PREFER**: partition the raw zone by a natural key (e.g. `date=YYYYMMDD/`).

## 4. Medallion architecture

- **MUST**: keep Bronze (raw/landed), Silver (validated/typed/keyed), and Gold (serving/aggregated) as separate layers and separate tables.
- **NEVER** mix raw and curated data in the same serving table.
- **MUST**: place a validation gate (row counts, null checks, key/FK checks) between Bronze→Silver and Silver→Gold.
- **PREFER**: Delta Lake for all Lakehouse tables.

## 5. Semantic model (DirectLake)

- **MUST**: DirectLake stores an explicit per-column `dataType` in the model that must match the physical Delta column type. It does NOT self-heal on reframe — a stale string-vs-typed declaration (e.g. a `seq` column left as string after the table became smallint) requires an explicit TMDL edit + refresh. Verify model column dtypes after any lakehouse schema change.
- **MUST**: keep the model's column set in sync with its source table. A column dropped from the Delta table but still referenced in the model breaks framing (refresh fails with "column not found"). Prune removed columns from the model before refreshing.
- **MUST**: after any lakehouse schema or data change, refresh (reframe) the model and confirm its counts against a fresh lakehouse read. A DirectLake model can silently serve a stale snapshot indefinitely if it is never reframed — never trust a model number without a post-change refresh.
- **MUST-KNOW / workaround**: the XMLA and Power BI modeling connectors fail on workspace names containing spaces (the space is URL-encoded → workspace-not-found). Use Fabric REST `getDefinition`/`updateDefinition` (TMDL) plus Power BI `executeQueries` (DAX), keyed off the workspace GUID — never the name — as the reliable edit + prove path.

## 6. External source etiquette (APIs / public servers)

- **MUST**: send a descriptive `User-Agent` identifying the project (repo URL); NEVER spoof or omit it.
- **MUST**: implement retry with exponential backoff (`MAX_RETRIES`) and a polite request pace (`REQUEST_SLEEP`, bounded `FETCH_PARTITIONS`).
- **MUST**: find the sustainable rate via a probe run; back off at the first sign of throttling (429 / timeout / reset) rather than pushing through.
- **NEVER** saturate a shared compute pool — leave executor headroom; size parallelism to what the pool actually grants, not its theoretical max.

## 7. Compute & performance (Fabric Spark)

- **PREFER** the Native Execution Engine where available.
- **MUST**: choose the right tool per stage — Spark for heavy transform, SQL for set-based serving logic, pipelines for orchestration. Don't force one tool.
- **MUST**: check pool capacity (max executors/cores) before raising parallelism.

## 8. Deployment & Git

- **MUST**: deploy items UPSERT-style keyed on a **stable item name** — list, then update-if-exists else create. NEVER rename a Git-synced item (it churns the sync).
- **MUST**: acquire tokens via the platform auth flow (e.g. `az account get-access-token --resource https://api.fabric.microsoft.com`); NEVER embed tokens.
- **Git integration**: this workspace ring is **Commit-only** (workspace→Git). **NEVER** run Update/Sync (Git→workspace) — the old service ring may reject the Report item. Apply report/theme changes in the service, then Commit.
- **MUST**: keep the generator/source-of-truth in the repo in sync with the deployed item; reconcile any drift before committing.

## 9. Working style for the agent

- **MUST**: decompose broad cross-workload requests into endpoint-specific sub-tasks and delegate to the right skill.
- **MUST**: report ground truth from the live platform, not assumptions — read counts/state fresh; label stale numbers as stale.
- **MUST**: STOP at a validation gate and hand back proofs before scaling.
- **NEVER** claim something was built/deployed unless verified against the live definition or a fresh read.
- **PREFER**: state counts as "start vs after" around any destructive/reset step.
