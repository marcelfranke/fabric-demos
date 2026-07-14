# AGENTS.md — Fabric Demos Runbook

Operational guide for coding agents working in this repository. For design principles and MUST/NEVER rules, see `.github/copilot-instructions.md` (and `.github/instructions/notebooks.instructions.md`). This file is the **runbook**: commands, layout, and workflow.

## Repository layout

- Each demo lives under `demos/<NN-demo-name>/` (e.g. `demos/01-european-patents/`).
- Per demo:
  - `fabric/notebooks/build_notebook.py` — **generator / source of truth**. Builds the notebook and UPSERT-deploys it to Fabric. Edit this, not the exported copy.
  - `workspace-sync/<Item>.Notebook/notebook-content.py` — Git-synced export of the live Fabric item. Treat as generated output; keep in sync with the generator.
  - `fabric/report-theme/` — Power BI theme JSON + import README.
  - `src/` — the demo web app (Angular), if any.

> Branch note: the demo folder path may differ per branch (e.g. `demos/European Patents/` on `main` vs `demos/01-european-patents/` on `fabric-sync`). Confirm the branch before editing paths.

## Environment & auth

- Fabric/Power BI API token: `az account get-access-token --resource https://api.fabric.microsoft.com`
- Never embed tokens, workspace IDs, lakehouse IDs, or item IDs in code — pass as params or resolve at runtime.

## Notebook / ingestion workflow

1. Edit `fabric/notebooks/build_notebook.py` (the generator).
2. Deploy: run the generator — it lists notebooks and **UPSERTs by stable item name** (update-if-exists else create). NEVER rename the item (churns Git sync).
3. Regenerate the `workspace-sync/.../notebook-content.py` export so the repo matches the live definition.
4. Run via the Fabric Jobs API (RunNotebook) with a `parameters` payload. Monitor the job instance to a terminal state; read `ctl_loaded_*` for durable per-unit progress.
5. **Validation gate**: prove on a small batch (params, per-unit counts, key/FK proofs, zero-external-call proof) and STOP for review before any at-scale run.

### Ingestion run knobs (override per job)

`YEAR` / `DATES` / `START_DATE` / `END_DATE`, `STAGE` (`bronze`|`silver_gold`|`all`), `SOURCE` (`cache_first`|`refetch`|`cache_only`), `FETCH_PARTITIONS`, `REQUEST_SLEEP`, `MAX_RETRIES`, `FORCE_REPROCESS`, `RAW_ROOT`. Defaults must be safe (cache-first, modest parallelism, backoff on).

## Web app workflow (if present)

- Install: `npm install`
- Dev (offline seed): `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Live-data sync: run the `.mjs` sync (DAX `executeQueries`, read-only) to refresh local assets from the semantic model. Row caps are env/config (e.g. `LIVE_ROW_LIMIT`), never hardcoded.
- Run build + lint before declaring app work done.

## Git & deployment rules

- **Commit-only ring**: commit workspace→Git only. **NEVER run Update/Sync (Git→workspace)** — the old service ring may reject the Report item.
- Report/theme changes: apply in the Power BI service (manual import documented in `fabric/report-theme/README.md`), then **Commit** — do not force a Git→workspace push.
- Reconcile any drift between the generator and the live item before committing.
- Open a PR per workstream on its feature branch; do not commit secrets.

## Definition of done (per task)

- Live-verified counts/state (not assumptions); stale numbers labeled stale.
- For data work: control-table summary, fresh row counts, key proofs (`count==distinct(id)`, 0 nulls, FK integrity), zero-external-call proof when applicable, and start-vs-after counts around any reset/destructive step.
- For app work: build ✅ + lint ✅ + deployed URL verified.
- Nothing claimed as built/deployed without verification against the live definition.
