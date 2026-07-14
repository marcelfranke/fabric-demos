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

- **MUST**: `id = sha2(concat_ws('|', <natural cols>), 256)`. Cast/normalize inputs first (trim, consistent case) so the hash is stable.
- **NEVER** `monotonically_increasing_id()` for any persisted key.

## Access & resources

- **MUST**: use the default lakehouse mount (`/lakehouse/default/Files/...`) inside `mapPartitions`/UDF workers; use `notebookutils.fs` for directory ops.
- **MUST**: externalize workspace/lakehouse/item IDs as params or resolve at runtime; NEVER paste GUIDs inline.

## Before declaring a notebook done

- **MUST** report: params used, per-unit control-table summary (done/empty/error + counts), fresh table row counts, key proofs (`count==distinct(id)`, 0 nulls, FK integrity), zero-external-call proof when applicable, and confirmation of which layers were (not) built.
