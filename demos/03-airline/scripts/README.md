# scripts

The things you run: bootstrap, checks, deployment, reset, and the demo runs.

- `check_prereqs.py` — Python version, `az account show`, the Fabric CLI, and
  whether an environment file is complete.

Every script that touches the cloud takes `--dry-run`, prints what it would do, and
is safe to run twice.
