---
description: "Phase 15: Optional: members data from Google BigQuery"
---
# Phase 15: Optional: members data from Google BigQuery

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The Privilege Club tables come from a Google BigQuery dataset, to show that the shared context works on data that stays where it is managed today.

## Task

This phase is optional and needs a Google Cloud project. It changes where two tables come from and nothing else. Fetch the mirroring article for Google BigQuery and the OneLake shortcuts article first.

1. `scripts/bigquery_seed.py --env <name> [--dry-run]`: creates a dataset `hub_demo` in the Google Cloud project from the configuration and loads the synthetic `members` and `tier_benefits` tables from `data/`. Credentials come from the environment, never from the repository.
2. `docs/bigquery-setup.md`: the steps to mirror that dataset into the Fabric workspace as `mir_loyalty`, with the permissions the mirroring article requires. Mirroring keeps a replicated copy in OneLake; say so in the document. A shortcut to Google Cloud Storage reads files without a copy but does not cover BigQuery tables; mention it as the alternative for file data.
3. A configuration switch `members_source: lakehouse | bigquery_mirror`. With `bigquery_mirror`, the lakehouse reaches the two tables through shortcuts to the mirrored database if the documentation supports that; the loader skips them; the ontology bindings and the functions stay unchanged. If the documentation does not support it, stop and report.
4. `tests/live/test_bigquery_module.py`: with the switch on, `hubdemo validate` against the workspace returns the same expected results.

## Done when

- With `members_source: bigquery_mirror`, the end-to-end test of phase 14 passes unchanged.
- `docs/bigquery-setup.md` states plainly that mirroring keeps a copy in OneLake.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Create the Google Cloud project, the service account and its key, and the mirrored database in Fabric.
- Confirm with the account team which of the two patterns the customer conversation needs before building this.

## Documentation to fetch first

- [Mirroring for Google BigQuery](https://learn.microsoft.com/fabric/mirroring/google-bigquery)
- [Google Cloud Storage shortcut](https://learn.microsoft.com/fabric/onelake/create-gcs-shortcut)
- [OneLake shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
