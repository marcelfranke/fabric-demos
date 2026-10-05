---
description: "Phase 3: Synthetic data generation"
---
# Phase 3: Synthetic data generation

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** Row-level synthetic data and an event timeline that reproduce the scenario exactly and can be regenerated at any time.

## Task

Build the generator in `src/hubdemo/generate.py` and the event timeline in `src/hubdemo/events.py`.

CLI:
- `hubdemo generate --scenario scenario/qr004.yaml --seed 42 --out data/ [--scale N]` writes one Parquet file per table from section 2.1 of `docs/demo-spec.md` and `flight_events.jsonl`.
- `hubdemo validate --scenario scenario/qr004.yaml --data data/` recomputes the totals, the at-risk connections and the outcome of the proposed plan from the row-level files and compares them with the `expected` block.

Rules for the data:
1. One passenger row per person on the inbound flight. Connecting passengers get a booking with an onward flight according to the counts; the others get a booking with no onward flight.
2. Members: per onward flight, assign exactly the tier counts from the scenario file. Passengers who end their journey in Doha get no member record in this scenario.
3. Bags: per onward flight, exactly the bag count from the scenario file, spread over its connecting passengers. Each passenger ending in Doha gets one bag with no onward flight.
4. Names come from a built-in list of invented given and family names, combined deterministically and made unique. Every row is marked synthetic.
5. `passport_no` is `X` plus a seven-digit counter. `contact_phone` is `+000 0000` plus a four-digit counter. These patterns must stay obviously fake.
6. `remark_text` is empty for most passengers. A handful get harmless remarks (meal, wheelchair). Exactly one passenger connecting to the flight named in `security_fixtures.poisoned_remark` gets that text.
7. The flights table holds the inbound flight, all onward flights, the background arrivals and the next flights used for rebooking. Passengers of other flights are not generated row by row; `other_pax_onboard` carries their number.
8. Events: a `departed` event for each background arrival, the trigger event at its time, and a `landed` event for the inbound flight at the new arrival time.
9. `--scale N` adds N further inbound flights with their own passengers and safe connections, for volume. It must not change any result for the scenario's inbound flight.
10. Same seed, same data: tests compare a hash of the sorted table contents, not file bytes.

Tests: validation passes for seed 42 and for two other seeds; the poisoned remark appears exactly once; no generated identifier matches a realistic passport or phone pattern; `--scale 20` leaves the expected results unchanged.

## Done when

- `hubdemo generate` followed by `hubdemo validate` succeeds.
- `pytest -q` passes.

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
