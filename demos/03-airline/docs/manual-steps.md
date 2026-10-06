# Manual steps

Everything a person has to do by hand, because a script cannot do it or should not.

Rule 2 of `.github/copilot-instructions.md` also sends gaps here: if a platform call is not
documented on Microsoft Learn, the phase stops and records the gap in this file instead of guessing
an API.

| Step | Where | Why not automated | Documentation link | How to check |
| --- | --- | --- | --- | --- |
| Create the private GitHub repository for this kit and copy the kit into it | github.com | Creating a repository is an account action with its own owner, visibility and policy decisions. It is done once, before any phase runs. | https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository | The repository exists, is private, and `.github/workflows/ci.yml` sits at the repository root |
| Copy `config/env.example.yaml` to `config/env.demo.yaml` and fill in all 19 keys | Build machine | The file holds tenant, subscription, workspace, people and pricing values that belong to the person running the demo. `.gitignore` keeps the filled-in copy out of git on purpose. | `config/README.md` in this kit | `python scripts/check_prereqs.py --env demo` reports no missing keys and exits 0 |
| Run `az login` before any phase that touches Azure (phase 4 and later) | Build machine | Interactive sign-in. Rule 6: no secrets in the repository, credentials come from `DefaultAzureCredential` after `az login`. | https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli | `az account show` returns the expected tenant and subscription |
| Install the Fabric CLI (`pip install ms-fabric-cli`) on the build machine | Build machine | A build-machine prerequisite, not something a phase script should install into someone's environment. Not needed until phase 4. | https://learn.microsoft.com/en-us/rest/api/fabric/articles/fabric-command-line-interface | `fab --version` prints a version, and `python scripts/check_prereqs.py --env demo` shows the Fabric CLI as present |
| Buy or assign a Fabric capacity in a region that carries every workload | Azure portal or the Fabric admin portal | Buying capacity spends money and picks a data residency, so it is a decision for the person paying, not for a script. The region matters: Qatar Central carries Power BI only, so the demo cannot run there. UAE North carries every workload and is the closest full-workload region to the storyline. Avoid East US, South Central US, North Europe and West Europe, which have workloads listed as unavailable. | https://learn.microsoft.com/fabric/admin/region-availability | The capacity shows state `Active` in the Fabric admin portal, and `python scripts/fabric_bootstrap.py --env demo --dry-run` names it under `fabric.capacity_name` |
| Turn on the tenant settings the later phases need, each one scoped to a security group | OneLake catalog > Govern > Configurations > Tenant settings | Tenant settings are a tenant administrator action with a security group behind each one. A build script must not widen a tenant's surface. Allow up to one hour for a change to take effect. Needed: "Service principals can call Fabric public APIs", "Service principals can create workspaces, connections, and deployment pipelines" (disabled by default), "Users can create Fabric items", "Users can create ontology (preview) items", "Users can use Copilot and other features powered by Azure OpenAI", "Capacities can be designated as Fabric Copilot capacities", and the two cross-geo Azure OpenAI settings, which UAE North needs because the model is served from another geography. | https://learn.microsoft.com/fabric/admin/service-admin-portal-developer | Each setting reads Enabled in the tenant settings page and names the security group the builder is in |
| Create the workspace on a paid F2 or larger capacity, make the builder a workspace Admin, then paste the real lakehouse and workspace identifiers into `fabric/workspace/parameter.yml` | Fabric portal | `scripts/fabric_bootstrap.py` can create the workspace once a capacity and a signed-in identity exist, but assigning a paid capacity and granting Admin are ownership decisions. fabric-cicd also needs Admin on the workspace to publish. The notebook in `fabric/workspace/nb_load_reference.Notebook` carries placeholder identifiers that only become real after the lakehouse exists. | https://learn.microsoft.com/fabric/cicd/tutorial-fabric-cicd-local | `python scripts/fabric_bootstrap.py --env demo` finds the workspace instead of creating it, and the two `find_value` entries in `fabric/workspace/parameter.yml` have real identifiers under the `demo` key |
| Switch the SQL analytics endpoint of `lh_hub` to User's identity access mode before anything else is built on the lakehouse | Fabric portal, SQL analytics endpoint of `lh_hub` > Security > View data access mode > Data access mode settings | The switch is not exposed as a documented API call, and it is disruptive: it makes the SQL analytics endpoints temporarily unavailable across the entire workspace and cancels every running and queued query at every endpoint in that workspace. Do it first, on an empty workspace, so nothing is interrupted. After the switch, OneLake security roles govern reads, SQL GRANT and REVOKE are ignored, and writes through the endpoint are not supported. | https://learn.microsoft.com/fabric/onelake/security/sql-analytics-endpoint-onelake-security | The endpoint's Security page shows User's identity access mode, and a `SELECT` against a lakehouse table returns rows for the builder |
| Install ODBC Driver 18 for SQL Server and `pip install pyodbc`, then put the SQL connection string of `lh_hub` into the `HUBDEMO_SQL_ENDPOINT` environment variable | Build machine | A driver install is a machine-level action outside the project environment, and the server name is created by Fabric, so it cannot be known before the workspace exists. Only ODBC 18 or higher is supported. The connection uses TCP 1433, which a network may have to allow as MSSQL or TDS rather than HTTPS. | https://learn.microsoft.com/fabric/data-warehouse/how-to-connect | `python -c "import pyodbc; print(pyodbc.drivers())"` lists `ODBC Driver 18 for SQL Server`, and `HUBDEMO_LIVE=1 python -m pytest tests/live -q` runs instead of skipping |

