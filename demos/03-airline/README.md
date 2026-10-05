# Hub connections demo: GitHub Copilot build kit

Starting point for a repository that builds an end-to-end demo with GitHub Copilot: one late flight at an airline hub, followed through Microsoft Fabric, Microsoft Foundry, Microsoft 365 Copilot, an approval process and the security layer. All data is synthetic.

## What is in the kit

| Path | What it is |
|---|---|
| `docs/BUILD_SCRIPT.md` | The script: decisions, architecture, 16 phases, what to verify, sources |
| `docs/demo-spec.md` | Storyline, data contract, rules, approval policy, expected results, security moments |
| `scenario/qr004.yaml` | The scenario and the expected numbers every test asserts |
| `.github/copilot-instructions.md` | Rules Copilot follows in every change |
| `.github/instructions/` | Extra rules for Fabric items, agent code and security work |
| `.github/prompts/` | One prompt file per phase |
| `.vscode/mcp.json` | The Microsoft Learn MCP server, so Copilot can look up documentation |
| `AGENTS.md` | Pointer for agents that read this file |

## Start

1. Create a private repository and copy these files into it.
2. Open it in VS Code with GitHub Copilot in agent mode. Start the `microsoft-learn` server from `.vscode/mcp.json`.
3. Read sections 2 and 3 of `docs/BUILD_SCRIPT.md`.
4. Run phase 0: type `/00-bootstrap` in the chat, or write "Read and carry out `.github/prompts/00-bootstrap.prompt.md`".
5. Check the "Done when" list, do the manual steps, commit, continue with the next phase.

Phases 0 to 3 run offline. Cloud resources are needed from phase 4.

## Ground rules

- Synthetic data only. Do not load real passenger, member or operational data into this repository or its demo tenant.
- Build in a demo tenant, not in a customer tenant.
- Several components are in preview. Section 7 of the build script lists what to verify and what to do when a check fails.
