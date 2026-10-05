---
description: "Phase 2: Rules engine"
---
# Phase 2: Rules engine

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The transfer rules, proposals, member impact, actions and approval stages as pure, tested functions.

## Task

Implement section 3, 3.1 and 4 of `docs/demo-spec.md` in `src/hubdemo/rules.py`. Pure functions, no input or output, standard library plus the models only. This module is later copied into a Fabric function, so it must not import anything else from the package except the models.

Functions:
- `window_min(scenario, onward_id, hold_min=0)`
- `at_risk(scenario)`: the onward flights whose window is below the standard minimum, in departure order
- `judge(scenario, onward_id, option)`: result (`ok`, `risky`, `fails`, `rebook`), time to spare, hold minutes, whether bags and cargo make it, and for `rebook` how much later the passengers arrive
- `propose(scenario, onward_id)`: the first of `fast`, `hold` whose result is `ok`, otherwise `rebook`
- `explain(scenario, onward_id)`: one templated sentence that states the window and why the proposal follows from the rules
- `evaluate_plan(scenario, choices)`: passengers and bags protected, passengers rebooked, passengers left exposed, hold minutes, cargo, members who keep their connection, members rebooked (by tier), Platinum members rebooked, members who get meet and assist, and which choices differ from the proposal
- `actions_for(scenario, choices)`: the action list from section 3.1 (recipient and text)
- `approval_stages(scenario, choices, policy_name)`: the stages required by the named policy
- `plan_text(scenario, choices)` and `member_text(scenario, choices)`: the two summary sentences shown to approvers

Tests:
- Parametrised against `expected.option_results`, `expected.proposal`, `expected.proposed_plan` and both entries of `expected.override_cases`.
- A property test: `propose` never returns an option whose result is `risky` or `fails`.
- Tier never changes `propose`: shuffle the member counts and assert the proposals stay the same.
- Branch coverage of `rules.py` at 95 percent or more.

## Done when

- `pytest -q --cov=hubdemo.rules --cov-branch` passes with at least 95 percent branch coverage.
- No number from the scenario file appears as a literal in `rules.py`.

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
