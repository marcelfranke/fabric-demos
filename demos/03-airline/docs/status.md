# Status

One row per phase. A phase is only `done` when `ruff check .` and `pytest -q` pass, the phase's own
checks pass, and this table says how that was verified.

States: `not started`, `in progress`, `done`, `blocked`.

| Phase | State | Verified how | Open points |
| --- | --- | --- | --- |
| 00 bootstrap | done | `ruff check .` clean, `pytest -q` 8 passed, `scripts/check_prereqs.py --env example --dry-run` lists all 19 empty keys | CI workflow does not run from this path (V32), Fabric CLI not installed, `config/env.demo.yaml` not created yet, Learn MCP search returns nothing (V31) |
| 01 scenario contract | done | `ruff check .` clean, `pytest -q` 19 passed, `hubdemo describe --scenario scenario/qr004.yaml` prints the expected totals line, `hubdemo docs` writes `docs/data-dictionary.md` | The window formula lives in `scenario.py` for now and moves to `rules.py` in phase 2 (rule 4) |
| 02 rules engine | not started | — | — |
| 03 synthetic data | not started | — | — |
| 04 fabric foundation | not started | — | First phase that needs cloud resources. `az login` and the Fabric CLI are prerequisites, see `manual-steps.md` |
| 05 real time | not started | — | — |
| 06 ontology | not started | — | — |
| 07 rules function | not started | — | — |
| 08 fabric agents | not started | — | — |
| 09 foundry planner | not started | — | — |
| 10 approval process | not started | — | — |
| 11 copilot surfaces | not started | — | — |
| 12 security layer | not started | — | — |
| 13 proof and cost | not started | — | — |
| 14 runbook | not started | — | — |
| 15 bigquery module | not started | — | — |

## Phase 0 — bootstrap

**Built**

- `pyproject.toml` for the `hubdemo` package: src layout, Python 3.11, pydantic v2, pyyaml, typer,
  pandas and pyarrow at runtime, pytest, pytest-cov and ruff for development, console script
  `hubdemo`.
- The folder layout from `.github/copilot-instructions.md`, each folder with a `README.md` saying
  what belongs in it.
- `config/env.example.yaml` with all 19 keys and no values, and `src/hubdemo/config.py`, which loads
  `config/env.<name>.yaml` and names every empty key when one is missing.
- `.env.example` and `.gitignore`.
- `docs/status.md`, `docs/manual-steps.md` and `docs/verify-list.md`, the last seeded with every
  item from section 7 of `BUILD_SCRIPT.md`.
- `scripts/check_prereqs.py`, which checks the Python version, `az account show`, the Fabric CLI and
  the configuration file, and supports `--dry-run`.
- `.github/workflows/ci.yml` running ruff and pytest on push and pull request.
- `tests/test_smoke.py`, which imports the package and parses `scenario/qr004.yaml`.

**Verified**

All three checks were run from `demos/03-airline` against a local Python 3.11.17 environment
(`.venv`, created with conda, `pip install -e ".[dev]"`).

| Check | Result |
| --- | --- |
| `ruff check .` | `All checks passed!`, exit 0. Five `E501` long lines were found on the first run and fixed by wrapping the lines, not by raising the limit. |
| `pytest -q` | `8 passed in 0.17s`, exit 0. The smoke tests import `hubdemo`, parse `scenario/qr004.yaml`, confirm its twelve top level keys and its `expected` block, check that the rule values are numbers, and confirm that `config/env.example.yaml` holds every required key with no value. |
| `python scripts/check_prereqs.py --env example --dry-run` | Prints the four check lines and then the numbered list of all 19 empty configuration keys, ending with `not ready: 1 of 4 checks failed`, exit 1. That exit code is the expected result: `env.example.yaml` is the template, so every key is empty by design, and the script says so in its output. Python reports `ok`; the Azure CLI and Fabric CLI lines report `skipped`, which is what `--dry-run` means. |

**Open**

