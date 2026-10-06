# Status

One row per phase. A phase is only `done` when `ruff check .` and `pytest -q` pass, the phase's own
checks pass, and this table says how that was verified.

States: `not started`, `in progress`, `done`, `blocked`.

| Phase | State | Verified how | Open points |
| --- | --- | --- | --- |
| 00 bootstrap | done | `ruff check .` clean, `pytest -q` 8 passed, `scripts/check_prereqs.py --env example --dry-run` lists all 19 empty keys | CI workflow does not run from this path (V32), Fabric CLI not installed, `config/env.demo.yaml` not created yet, Learn MCP search returns nothing (V31) |
| 01 scenario contract | done | `ruff check .` clean, `pytest -q` 19 passed, `hubdemo describe --scenario scenario/qr004.yaml` prints the expected totals line, `hubdemo docs` writes `docs/data-dictionary.md` | The window formula lives in `scenario.py` for now and moves to `rules.py` in phase 2 (rule 4) |
| 02 rules engine | done | `ruff check .` clean, `pytest -q` 100 passed, `pytest -q --cov=hubdemo.rules --cov-branch` 100 percent statement and branch coverage of `rules.py`, no number from the scenario file written as a literal in `rules.py` | The wording of `explain`, `plan_text`, `member_text` and the action lines is invented (V34), `cargo_protected` is true when no shipment is affected (V35), `bags_protected` counts only kept connections whose bags make it (V36), `min_transfer_min` on the shipments is unused (V37), `Platinum` is named in code as the top tier (V38) |
| 03 synthetic data | done | `ruff check .` clean, `pytest -q` 133 passed, `hubdemo generate --out data` writes ten Parquet files plus `flight_events.jsonl`, `hubdemo validate --data data` reports the rows reproduce the scenario file, `--scale 20` leaves the result unchanged, no number from the scenario file written as a literal in `generate.py` or `events.py` | Background arrivals get an empty `origin` because the scenario names a city but no airport code (V39), next flights get an empty `gate_id` (V40), `concourse` is derived from the first letter of the gate (V41), the `transfer_rules` descriptions are invented (V42), the `tier_benefits` source note is invented (V43), the event texts are invented (V44), `departure_delay_min` is read from the scenario during validation because no row model carries it (V45), `expected.at_risk_totals` is deliberately not re-checked (V46), the given and family name lists are invented (V47) |
| 04 fabric foundation | done | `ruff check .` clean, `pytest -q` 179 passed and 1 skipped, and `scripts/fabric_bootstrap.py`, `scripts/upload_landing.py` and `fabric/deploy.py` each ran `--env example --dry-run` and exited 0 without a network call | Neither of the two "Done when" items could be run, because no Fabric tenant exists yet. V48 to V58 wait for a first real deploy. Five new manual steps, 5 to 9, are now in `manual-steps.md` |
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

- Closed in phase 2. The window was worked out in `scenario.py`, in one helper, `window_minutes`.
  Rule 4 puts that calculation in `src/hubdemo/rules.py`. Phase 2 created that module, moved the
  helper into it and left `scenario.py` importing it, so there is one definition and no copy.
- `docs/data-dictionary.md` is generated. Anyone editing it by hand will lose the change the next
  time `hubdemo docs` runs.
- The first run of `hubdemo docs` printed optional columns as raw Python unions, which broke the
  markdown table. Fixed and checked; see verify list V33.

## Phase 2 — rules engine

**Built**

- `src/hubdemo/rules.py`. The rules from demo spec sections 3, 3.1 and 4, written as pure
  functions over the models. It imports the standard library and `hubdemo.models` and nothing
  else, so it can be copied into a Fabric function later. Ten public functions:
  `window_min`, `at_risk`, `judge`, `propose`, `explain`, `evaluate_plan`, `actions_for`,
  `approval_stages`, `plan_text` and `member_text`.
- No number from `scenario/qr004.yaml` is written in `rules.py` as a literal. Every threshold,
  count and time comes off the loaded scenario.
- `window_minutes` moved out of `scenario.py` and into `rules.py`, which is what rule 4 asks for.
  `scenario.py` now imports it. There is one definition and no copy.
- `tests/test_rules.py`. Around 45 test functions, 81 cases once the parametrised ones expand.
  They read `expected.option_results`, `expected.proposal`, `expected.proposed_plan` and both
  override cases straight out of the scenario file, so the tests assert the contract and not the
  code. There is also a property test that `propose` never returns a risky or failing option, and
  a test that shuffling tiers does not change a proposal.

**Verified**

Everything below ran from `demos/03-airline` on the local Python 3.11.17 virtual environment,
the same one phase 0 and phase 1 used. No cloud resource was touched.

