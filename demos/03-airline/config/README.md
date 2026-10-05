# config

Environment files, one per environment: `env.<name>.yaml`.

`env.example.yaml` is the template. It carries every key the kit needs, with no
values, and it is the only file in this folder that is committed.

Copy it to `env.demo.yaml` and fill it in. Filled-in files are ignored by git.

These files hold names and identifiers only. No secrets belong here: Azure access
comes from `DefaultAzureCredential` after `az login`.

Check a file with `python scripts/check_prereqs.py --env <name>`.
