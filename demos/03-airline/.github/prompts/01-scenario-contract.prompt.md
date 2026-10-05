---
description: "Phase 1: Scenario and data contract"
---
# Phase 1: Scenario and data contract

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The scenario file is loaded and validated, and every table and event has a typed model.

## Task

Turn the specification into typed models.

1. `src/hubdemo/models.py`: pydantic models for the scenario file (inbound flight, onward flights, rules, tiers, cargo shipments, approval policies, security fixtures, expected results) and one row model per table and event in section 2 of `docs/demo-spec.md`.
2. `src/hubdemo/scenario.py`: `load_scenario(path)` with these checks, each with a clear error message:
   - the connecting passengers of all onward flights add up to `inbound.pax_connecting`;
   - no onward flight has more members than connecting passengers;
   - every cargo shipment points to an existing onward flight;
   - every onward flight whose window is below `rules.pax_standard_min` has a `next_flight`;
   - the tier names used in member counts all exist under `tiers`.
3. CLI: `hubdemo describe --scenario scenario/qr004.yaml` prints the totals and the window per onward flight.
4. CLI: `hubdemo docs` writes `docs/data-dictionary.md` from the row models.
5. Tests: the totals and windows computed from the file equal `expected.totals` and `expected.windows_min`. One test per validation rule with a broken copy of the scenario.

## Done when

- `pytest -q` passes.
- `hubdemo describe --scenario scenario/qr004.yaml` prints 11 onward flights, 164 connecting passengers, 195 transfer bags, 63 members and 3 shipments.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

None.

## Documentation to fetch first

None beyond what the prompt names.

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
