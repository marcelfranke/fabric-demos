---
description: "Phase 4: Fabric foundation"
---
# Phase 4: Fabric foundation

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** Workspace, lakehouse, eventhouse and operational database exist, are deployed from the repository and hold the reference data.

## Task

Create the Fabric foundation as code. Before writing any item definition, fetch the definition article for that item type and the fabric-cicd and Fabric CLI documentation with the Microsoft Learn tools.

1. `scripts/fabric_bootstrap.py --env <name> [--dry-run]`: creates the workspace named in the configuration on the configured capacity if it does not exist, and prints its ID.
2. Item definitions under `fabric/workspace/`:
   - `lh_hub.Lakehouse`
   - `eh_hub.Eventhouse` and `hubdb.KQLDatabase`, with a schema script that creates the table `flight_events`, its JSON ingestion mapping and a OneLake shortcut or external table to the lakehouse tables the KQL functions need (check which of the two is documented; if neither works from a definition, load a copy of those small tables instead and say so in `docs/status.md`)
   - `sqldb_hub_ops.SQLDatabase` with the tables `plans`, `approvals`, `actions` and `security_events` from section 2.3 of `docs/demo-spec.md`. The definition article describes the dacpac and sqlproj formats. If fabric-cicd does not deploy this item type, create it through the REST API and apply the schema with an Entra-authenticated connection.
   - `nb_load_reference.Notebook`: reads the Parquet files from `Files/landing/` in the lakehouse and writes one Delta table per reference table, replacing existing content, then prints the row counts.
3. `scripts/upload_landing.py --env <name>`: uploads `data/*.parquet` to `Files/landing/` through the OneLake API with `DefaultAzureCredential`.
4. `fabric/deploy.py` using fabric-cicd, with `fabric/parameter.yml` for environment-specific IDs.
5. `tests/live/test_fabric_foundation.py`: after the load, the row counts in the lakehouse equal the row counts of the generated files.

## Done when

- `python fabric/deploy.py --env demo` runs twice without errors or duplicates.
- The live test passes with `HUBDEMO_LIVE=1`.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Create the Fabric capacity in a region that offers all Fabric workloads and the preview features used here; check the region availability page first. Qatar Central is listed there as a Power BI only region.
- Fabric tenant settings, each scoped to a security group: "Service principals can call Fabric public APIs" (older pages call it "Service principals can use Fabric APIs"), "Service principals can create workspaces, connections, and deployment pipelines", "Users can create Ontology (preview) items", "Users can use Copilot and other features powered by Azure OpenAI". If the capacity is outside the US and EU, also the two cross-geo settings for data sent to Azure OpenAI (processed and stored).
- Assign the workspace to a paid capacity, F2 or higher. Operations agents do not run on trial capacities.
- Switch the SQL analytics endpoint of `lh_hub` to User's identity access mode before anything else is built on it (Security tab, View data access mode). Without it, OneLake security roles are not enforced through the endpoint; switching later removes SQL roles and inline functions and interrupts every SQL endpoint in the workspace.

## Documentation to fetch first

- [Fabric CI/CD with fabric-cicd and the Fabric CLI](https://learn.microsoft.com/fabric/cicd/tutorial-fabric-cicd-local)
- [Fabric CI/CD concepts and best practices](https://learn.microsoft.com/fabric/fundamentals/understand-best-practices-fabric-cicd)
- [Real-Time Intelligence: Git integration and deployment pipelines](https://learn.microsoft.com/fabric/real-time-intelligence/git-deployment-pipelines)
- [Fabric region availability](https://learn.microsoft.com/fabric/admin/region-availability)
- [SQL database definition](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/sql-database-definition)
- [Developer tenant settings](https://learn.microsoft.com/fabric/admin/service-admin-portal-developer)
- [Ontology tenant settings](https://learn.microsoft.com/fabric/iq/ontology/overview-tenant-settings)
- [Data agent tenant settings](https://learn.microsoft.com/fabric/data-science/data-agent-tenant-settings)
- [OneLake security for SQL analytics endpoints](https://learn.microsoft.com/fabric/onelake/security/sql-analytics-endpoint-onelake-security)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
