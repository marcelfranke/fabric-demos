---
description: "Phase 8: Fabric agents (Run A)"
---
# Phase 8: Fabric agents (Run A)

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** Run A works end to end with Microsoft-built agents: the operations agent alerts and recommends in Teams, and the data agent answers frontline questions.

## Task

Build the two Fabric agents. Fetch the data agent SDK article, the data agent MCP server article, the operations agent articles and the operations agent definition first. PREVIEW: data agent SDK, operations agent with an ontology source.

Frontline data agent:
1. `fabric/agents/frontline_data_agent.py --env <name>`: creates or updates the data agent `HubFrontlineAgent` with the Fabric data agent SDK, sets its instructions from `fabric/agents/frontline_instructions.md`, adds the data sources and example queries, and publishes it.
2. Instructions: answer only from the data; say when a plan is proposed but not yet approved; give counts and gates, never passport numbers or phone numbers; if the data does not answer the question, say so.
3. Data sources: the lakehouse tables and the plan and action tables. A data agent takes at most five sources. Do not add the KQL database: service principal calls are not supported for data agents with a KQL source. The ontology as a data agent source is in preview and the SDK documentation does not name it; add it in the portal and document the step.
4. `tests/prompts/frontline.yaml`: the gate-agent questions with the facts each answer must contain, computed from the rules engine at test time.
5. `tests/live/test_frontline_agent.py`: asks each question three times through the agent's MCP endpoint and reports the pass rate per question.

Operations agent:
6. `fabric/workspace/HubConnectionsWatch.OperationsAgent/` definition: instructions (watch arrival updates; when a connection window falls below the standard minimum, recommend the proposed plan and name the passengers, members, bags and cargo at stake), the ontology or the KQL database as data source, one action `ExecuteProposedPlan` that runs the pipeline `pl_execute_plan`, and the duty manager or the Teams channel from the configuration as message destination. Deploy it stopped.
7. `fabric/workspace/pl_execute_plan.DataPipeline`: calls `propose_plan` with `proposed_by = operations-agent` and the single-stage policy, records the Teams approval as stage 1 with the recipient from the configuration, then calls `dispatch_actions`.
8. `docs/run-a.md`: what the presenter does and sees in Run A.

## Done when

- After a reset and a replay, the operations agent posts its recommendation in Teams.
- Approving it in Teams leads to 11 rows in `actions`.
- The frontline test reports its pass rate; any question below three out of three is listed in `docs/status.md`.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Install the "Fabric Operations Agent" app in Teams for the duty manager.
- Open the operations agent, generate the playbook, review it against the rules, then start the agent. Create it with a dedicated demo account: the agent acts with the identity of its creator.
- Publish the data agent, then make it available in Microsoft 365 Copilot from the Publish dialog (preview; not available through the API).

## Documentation to fetch first

- [Fabric data agent Python SDK](https://learn.microsoft.com/fabric/data-science/fabric-data-agent-sdk)
- [Data agent as an MCP server](https://learn.microsoft.com/fabric/data-science/data-agent-mcp-server)
- [Create and configure operations agents](https://learn.microsoft.com/fabric/real-time-intelligence/operations-agent)
- [Operations agent actions](https://learn.microsoft.com/fabric/real-time-intelligence/operations-agent-actions)
- [Operations agent definition](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/operations-agent-definition)
- [Operations agent grounded in an ontology](https://learn.microsoft.com/fabric/iq/ontology/how-to-create-operations-agent)
- [Fabric data agent concept](https://learn.microsoft.com/fabric/data-science/concept-data-agent)
- [Data agent data sources](https://learn.microsoft.com/fabric/data-science/data-agent-add-datasources)
- [Service principal authentication for the data agent](https://learn.microsoft.com/fabric/data-science/data-agent-service-principal)
- [Operations agent limitations](https://learn.microsoft.com/fabric/real-time-intelligence/operations-agent-limitations)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
