---
applyTo: "foundry/**"
---

# Agent code

- The planner agent explains and orchestrates. It gets every number from a tool and repeats it unchanged. If a tool fails, the agent says so; it does not estimate.
- Tools are narrow: one purpose, typed inputs, typed outputs. No tool runs free-form SQL or KQL from model output.
- The agent has read tools and one write tool, `submit_plan_for_approval`. It has no tool that dispatches actions.
- Instructions (system prompts) live in `foundry/agent/instructions/*.md`, under version control, without scenario numbers.
- Model deployment names come from configuration. Do not hard-code a model name.
- Every run is traced. Trace IDs are stored with the plan so the record of a run can be found later.
- An evaluation case is added for every behaviour that was fixed after a failure.