## Known gaps

No gap from phase 0. Phase 0 calls no Microsoft SDK or REST API. It shells out to `az account show`
and `fab --version` only, and both commands are documented; the confirmed documentation URLs sit in
comments next to the calls in `scripts/check_prereqs.py`.

No gap from phase 1. Phase 1 reads `scenario/qr004.yaml` and writes `docs/data-dictionary.md` on the
build machine. It calls no Microsoft SDK or REST API, needs no cloud resource and asks nothing new of
a person.

No gap from phase 2. Phase 2 works out the recovery rules in `src/hubdemo/rules.py` from the models
and the scenario file on the build machine. It calls no Microsoft SDK or REST API, needs no cloud
resource and asks nothing new of a person.

No gap from phase 3. Phase 3 generates the row-level tables and the event timeline on the build
machine. Parquet comes from pyarrow and the event file is JSON lines written with the standard
library, so there is no Microsoft SDK or REST API in the phase at all. The files land in the
gitignored `data/` folder; nothing has to exist in a cloud tenant yet, and a person is asked nothing
new. Phase 4 is the first phase that needs `az login` and a Fabric workspace.

Two gaps from phase 4, both recorded in `verify-list.md` and neither blocking yet, because no tenant
exists to check them against. First, the ingestion mapping in
`fabric/workspace/hubdb.KQLDatabase/DatabaseSchema.kql` is a JSON document inside a KQL string, and
Learn does not show how to escape one inside a database schema file. It is written as adjacent
quoted fragments, which is the shape the KQL documentation uses elsewhere, and it is the most likely
thing to fail on the first real deploy (V52). Second, the live test signs in to the SQL analytics
endpoint with `ActiveDirectoryInteractive`, which opens a browser prompt and works on Windows only.
The documented alternative is an access token passed through the `SQL_COPT_SS_ACCESS_TOKEN`
connection attribute, but the Learn page stops before the byte layout the attribute expects, so rule
2 does not allow writing that call from guesswork (V57). Everything else in phase 4 runs against
documented REST and OneLake endpoints with the confirmed URL in a comment next to each call.

Points that are in preview, undocumented or contradictory but not yet blocking are tracked in
`verify-list.md`, not here. A point moves from there to here only when a phase stops on it.
