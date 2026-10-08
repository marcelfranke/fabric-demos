# config

Environment files, one per environment: `env.<name>.yaml`.

`env.example.yaml` is the template. It carries every key the kit needs, with no
values, and it is the only file in this folder that is committed.

Copy it to `env.demo.yaml` and fill it in. Filled-in files are ignored by git.

These files hold names and identifiers only. No secrets belong here: Azure access
comes from `DefaultAzureCredential` after `az login`.

Check a file with `python scripts/check_prereqs.py --env <name>`.

Two keys cannot be read from any API: `eventstream.namespace` and
`eventstream.event_hub`. They are copied by hand from the custom endpoint on the
eventstream `es_flight_events` in the Fabric portal. See `docs/manual-steps.md`.
