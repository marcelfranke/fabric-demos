---
description: "Phase 0: Repository bootstrap"
---
# Phase 0: Repository bootstrap

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** An empty but working repository: package, configuration, checks, status files.

## Task

Set up the repository skeleton.

1. `pyproject.toml` for the package `hubdemo` (src layout, Python 3.11). Runtime dependencies: pydantic v2, pyyaml, typer, pandas, pyarrow. Development: pytest, pytest-cov, ruff. Console script `hubdemo`.
2. The folders from the layout in `.github/copilot-instructions.md`, each with a short `README.md` that says what belongs there.
3. `config/env.example.yaml` with these keys and no values: `tenant_id`, `subscription_id`, `location`, `resource_group`, `fabric.capacity_name`, `fabric.workspace_name`, `foundry.resource_name`, `foundry.project_name`, `foundry.model_deployment`, `foundry.price_in_per_million`, `foundry.price_out_per_million`, `people.duty_manager_upn`, `people.ops_control_manager_upn`, `people.gate_agent_upn`, `people.builder_upn`, `teams.team_id`, `teams.channel_id`, `sentinel.workspace_name`, `purview.label_name`. Add `src/hubdemo/config.py` that loads `config/env.<name>.yaml` and fails with a clear message when a key is missing.
4. `.env.example` and a `.gitignore` that excludes `.env`, `data/`, `.venv`, caches and Parquet files.
5. `docs/status.md` (table: phase, state, verified how, open points), `docs/manual-steps.md` (table: step, where, why not automated, documentation link, how to check) and `docs/verify-list.md`, seeded with every item from section 7 of `docs/BUILD_SCRIPT.md`.
6. `scripts/check_prereqs.py --env <name> [--dry-run]`: checks the Python version, `az account show`, that the Fabric CLI `fab` is installed, and that the configuration file is complete. It prints what is missing and exits non-zero if anything is.
7. `.github/workflows/ci.yml`: ruff and pytest on push and pull request.
8. `tests/test_smoke.py`: imports the package and parses `scenario/qr004.yaml`.

## Done when

- `ruff check .` and `pytest -q` pass.
- `python scripts/check_prereqs.py --env example --dry-run` runs and lists the empty keys.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Create the GitHub repository (private) and copy this kit into it.
- Copy `config/env.example.yaml` to `config/env.demo.yaml` and fill it in.

## Documentation to fetch first

- [About customizing GitHub Copilot responses](https://docs.github.com/en/copilot/concepts/prompting/response-customization)
- [Repository custom instructions in your IDE](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide)
- [Prompt files (GitHub)](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file)
- [Prompt files (VS Code)](https://code.visualstudio.com/docs/agent-customization/prompt-files)
- [MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Microsoft Learn MCP server](https://github.com/MicrosoftDocs/mcp)
- [Microsoft Learn MCP server reference](https://learn.microsoft.com/training/support/mcp-developer-reference)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