| Check | Result |
| --- | --- |
| `ruff check .` | `All checks passed!`, exit code 0 |
| `pytest -q` | `100 passed in 1.11s`, exit code 0. Phase 1 ended at 19, so phase 2 adds 81. |
| `pytest -q --cov=hubdemo.rules --cov-branch` | `100 passed in 2.65s`, exit code 0. `src\hubdemo\rules.py` 237 statements, 0 missed, 78 branches, 0 partial, 100 percent. The phase asks for 95 percent branch coverage. |
| No scenario number as a literal in `rules.py` | Searched the file for every number in `scenario/qr004.yaml`. `No matches found.` A follow up search for any digit returned 30 lines, all of them section references in comments, the path `scenario/qr004.yaml`, structural zeros, the two `/ 60` conversions from seconds to minutes, and list indexing. |
| `window_minutes` lives in one place | Searched `src` for `def window_minutes` and the window arithmetic. Three hits, all in `rules.py` at lines 57, 67 and 123. None in `scenario.py`. The passing test run proves the import back from `scenario.py` does not loop. |

**Open**

- Five points went on the verify list for a human to confirm, V34 to V38. In short: the wording of
  `explain`, `plan_text`, `member_text` and the action texts was written here because the spec
  fixes the numbers but not the sentences; `cargo_protected` is true when no shipment is affected;
  `bags_protected` counts bags only where the connection is kept and the bags make the window;
  the shipment field `min_transfer_min` is not read, `rules.cargo_min` is; and `Platinum` is the
  top tier name in code.

## Phase 3 — synthetic data

**Built**

- `src/hubdemo/generate.py`. The row generator. It builds every lakehouse table from section 2.1
  of the demo spec out of the loaded scenario and one seeded `random.Random`, writes them as
  Parquet with an explicit Arrow schema per table, reads them back, and rebuilds a `Scenario`
  object from the rows so the result can be compared with the file. Public names:
  `build_dataset`, `write_dataset`, `read_dataset`, `read_table`, `dataset_digest`,
  `rebuild_scenario`, `check_dataset`, `schema_for`, `data_dir`, `Dataset` and `GenerateError`.
- `src/hubdemo/events.py`. The event timeline. One `departed` event per background arrival, the
  trigger event at its own time, and a `landed` event for the inbound at the new eta. Seven rows,
  sorted by time then flight then type, written as JSON lines. It imports `hubdemo.models` only.
- No number from `scenario/qr004.yaml` is written in `generate.py` or `events.py` as a literal,
  the same rule that governs `rules.py`. Every count, threshold, time and identifier comes off the
  loaded scenario. The two generator constants that were close to a scenario number, the remark
  spacing and the passengers per scaled flight, were moved off those values on purpose and say so
  in a comment.
- `hubdemo generate` and `hubdemo validate` in `src/hubdemo/cli.py`. `generate` takes
  `--scenario`, `--seed`, `--out`, `--scale` and `--dry-run` and prints a count per table.
  `validate` takes `--scenario` and `--data`, recomputes the totals, the windows, the at risk set
  and the outcome of the proposed plan from the rows, and exits 1 with a list of differences if
  anything disagrees with the `expected` block.
- `tests/test_generate.py`. 33 cases. They cover the four properties the phase asks for, that
  validation passes for seed 42 and for two other seeds, that the poisoned remark appears exactly
  once and on the right onward flight, that no generated passport or phone matches a realistic
  pattern, and that `--scale 20` leaves every expected result unchanged. They also cover
  determinism through a content hash rather than file bytes, the read back path, the
  `GenerateError` paths and the shape of the event timeline. Every expectation is read from the
  scenario object, so the tests assert the contract and not the code.

**Verified**

Everything below ran from `demos/03-airline` on the local Python 3.11.17 virtual environment,
the same one phase 0, phase 1 and phase 2 used. No cloud resource was touched.

| Check | Result |
| --- | --- |
| `ruff check .` | `All checks passed!`, exit code 0 |
| `pytest -q` | `133 passed in 2.43s`, exit code 0. Phase 2 ended at 100, so phase 3 adds 33. |
| `hubdemo generate --out data` | exit code 0. `flights 20`, `gates 17`, `passengers 268`, `members 63`, `bookings 268`, `bags 299`, `cargo_shipments 3`, `next_flights 3`, `transfer_rules 7`, `tier_benefits 4`, `flight_events 7`. 268 is `inbound.pax_onboard`, 63 is `expected.totals.connecting_members`, 299 bags is 195 transfer bags plus one bag each for the 104 passengers who end in Doha, and the 20 flights are the inbound, 11 onward, 3 next and 5 background arrivals. |
| `hubdemo validate --data data` | `the rows reproduce the scenario file`, exit code 0 |
| `hubdemo generate --out data --scale 20` | exit code 0. `flights 80`, `gates 77`, `passengers 628`, `bookings 628`, `bags 659`. Members, cargo, next flights, transfer rules, tier benefits and events are unchanged at 63, 3, 3, 7, 4 and 7. |
| `hubdemo validate --data data` after `--scale 20` | `the rows reproduce the scenario file`, exit code 0. This is rule 9 of the phase, proven at run time as well as in a test. |
| No scenario number as a literal in `generate.py` or `events.py` | Searched both files for every number in `scenario/qr004.yaml`. Zero matches, exit code 0. |

