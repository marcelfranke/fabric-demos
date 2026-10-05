# Agent instructions

This repository is built phase by phase from `docs/BUILD_SCRIPT.md`.

1. Read `.github/copilot-instructions.md` first. Its ten rules apply to every change.
2. Read `docs/demo-spec.md` and `scenario/qr004.yaml`. They are the contract; numbers come from the scenario file only.
3. Work on one phase at a time. The prompt for each phase is in `.github/prompts/`.
4. Look up every Microsoft platform API on Microsoft Learn before using it. If it is not documented, stop and record the gap in `docs/manual-steps.md`.
5. Synthetic data only. No secrets in the repository. No agent gets a tool that dispatches actions.
