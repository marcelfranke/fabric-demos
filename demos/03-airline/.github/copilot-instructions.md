# Instructions for GitHub Copilot in this repository

This repository builds an end-to-end demo: one late flight at an airline hub, followed through Microsoft Fabric, Microsoft Foundry, Microsoft 365 Copilot, an approval process and the security layer. Read `docs/demo-spec.md` and `scenario/qr004.yaml` before you write anything. They are the contract.

## Rules that always apply

1. **Synthetic data only.** Never add real passenger, member, flight or company data. Every generated person is invented. Fake identifiers use patterns that cannot be real.
2. **No invented APIs.** Before you use a Fabric, Foundry, Purview, Entra, Defender, Sentinel, API Management or Copilot Studio API, SDK call or item definition, look it up with the Microsoft Learn MCP tools (`microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search`). Put the documentation URL in a comment next to the call. If you cannot find documentation, do not guess: add an entry to `docs/manual-steps.md` that says what a person has to do in the portal, and stop.
3. **Preview features are marked.** Add `# PREVIEW:` with the feature name wherever code depends on a preview, and list it in `docs/verify-list.md`.
4. **Rules are code.** Connection windows, option results, proposals, member impact and approval stages are computed in `src/hubdemo/rules.py` and nowhere else. Agents call the rules; they never calculate times or counts themselves, and prompts never contain scenario numbers.
5. **The scenario file is the single source of numbers.** Do not hard-code flight numbers, counts or thresholds in code, prompts, tests or dashboards. Load them from `scenario/qr004.yaml`. Tests assert against its `expected` block.
6. **No secrets in the repository.** Use `DefaultAzureCredential` and `az login`. Configuration goes in `config/env.<name>.yaml`; secrets go in Key Vault or a local `.env` that is git-ignored. Keep `.env.example` current.
7. **Agents cannot change operations.** No agent gets a tool that writes to `actions`. Only the approval workflow calls `dispatch_actions`, and that function checks the approvals itself.
8. **One phase at a time.** Work only on the phase named in the prompt. Do not start the next one. Finish by updating `docs/status.md` and listing every manual step you could not automate.
9. **Idempotent and dry-runnable.** Every script that creates or changes cloud resources supports `--dry-run` and can run twice without harm.
10. **Plain names and plain text.** Use the names in `docs/demo-spec.md`. User-facing text is short, sentence case, no marketing language.

## Stack

- Python 3.11 (the Fabric user data functions runtime is 3.11), `pydantic` v2, `pytest`, `ruff`. Package code under `src/hubdemo`.
- Azure resources in Bicep under `infra/`. One parameter file per environment.
- Fabric items as item definitions under `fabric/workspace/`, deployed with `fabric-cicd` or the Fabric CLI (`fab`); use the Fabric REST item definition APIs where those tools do not cover an item type.
- KQL for the eventhouse, T-SQL for the SQL database.
- Foundry agent code in Python with the Microsoft Agent Framework and `azure-ai-projects`.
- Tests: unit tests run offline. Tests that need cloud resources are marked `@pytest.mark.live` and are skipped unless `HUBDEMO_LIVE=1`.

## Repository layout

```
config/      environment files (no secrets)
docs/        specification, build script, runbook, status, manual steps, verify list
scenario/    the scenario file
src/hubdemo/ models, scenario loader, rules, generator, event replay
fabric/      Fabric item definitions and deployment scripts
foundry/     planner agent, tools, evaluations, red teaming
infra/       Bicep for Azure resources
security/    OneLake roles, Sentinel rules, guardrail and gateway configuration
scripts/     bootstrap, reset, run, checks
tests/       unit, live and security tests
```

## Definition of done for every phase

- `ruff check .` and `pytest -q` pass.
- New cloud resources are created by a script or template in the repository, or listed in `docs/manual-steps.md`.
- `docs/status.md` says what was built, what was verified and how, and what is still open.
- Nothing in the change contradicts `docs/demo-spec.md`. If the specification is wrong, say so and stop; do not work around it.
