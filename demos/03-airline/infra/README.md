# infra

Bicep for the Azure resources the demo needs, and the script that deploys them.

The resource group contents: the Foundry resource and project, the Log Analytics
workspace behind Sentinel, and anything else created outside Fabric.

Everything is parameterised from `config/env.<name>.yaml`. Deployment is idempotent
and supports `--dry-run`, so it is safe to run twice.
