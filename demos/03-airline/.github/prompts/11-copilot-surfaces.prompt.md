---
description: "Phase 11: Copilot surfaces"
---
# Phase 11: Copilot surfaces

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** Gate staff reach the frontline agent in Microsoft 365 Copilot, and the duty manager reaches the planner in Teams.

## Task

Most of this phase happens in portals. Your job is to make those steps exact and checkable.

1. `docs/copilot-setup.md` with numbered steps, each with its documentation link and a way to check the result:
   - publishing the frontline data agent to Microsoft 365 Copilot and giving the gate agents group access to the agent and to its data sources
   - publishing the planner agent to Teams and Microsoft 365 Copilot, in the scope "just you" or shared by link, including the Azure Bot Service resource it needs
   - the limits that apply to published agents and what they mean for the demo
   - optional, documented only: a Copilot Studio agent that uses the Fabric data agent, to show the low-code step between Run A and Run B. The documentation is not consistent on whether this works inside Microsoft 365 Copilot: the connected-agent article says it is not supported there, the tool article describes publishing to it. Test it in Teams first and record the result
2. `foundry/publish.py --env <name> [--dry-run]`: publishes the planner through the REST API if the documentation supports your setup; otherwise leave it as a manual step.
3. `tests/prompts/duty_manager.yaml`: questions and requests for the planner ("why rebook Muscat", "what if we hold Singapore", "which members are affected") with the facts each answer must contain.
4. `scripts/check_copilot_ready.py --env <name>`: checks what can be checked from outside: the data agent's endpoint answers, the planner's published application exists.

## Done when

- `docs/copilot-setup.md` is complete and every step has a check.
- `scripts/check_copilot_ready.py` passes.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Make the data agent available in Microsoft 365 Copilot (preview). Users need the licence named in the article and access to the agent and its data sources.
- Publish the planner to Teams and Microsoft 365 Copilot. This creates an Azure Bot Service resource.
- Ask the Microsoft 365 administrator to confirm that the demo users can use agents in Microsoft 365 Copilot, and to show where the published planner appears under Agents in the Microsoft 365 admin center.

## Documentation to fetch first

- [Fabric data agent in Microsoft 365 Copilot](https://learn.microsoft.com/fabric/data-science/data-agent-microsoft-365-copilot)
- [Publish Foundry agents to Microsoft 365 Copilot and Teams](https://learn.microsoft.com/azure/foundry/agents/how-to/publish-copilot)
- [Publish with the REST API](https://learn.microsoft.com/azure/foundry/agents/how-to/publish-copilot-virtual-network)
- [Fabric data agent in Copilot Studio (connected agent)](https://learn.microsoft.com/fabric/data-science/data-agent-microsoft-copilot-studio)
- [Fabric data agent in Copilot Studio (tool)](https://learn.microsoft.com/fabric/data-science/data-agent-microsoft-copilot-studio-tool)
- [Agent 365 integration for Foundry agents](https://learn.microsoft.com/azure/foundry/agents/concepts/agent-365-integration)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
