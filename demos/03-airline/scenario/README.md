# scenario

The scenario file, and nothing else.

`qr004.yaml` is the single source of every number in the demo: the inbound flight,
the rules, the onward flights, the cargo, the approval policy and the `expected`
block the tests assert against.

Change a number here and the tests, the generated data and the run all change with
it. Never put a scenario number in a prompt, an agent instruction or a notebook.

The data is synthetic. Identifiers use patterns that cannot collide with real ones.
