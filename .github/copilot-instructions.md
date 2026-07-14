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

- **MUST**: every Silver and Gold table has a **deterministic surrogate key** column computed as `sha2(concat_ws('|', <natural business columns>), 256)`.
- **NEVER** use `monotonically_increasing_id()`, `row_number()` without a stable order, GUIDs, or any non-deterministic id — keys MUST be stable across reprocessing so the semantic model and ontology relationships never break.
- **MUST**: child/detail tables carry (a) their own deterministic row id from their natural columns and (b) a foreign key to the parent's surrogate key.
- **MUST**: verify `count == distinct(id)` and `0 null ids` on every keyed table, and FK integrity (every child FK exists in the parent) before declaring done.
- **MUST**: dedup detail rows on their true natural grain (e.g. classifications on `(entity_id, scheme, symbol)`) before assigning ids.
- **PREFER**: add id columns without changing existing column names/types — additive schema evolution over rewrites.

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

## 5. External source etiquette (APIs / public servers)

- **MUST**: send a descriptive `User-Agent` identifying the project (repo URL); NEVER spoof or omit it.
- **MUST**: implement retry with exponential backoff (`MAX_RETRIES`) and a polite request pace (`REQUEST_SLEEP`, bounded `FETCH_PARTITIONS`).
- **MUST**: find the sustainable rate via a probe run; back off at the first sign of throttling (429 / timeout / reset) rather than pushing through.
- **NEVER** saturate a shared compute pool — leave executor headroom; size parallelism to what the pool actually grants, not its theoretical max.

## 6. Compute & performance (Fabric Spark)

- **PREFER** the Native Execution Engine where available.
- **MUST**: choose the right tool per stage — Spark for heavy transform, SQL for set-based serving logic, pipelines for orchestration. Don't force one tool.
- **MUST**: check pool capacity (max executors/cores) before raising parallelism.

## 7. Deployment & Git

- **MUST**: deploy items UPSERT-style keyed on a **stable item name** — list, then update-if-exists else create. NEVER rename a Git-synced item (it churns the sync).
- **MUST**: acquire tokens via the platform auth flow (e.g. `az account get-access-token --resource https://api.fabric.microsoft.com`); NEVER embed tokens.
- **Git integration**: this workspace ring is **Commit-only** (workspace→Git). **NEVER** run Update/Sync (Git→workspace) — the old service ring may reject the Report item. Apply report/theme changes in the service, then Commit.
- **MUST**: keep the generator/source-of-truth in the repo in sync with the deployed item; reconcile any drift before committing.

## 8. Working style for the agent

- **MUST**: decompose broad cross-workload requests into endpoint-specific sub-tasks and delegate to the right skill.
- **MUST**: report ground truth from the live platform, not assumptions — read counts/state fresh; label stale numbers as stale.
- **MUST**: STOP at a validation gate and hand back proofs before scaling.
- **NEVER** claim something was built/deployed unless verified against the live definition or a fresh read.
- **PREFER**: state counts as "start vs after" around any destructive/reset step.
