# Status

One row per phase. A phase is only `done` when `ruff check .` and `pytest -q` pass, the phase's own
checks pass, and this table says how that was verified.

States: `not started`, `in progress`, `done`, `blocked`.

| Phase | State | Verified how | Open points |
| --- | --- | --- | --- |
| 00 bootstrap | done | `ruff check .` clean, `pytest -q` 8 passed, `scripts/check_prereqs.py --env example --dry-run` lists all 19 empty keys | CI workflow does not run from this path (V32), Fabric CLI not installed, `config/env.demo.yaml` not created yet, Learn MCP search returns nothing (V31) |
| 01 scenario contract | not started | — | — |
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