- The workflow at `.github/workflows/ci.yml` will not be run by GitHub while the kit lives inside
  this repository, because GitHub only reads workflows from the repository root. Local `ruff` and
  `pytest` are the gate until the kit is moved into its own repository. See verify list V32 and
  manual step 1.
- The Fabric CLI (`fab`) is not installed on this machine. Nothing in phase 0 needs it, and
  `check_prereqs.py --dry-run` reports it as skipped, but it is needed from phase 4. See manual
  step 4.
- `config/env.demo.yaml` does not exist yet. The template is in place; filling it in is manual
  step 2.
- `az login` has not been run. Not needed before phase 4. See manual step 3.
- The Microsoft Learn MCP server returns an empty result set for every query tried, so
  documentation was confirmed by fetching the Learn URLs directly instead. See verify list V31.

## Phase 1 — scenario contract

**Built**

- `src/hubdemo/models.py`, holding the typed models for `scenario/qr004.yaml` and one row model per
  table and event in section 2 of `docs/demo-spec.md`. The scenario models reject unknown keys, so a
  typo in the scenario file is an error rather than a silently ignored line. The fifteen row models
  are listed in `ROW_TABLES` together with the store, table and key each one belongs to.
- `src/hubdemo/scenario.py`, holding `load_scenario`, the window and totals helpers, and the five
  consistency checks the phase asks for: the connecting passenger counts add up to the inbound
  figure, no flight carries more members than connecting passengers, every cargo shipment points at
  a flight that exists, every flight below the standard connection time has a next flight, and every
  tier named on a flight is defined under `tiers`. Each check raises `ScenarioError` with a sentence
  that names the flight or value at fault.
- `hubdemo describe --scenario scenario/qr004.yaml`, which prints the totals and the connection
  window for each onward flight, and marks the ones below the standard.
- `hubdemo docs`, which writes `docs/data-dictionary.md` from the row models.
- `tests/test_scenario.py`, eleven tests: four compare the totals, the windows and the at risk list
  computed from the file against the `expected` block in the same file, two cover the loader
  failures, and one per validation rule feeds the loader a broken copy of the scenario.
- `docs/data-dictionary.md`, generated. It is written by `hubdemo docs` and must not be edited by
  hand; change the models and run the command again.

**Verified**

All four checks were run from `demos/03-airline` against the same local Python 3.11.17 environment
as phase 0. No number in the tests or in the `describe` output is written in the code; they are all
read from `scenario/qr004.yaml`.

| Check | Result |
| --- | --- |
| `ruff check .` | `All checks passed!`, exit 0. One `E501` long line was found on the first run, in `models.py`, and fixed by wrapping the line. |
| `pytest -q` | `19 passed in 0.83s`, exit 0. Eight smoke tests from phase 0 and the eleven new scenario tests. |
| `hubdemo describe --scenario scenario/qr004.yaml` | Exit 0. Prints `11 onward flights, 164 connecting passengers, 195 transfer bags, 63 members and 3 shipments`, which is the sentence the phase asks for, then the eleven windows, which match `expected.windows_min` value for value, then `at risk below the standard of 45 minutes: MCT, SIN, SYD`, which matches `expected.at_risk`. |
| `hubdemo docs` | Exit 0. Writes `docs/data-dictionary.md` with one section per store and one table per row model. Every type cell was read back afterwards: fourteen distinct type names, no raw Python type left in the file. |

**Open**

- The window is still worked out in `scenario.py`, in one helper, `window_minutes`. Rule 4 puts that
  calculation in `src/hubdemo/rules.py`; phase 2 creates that module and the helper moves into it.
  Keeping it in one place now means the move is a cut and paste, not a rewrite.
- `docs/data-dictionary.md` is generated. Anyone editing it by hand will lose the change the next
  time `hubdemo docs` runs.
- The first run of `hubdemo docs` printed optional columns as raw Python unions, which broke the
  markdown table. Fixed and checked; see verify list V33.
