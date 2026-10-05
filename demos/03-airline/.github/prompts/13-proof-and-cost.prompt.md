---
description: "Phase 13: Proof and cost"
---
# Phase 13: Proof and cost

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** One place that shows what happened in a run, who decided, what was sent and what it cost.

## Task

Build the record of a run.

1. `hubdemo record --env <name> --plan <id>`: prints the run as a timeline: event, rule match, context read, proposal, changes by a person, each approval, each action, any security event. It reads from the eventhouse and the operational database. This is also the fallback if the dashboard fails.
2. A dashboard `rt_run_record` (Real-Time dashboard) or a Power BI report, whichever can be deployed from the repository: the same timeline, the outcome figures of the plan and the members figures.
3. `scripts/cost_of_run.py --env <name> --plan <id>`: reads the token counts of the run from the traces or the gateway logs and multiplies them with the prices in the configuration. It asks for the Fabric capacity units of the run, which the presenter reads from the Capacity Metrics app, and writes `docs/last-run-cost.md`. No price is hard-coded.
4. `docs/evidence.md`: where to find the run in Purview audit, Application Insights, the Defender portal and Sentinel, with the query or filter for each.

## Done when

- For the proposed plan, `hubdemo record` shows the figures from `expected.proposed_plan`.
- `scripts/cost_of_run.py` produces the cost note for a real run.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Install the Fabric Capacity Metrics app and note where to read the capacity units of a run.

## Documentation to fetch first

None beyond what the prompt names.

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