The written files land in `demos/03-airline/data`, which is already in `.gitignore` and is not
committed. At the default scale that is 11 files and about 33 KB, the largest being
`passengers.parquet` at just under 9 KB.

**Open**

- Phase 3 produces nothing that has to exist in a cloud tenant. The generator writes local
  Parquet and JSON lines, reads them back locally, and makes no network call. Phase 4 is the
  first phase that touches Fabric or Azure.
- Nine points went on the verify list for a human to confirm, V39 to V47. In short: background
  arrivals carry an empty `origin` and next flights an empty `gate_id`, because the scenario names
  a city and a time but no airport code and no gate; `concourse` is derived from the first letter
  of the gate; the transfer rule descriptions, the tier benefit source note, the event texts and
  the given and family name lists are all invented here because the spec fixes the numbers but not
  the words; `departure_delay_min` is read from the scenario during validation because no row
  model carries it; and `expected.at_risk_totals` is deliberately not re-checked, because summing
  passengers, bags and members over the at risk flights would re-implement impact maths outside
  `rules.py`, which rule 4 forbids. The proposed plan outcome already exercises the per flight
  passenger, bag, member and tier counts for all three at risk flights.
- V31 stays open. The Microsoft Learn MCP server still returns empty results. Phase 3 needed no
  platform API, so nothing was blocked by it.

## Phase 4 — fabric foundation

**Built**

- `src/hubdemo/fabric_api.py` is the small Fabric REST client the scripts share. It reads a token
  through `DefaultAzureCredential`, sends one request with a timeout, retries a 429 using the
  `Retry-After` header, walks a list endpoint page by page through the continuation token and
  finds an item by display name. Every constant and every call carries the documentation URL it
  came from in a comment next to it, which is what rule 2 asks for.
- `scripts/fabric_bootstrap.py` is deliverable 1. With `--dry-run` it prints the five things it
  would do and the configuration keys that are still empty, and makes no network call at all.
  Without it, it finds the capacity by display name, looks for a workspace with the configured
  name and creates one on that capacity only when it is missing, so a second run changes nothing.
- `fabric/workspace/` holds the item definitions, deliverable 2, sixteen files across five items:
  `lh_hub.Lakehouse`, `eh_hub.Eventhouse`, `hubdb.KQLDatabase`, `sqldb_hub_ops.SQLDatabase` and
  `nb_load_reference.Notebook`. Each one has a `.platform` file with a stable logical id. The KQL
  database carries `DatabaseSchema.kql`, which creates the `flight_events` table from section 2.2
  of the spec, its ingestion mapping and the `ConnectionWindows` function. The SQL database is a
  `sqlproj` with one `.sql` file per table for `plans`, `approvals`, `actions` and
  `security_events`, each with named primary key, foreign key and check constraints.
- `fabric/workspace/parameter.yml` holds the two placeholder ids the notebook needs, the default
  lakehouse and its workspace, so fabric-cicd can replace them per environment. It sits next to
  the item folders rather than at `fabric/parameter.yml`, because fabric-cicd requires the file in
  the root of the directory it is given. That deviation from the prompt is V54.
- `scripts/upload_landing.py` is deliverable 3. It finds the generated Parquet files, refuses to
  start when one is missing and names the command that produces them, then uploads each one to
  `lh_hub.Lakehouse/Files/landing` through the OneLake DFS endpoint with overwrite on, so running
  it twice leaves the same ten files. It uploads Parquet only. `flight_events.jsonl` is left for
  the phase 5 eventstream.
- `fabric/deploy.py` is deliverable 4. It reads the item folders, resolves the workspace by name
  and hands the directory to fabric-cicd's `publish_all_items`. It deliberately does not call
  `unpublish_all_orphan_items`, because that removes anything in the workspace the repository does
  not know about, and nothing in this demo should delete a resource a person created.
- `tests/live/test_fabric_foundation.py` is deliverable 5. It compares the row count of every
  lakehouse table against the row count of the generated file it came from, by querying the
  lakehouse SQL analytics endpoint over ODBC. It skips itself unless `HUBDEMO_LIVE` is set and
  `pyodbc` is installed, so it never blocks the offline suite.
