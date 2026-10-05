# foundry

The Microsoft Foundry side of the demo.

The planner agent, its tools, the evaluations and the red teaming runs.

Agent instructions live here as files, so they can be reviewed in a pull request.
They describe behaviour and name the tools to call. They never contain scenario
numbers: those come from the rules module through the tools.

No agent tool writes to `actions`. Only the approval workflow dispatches.
