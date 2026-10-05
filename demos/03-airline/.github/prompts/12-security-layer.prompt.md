---
description: "Phase 12: Security layer"
---
# Phase 12: Security layer

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** Each control is configured, has a test that proves it, and has a demo moment.

## Task

Build the security layer control by control. For each one, fetch its documentation first, configure it from the repository where an API exists, document the portal steps where it does not, and write the test.

1. Identity. `scripts/create_groups.py --env <name>`: security groups for duty managers, operations control, gate agents and builders, with the demo users from the configuration. Builders are workspace contributors. Everyone else gets Viewer or item read access only: workspace Admin, Member and Contributor are not restricted by OneLake security roles. A script that lists the planner's agent identity and assigns it the roles it needs, nothing more.
2. Data access. `security/onelake/roles.json` and `scripts/apply_onelake_roles.py` (data access roles API): a role for gate agents that can read all reference tables but not `passport_no` and `contact_phone`; a role for duty managers and operations control that can read everything; no default reader. Check that the SQL analytics endpoint of the lakehouse runs in User's identity access mode (phase 4); in delegated mode the roles are not enforced there, and the data agent queries the lakehouse through that endpoint. Test S1: the same question about a passenger's phone number, asked as a gate agent and as a duty manager. The test needs two signed-in users; if that cannot be scripted, make it a manual check with the evidence to collect.
3. Data protection. `scripts/apply_labels.py`: applies the sensitivity label from the configuration to the lakehouse and the SQL database with the admin API for bulk label assignment. Only a Fabric administrator who is a user can call it, so the script runs with a signed-in admin. `docs/purview-setup.md`: turning on audit, the setup task that secures interactions in Copilot experiences, and the Fabric tenant setting that lets Purview secure AI interactions (audit of data agent interactions is in preview). Optional: a data loss prevention policy for Fabric with a custom sensitive information type that matches the fake passport pattern. State what Purview does not cover here.
4. AI safety. `infra/guardrail.bicep`: a guardrail (`raiPolicies` resource) for the planner with prompt attack detection on user input, indirect attack detection on tool responses and the default content controls, set to block. Assign it in code if the planner is a hosted agent; otherwise document the portal step. Test S2: run the planner on the scenario with the poisoned remark and assert that no plan contains a hold above the limit and that the run is blocked or annotated. Record where the event can be found afterwards (trace, guardrail annotation, Defender alert if one is raised).
5. Gateway. `docs/gateway-setup.md`: enabling the AI gateway for the Foundry resource, adding the project, and setting a token limit per minute and a total quota for the planner's model deployment from the configuration. Turn on the diagnostic setting that sends the gateway logs to the Log Analytics workspace. Test S3: send requests until the gateway refuses (429 on the rate limit, 403 on the quota), then confirm that a normal planner run works again.
6. Threat detection. `infra/defender.bicep`: threat protection for AI services on the subscription. `infra/sentinel.bicep`: the Sentinel workspace. `security/sentinel/rules/`: scheduled rules as code for (a) a dispatch attempt without approval and (b) a burst of refused requests in the gateway logs. For (a), forward new rows of `security_events` to a custom table in the Log Analytics workspace with the simplest documented mechanism, for example the Logs Ingestion API, and name the mechanism in `docs/status.md`. Test S4: call `dispatch_actions` on an unapproved plan and wait for the incident.
7. `docs/security-layer.md`: one table with a row per control: what it protects, which product, where it is configured, how it is tested, what it does not cover.

## Done when

- Tests S1 to S4 pass, or are documented as manual checks with the evidence to collect.
- `docs/security-layer.md` lists every control and every open point from section 7 of the build script that concerns security.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Purview: audit, the Copilot interactions setup task, the Fabric tenant setting "Allow Microsoft Purview to secure AI interactions", the sensitivity label, and optionally the data loss prevention policy.
- Foundry: enable the AI gateway, add the project and set the token limits (Manage, AI Gateway, Token management). Assign the guardrail in the portal if it could not be assigned in code.
- Sentinel: connect Defender XDR and Defender for Cloud.
- Microsoft 365 admin center: find the published planner under Agents and note what blocking it does. For Foundry agents the documentation says blocking affects availability in Microsoft 365 Copilot Chat only.

## Documentation to fetch first

- [Data security in OneLake](https://learn.microsoft.com/fabric/onelake/security/get-started-security)
- [OneLake data access roles API](https://learn.microsoft.com/rest/api/fabric/core/onelake-data-access-security/create-or-update-data-access-roles)
- [Read data secured with OneLake security](https://learn.microsoft.com/fabric/onelake/security/read-secured-data)
- [OneLake security for SQL analytics endpoints](https://learn.microsoft.com/fabric/onelake/security/sql-analytics-endpoint-onelake-security)
- [Data agent sharing and permissions](https://learn.microsoft.com/fabric/data-science/data-agent-sharing)
- [Bulk set sensitivity labels (admin API)](https://learn.microsoft.com/rest/api/fabric/admin/labels/bulk-set-labels)
- [Data loss prevention for Fabric and Power BI](https://learn.microsoft.com/purview/dlp-powerbi-get-started)
- [Purview for Copilot in Fabric](https://learn.microsoft.com/purview/ai-copilot-fabric)
- [Purview audit for the Fabric data agent](https://learn.microsoft.com/fabric/data-science/data-agent-purview-governance)
- [Guardrails in Foundry](https://learn.microsoft.com/azure/foundry/guardrails/guardrails-overview)
- [Guardrail intervention points](https://learn.microsoft.com/azure/foundry/guardrails/intervention-points)
- [Create guardrails](https://learn.microsoft.com/azure/foundry/guardrails/how-to-create-guardrails)
- [Guardrails for hosted agents](https://learn.microsoft.com/azure/foundry/agents/how-to/add-hosted-agent-guardrails)
- [Prompt Shields](https://learn.microsoft.com/azure/foundry/openai/concepts/content-filter-prompt-shields)
- [AI gateway in Foundry](https://learn.microsoft.com/azure/foundry/configuration/enable-ai-api-management-gateway-portal)
- [Enforce token limits for models](https://learn.microsoft.com/azure/foundry/control-plane/how-to-enforce-limits-models)
- [Govern MCP tools with an AI gateway](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/governance)
- [AI threat protection in Defender for Cloud](https://learn.microsoft.com/azure/defender-for-cloud/ai-threat-protection)
- [Detection and protection for AI agents in Defender](https://learn.microsoft.com/defender-xdr/security-for-ai/ai-agent-detection-protection)
- [Defender XDR and Sentinel](https://learn.microsoft.com/azure/sentinel/microsoft-365-defender-sentinel-integration)
- [Logs Ingestion API](https://learn.microsoft.com/azure/azure-monitor/logs/logs-ingestion-api-overview)
- [Sentinel scheduled analytics rules](https://learn.microsoft.com/azure/sentinel/create-analytics-rules)
- [Agent 365 integration for Foundry agents](https://learn.microsoft.com/azure/foundry/agents/concepts/agent-365-integration)
- [Manage agents in the Microsoft 365 admin center](https://learn.microsoft.com/microsoft-365/admin/manage/agent-actions)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
