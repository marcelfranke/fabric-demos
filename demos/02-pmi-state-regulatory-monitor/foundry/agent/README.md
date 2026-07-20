# PMI Pricing-Compliance Agent (Foundry / "FoundryIQ")

This folder is a **reproducible backup** of the Azure AI Foundry agent that sits at the
top of the PMI Dynamic Pricing "three-IQ" demo:

```
Microsoft 365 Copilot / WorkIQ   (user surface)
        │
        ▼
PMI-Pricing-Compliance-Agent     ← THIS agent (FoundryIQ)  ── File Search KB (policy/facts)
        │                                                   └─ Fabric Data Agent (numbers)
        ▼
"PMI Dynamic Pricing" semantic model  (FabricIQ)
```

The agent itself lives only in the Foundry service — this export lets you rebuild it if
the Foundry project is ever recreated.

## What's here

| File | Purpose |
|------|---------|
| `PMI-Pricing-Compliance-Agent.agent.json` | Cleaned, reproducible agent definition (model, instructions, RAI policy, both tools). |
| `PMI-Pricing-Compliance-Agent.raw.json` | Full raw `agent_get` response as exported from Foundry (source of truth). |

## Agent summary

- **Name:** `PMI-Pricing-Compliance-Agent`
- **Model:** `gpt-5`, reasoning effort `low`
- **Content safety (RAI) policy:** `Guardrails538` (custom policy on account `FoundryAgentHub4`)
- **Routing logic:** two knowledge sources, chosen deliberately —
  - **File Search KB** → policy, definitions, the 5-action playbook, hard rules R1–R5,
    which states ban which products (authoritative for anything definitional/statutory).
  - **Fabric Data Agent** → live numbers only: prices, tax %, revenue at risk, signal
    counts, per-SKU/per-state sellable status + recommended action.
- **Guardrail behavior:** never prices a flavor-banned / delisted SKU (refuses and
  recommends delisting); never invents numbers or policy.

## Connected tools (must be recreated in the target project)

The two tools reference **project connections** that are specific to the source Foundry
project (`proj-default` on `FoundryAgentHub4`). Before re-applying this definition to a
new project you must recreate them:

1. **Fabric Data Agent** (`fabric_dataagent_preview`) — connection
   `fabric_dataagent_preview_82e305`, pointing at the "Pricing Data Agent" in the
   **Dynamic Pricing** Fabric workspace
   (WS `aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05`, semantic model **PMI Dynamic Pricing**).
2. **Knowledge Base MCP** (`kb-pmi-compliance-kb-9kdyn`) — Azure AI Search Knowledge Base
   **pmi-compliance-kb** on search service **foundyiqkb1**, index **ks-file-278-index**
   (9 documents: the compliance KB, guardrail policy, and source PDFs).

## How to redeploy

Use the Foundry MCP / SDK `agent_update` operation (or the Foundry portal). Rough steps:

1. Create the target Foundry project and the two project connections above.
2. Update the `project_connection_id` values in `.agent.json` to match the new connections.
3. Ensure the `Guardrails538` RAI policy (or an equivalent) exists on the account.
4. Call `agent_update` with `agentName = PMI-Pricing-Compliance-Agent` and the
   `definition` block from `.agent.json`.

## Source

Exported from:
- Endpoint: `https://foundryagenthub4.services.ai.azure.com/api/projects/proj-default`
- Subscription: `a2b61c9f-b14c-42f3-99fe-35ff71298ae1`
- Resource group: `rg-AgentPlayground` · Account: `FoundryAgentHub4` · Project: `proj-default`
- Exported: 2026-07-20 (agent version 8)
