# src/hubdemo

The Python package. Everything that computes a number lives here.

- `config.py` — reads `config/env.<name>.yaml` and says what is missing.
- `cli.py` — the `hubdemo` command.

Later phases add the scenario models, the scenario loader, `rules.py`, the data
generator and the event replay.

`rules.py` is the only place that computes connection windows, at-risk results,
proposals, impact and approval stages. Agents call it; they do not restate it.
Prompts never contain scenario numbers.
