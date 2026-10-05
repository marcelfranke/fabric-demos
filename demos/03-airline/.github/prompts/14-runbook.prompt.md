---
description: "Phase 14: Runbook, reset and dry run"
---
# Phase 14: Runbook, reset and dry run

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The demo can be reset and run twice in a row by someone who did not build it.

## Task

Make the demo repeatable.

1. `scripts/reset_demo.py --env <name> [--dry-run]`: clears the event tables, empties the operational tables, reloads the reference data and stops any open approval.
2. `scripts/run_demo.py --env <name> --run A|B`: resets, replays the events up to the trigger, waits for the presenter, sends the trigger, and prints after each step what should now be visible and where.
3. `docs/runbook.md`: the sequence for Run A and Run B with the four security moments, what to show on which screen, one or two plain sentences to say per step, and a checklist for the 30 minutes before the demo.
4. `docs/fallback.md`: what to do when a preview feature is unavailable, a Teams message is late, the capacity throttles or an agent answer differs from the rehearsal; and a shot list for a recorded backup.
5. `tests/live/test_end_to_end.py`: Run B with simulated approvals, asserting the expected outcome, the action count and an empty `security_events` table.

## Done when

- Two consecutive full runs pass after a reset.
- A person who did not build the demo completes Run A and Run B from `docs/runbook.md` alone.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Record the backup video once both runs are stable.

## Documentation to fetch first

None beyond what the prompt names.

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