- `tests/test_fabric_assets.py` checks everything about phase 4 that can be checked without a
  tenant: that each item folder exists, that the `.platform` files are complete and their logical
  ids unique, that the KQL schema uses only the commands a definition file is allowed to contain,
  that each SQL file creates the table its name promises, that the notebook reads the landing path
  and writes a table, that `parameter.yml` names both placeholders, and that all three scripts
  produce a sensible plan and a clean `--dry-run`.
- `src/hubdemo/config.py` gained `get_optional`, which returns a default instead of raising when a
  key is empty. `get` still fails loudly and is still what the live paths use. The dry runs need
  the softer one, because `config/env.example.yaml` is empty on purpose.
- `pyproject.toml` gained four dependencies, `fabric-cicd`, `azure-identity`,
  `azure-storage-file-datalake` and `requests`, and a ruff exclude for `fabric/workspace`, because
  the item definition files are platform artefacts and not project source.

**Verified**

Everything below ran from `demos/03-airline` on the local Python 3.11.17 virtual environment,
the same one phase 0 to phase 3 used. No cloud resource was touched and no network call was made.

| Check | Result |
| --- | --- |
| `ruff check .` | `All checks passed!`, exit code 0 |
| `pytest -q` | `179 passed, 1 skipped in 2.40s`, exit code 0 |
| `python scripts/fabric_bootstrap.py --env example --dry-run` | printed the five planned steps, listed `fabric.capacity_name` and `fabric.workspace_name` as still empty, ended with `no network call was made`, exit code 0 |
| `python scripts/upload_landing.py --env example --dry-run` | listed all ten Parquet files with their sizes and target paths under `lh_hub.Lakehouse/Files/landing`, ended with `dry run, no network call was made`, exit code 0 |
| `python fabric/deploy.py --env example --dry-run` | listed the five item types and the five items it would publish, said it removes nothing, ended with `dry run, no network call was made`, exit code 0 |
| `python fabric/deploy.py --env demo` run twice | not run, see below |
| `tests/live/test_fabric_foundation.py` with `HUBDEMO_LIVE=1` | not run, see below |

Phase 3 ended at 133 tests, so phase 4 adds 46 and breaks nothing. The one skip is the live
module. It skips because `pyodbc` is not installed, which is correct for an offline machine.

**Open**

- Neither of the prompt's two "Done when" items could be run, because there is no Fabric tenant
  yet. `python fabric/deploy.py --env demo` needs a workspace on a capacity, and the live test
  needs that workspace plus its SQL analytics endpoint. Both are written, both are exercised
  offline as far as they can be, and both stay open until a person completes manual steps 5 to 9.
- Eleven points went on the verify list, V48 to V58, all of which a first real deploy will settle.
  In short: the eventhouse copies of `flights` and `bookings` are empty until phase 5 decides how
  to fill them, so `ConnectionWindows` returns nothing yet; the logical ids in the `.platform`
  files are written by this repository rather than issued by Fabric; `lakehouse.metadata.json`
  names a default schema that may need to be dropped; the ingestion mapping in `DatabaseSchema.kql`
  is written as adjacent quoted fragments and is the most likely first failure; the notebook is
  bound through `parameter.yml` rather than a `notebook-settings.json` file, because the REST
  article and the one real synced notebook in this repository both say so while the fabric-cicd
  guide says otherwise; `parameter.yml` sits one folder deeper than the prompt says; the OneLake
  item type suffix case is unconfirmed; workspace names are assumed unique ignoring case; the ODBC
  connection uses interactive sign in, because the access token route was not fully documented on
  the page that describes it; and the live test assumes the lakehouse tables appear in schema
  `dbo`.
- V1 and V4 are now closed. Qatar Central carries Power BI only, so the capacity has to live
  somewhere else and UAE North is the recommendation, which is V1. fabric-cicd does support all
  five item types this phase needs, including SQL database, which is V4.
- Five manual steps were added, 5 to 9: create the capacity in a full workload region, turn on the
  tenant settings, create the workspace on a paid F2 or larger capacity, switch the lakehouse SQL
  analytics endpoint to user identity access mode before anything is built on it, and install the
  ODBC driver for the live test. Step 8 has to happen before step 9 and before phase 5, because
  switching the access mode briefly takes every SQL endpoint in the workspace offline.
- V31 stays open. The Microsoft Learn MCP server still returns empty results. Phase 4 needed nine
  documentation pages and several more besides, and every one of them was fetched from
  `learn.microsoft.com` directly instead, with the confirmed URL recorded next to the call.
