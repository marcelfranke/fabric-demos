# Manual steps

Everything a person has to do by hand, because a script cannot do it or should not.

Rule 2 of `.github/copilot-instructions.md` also sends gaps here: if a platform call is not
documented on Microsoft Learn, the phase stops and records the gap in this file instead of guessing
an API.

| Step | Where | Why not automated | Documentation link | How to check |
| --- | --- | --- | --- | --- |
| Create the private GitHub repository for this kit and copy the kit into it | github.com | Creating a repository is an account action with its own owner, visibility and policy decisions. It is done once, before any phase runs. | https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository | The repository exists, is private, and `.github/workflows/ci.yml` sits at the repository root |
| Copy `config/env.example.yaml` to `config/env.demo.yaml` and fill in all 21 keys | Build machine | The file holds tenant, subscription, workspace, people and pricing values that belong to the person running the demo. `.gitignore` keeps the filled-in copy out of git on purpose. | `config/README.md` in this kit | `python scripts/check_prereqs.py --env demo` reports no missing keys and exits 0 |
| Run `az login` before any phase that touches Azure (phase 4 and later) | Build machine | Interactive sign-in. Rule 6: no secrets in the repository, credentials come from `DefaultAzureCredential` after `az login`. | https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli | `az account show` returns the expected tenant and subscription |
| Install the Fabric CLI (`pip install ms-fabric-cli`) on the build machine | Build machine | A build-machine prerequisite, not something a phase script should install into someone's environment. Not needed until phase 4. | https://learn.microsoft.com/en-us/rest/api/fabric/articles/fabric-command-line-interface | `fab --version` prints a version, and `python scripts/check_prereqs.py --env demo` shows the Fabric CLI as present |
| Buy or assign a Fabric capacity in a region that carries every workload | Azure portal or the Fabric admin portal | Buying capacity spends money and picks a data residency, so it is a decision for the person paying, not for a script. The region matters: Qatar Central carries Power BI only, so the demo cannot run there. UAE North carries every workload and is the closest full-workload region to the storyline. Avoid East US, South Central US, North Europe and West Europe, which have workloads listed as unavailable. | https://learn.microsoft.com/fabric/admin/region-availability | The capacity shows state `Active` in the Fabric admin portal, and `python scripts/fabric_bootstrap.py --env demo --dry-run` names it under `fabric.capacity_name` |
| Turn on the tenant settings the later phases need, each one scoped to a security group | OneLake catalog > Govern > Configurations > Tenant settings | Tenant settings are a tenant administrator action with a security group behind each one. A build script must not widen a tenant's surface. Allow up to one hour for a change to take effect. Needed: "Service principals can call Fabric public APIs", "Service principals can create workspaces, connections, and deployment pipelines" (disabled by default), "Users can create Fabric items", "Users can create ontology (preview) items", "Users can use Copilot and other features powered by Azure OpenAI", "Capacities can be designated as Fabric Copilot capacities", and the two cross-geo Azure OpenAI settings, which UAE North needs because the model is served from another geography. | https://learn.microsoft.com/fabric/admin/service-admin-portal-developer | Each setting reads Enabled in the tenant settings page and names the security group the builder is in |
| Create the workspace on a paid F2 or larger capacity, make the builder a workspace Admin, then paste the real lakehouse and workspace identifiers into `fabric/workspace/parameter.yml` | Fabric portal | `scripts/fabric_bootstrap.py` can create the workspace once a capacity and a signed-in identity exist, but assigning a paid capacity and granting Admin are ownership decisions. fabric-cicd also needs Admin on the workspace to publish. The notebook in `fabric/workspace/nb_load_reference.Notebook` carries placeholder identifiers that only become real after the lakehouse exists. | https://learn.microsoft.com/fabric/cicd/tutorial-fabric-cicd-local | `python scripts/fabric_bootstrap.py --env demo` finds the workspace instead of creating it, and the two `find_value` entries in `fabric/workspace/parameter.yml` have real identifiers under the `demo` key |
| Optional for phase 4. Switch the SQL analytics endpoint of `lh_hub` to User's identity access mode | Fabric portal, SQL analytics endpoint of `lh_hub` > Security > View data access mode > Data access mode settings | The switch is not exposed as a documented API call, and it is disruptive: it makes the SQL analytics endpoints temporarily unavailable across the entire workspace and cancels every running and queued query at every endpoint in that workspace. The endpoint only exists once `lh_hub` exists, so this cannot literally come before the lakehouse is built; do it straight after the first deploy, while the workspace is still quiet. Phase 4 was completed without it: the live row-count suite passed in the default access mode, because the builder is the workspace Admin. The switch belongs to the security phase, where reads have to be governed by OneLake roles rather than by the endpoint owner's identity. After the switch, OneLake security roles govern reads, SQL GRANT and REVOKE are ignored, and writes through the endpoint are not supported. | https://learn.microsoft.com/fabric/onelake/security/sql-analytics-endpoint-onelake-security | The endpoint's Security page shows User's identity access mode, and a `SELECT` against a lakehouse table returns rows for the builder |
| Install ODBC Driver 18 for SQL Server, then put the SQL connection string of `lh_hub` into the `HUBDEMO_SQL_ENDPOINT` environment variable | Build machine | A driver install is a machine-level action outside the project environment and needs an administrator prompt, so a phase script must not do it. On Windows: `winget install --id Microsoft.msodbcsql.18 --accept-package-agreements --accept-source-agreements`. Then `pip install pyodbc` into the project environment; `pyodbc` is deliberately not a project dependency, because the offline suite must not need a database driver. The server name is created by Fabric, so it cannot be known before the workspace exists: read it from `sqlEndpointProperties.connectionString` on `GET /v1/workspaces/{workspaceId}/lakehouses/{lakehouseId}`. Only ODBC 18 or higher is supported. The connection uses TCP 1433, which a network may have to allow as MSSQL or TDS rather than HTTPS. No password or secret is involved: the suite takes an access token from the `az login` session and passes it through the `SQL_COPT_SS_ACCESS_TOKEN` connection attribute, so a valid `az login` is the whole credential story and no browser prompt appears. | https://learn.microsoft.com/fabric/data-warehouse/how-to-connect | `python -c "import pyodbc; print(pyodbc.drivers())"` lists `ODBC Driver 18 for SQL Server`, and `HUBDEMO_LIVE=1 python -m pytest tests/live -q` runs instead of skipping |
| Resume the Fabric capacity before any run that touches the tenant, and pause it again afterwards | Azure portal, or `az resource invoke-action --action resume --ids <capacity resource id>` | A Fabric capacity pauses, either by hand or on a schedule, and every Fabric API call then fails with `CapacityNotActive`. Resuming starts billing again, so it is a spending decision for the person paying and a script must not make it. Nothing in the repository needs changing when this error appears; it is a state problem, not a code problem. | https://learn.microsoft.com/fabric/enterprise/pause-resume | `GET /v1/capacities` reports `state: Active` for the capacity named under `fabric.capacity_name`, which `python scripts/fabric_bootstrap.py --env demo --dry-run` prints |
| Run `python scripts/eventstream_endpoint.py --env demo` and paste the two values it prints into `eventstream.namespace` and `eventstream.event_hub` | Build machine, after the eventstream is published | The address is created by Fabric when the eventstream is published, so it cannot be known before the first deploy. Reading it is scripted: the Get Eventstream Topology and Get Eventstream Source Connection REST operations return the Event hub namespace and the Event hub name, so this is no longer the portal click phase 5 first assumed it was (V69). Writing the values is still manual, because `config/env.demo.yaml` is the person's own file and stays out of git. The script never prints or stores the shared access keys that come back in the same response. The identity running it needs Contributor or higher on the workspace, and the person granting that needs Member or higher. | https://learn.microsoft.com/en-us/rest/api/fabric/eventstream/topology/get-eventstream-source-connection | `python scripts/check_prereqs.py --env demo` reports no missing keys, and `python scripts/replay_events.py --env demo --dry-run` prints the real namespace instead of `<eventstream.namespace>` |
| Create the `act_connections_at_risk` Activator rule on the eventstream and start it | Fabric portal, `es_flight_events` eventstream > Set alert, or Real-Time hub > Set alert | The Reflex item behind Activator is deployable through the REST API, and the entity catalogue in its definition is documented, but the `ActStep` grammar for a `FabricItemInvocation` action is not: Learn shows a worked example for `TeamsMessage` only, and nothing documents how a rule value is passed into a pipeline parameter. Rule 2 forbids inventing that shape, so phase 5 stops here and the rule is built by hand. The clicks: open `es_flight_events`, choose Set alert, name the rule `act_connections_at_risk`, set the condition on the `at_risk` column of the `ConnectionWindows` result becoming true, choose "Run a Fabric item" as the action, pick the `pl_on_delay` pipeline, pass the inbound flight id into the pipeline's `inbound_flight_id` parameter, save, then press Start. A rule does nothing until it is started. | https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-get-data-eventstreams | The rule appears in the workspace as `act_connections_at_risk` with state Started, and a replay of the trigger event produces a run of `pl_on_delay` in the pipeline's run history |

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

No gap from phase 4 after the live run. Both points that phase 4 recorded as gaps while no tenant
existed are now closed against a real workspace. The ingestion mapping in
`fabric/workspace/hubdb.KQLDatabase/DatabaseSchema.kql`, written as adjacent quoted fragments
because Learn does not show how to escape a JSON document inside a KQL string, published without
complaint: the Kusto parser does join adjacent fragments, so the guess was right (V52). The live
test no longer signs in with `ActiveDirectoryInteractive`, which failed in this tenant twice over,
once because the driver's embedded browser is too old for the current Entra sign-in page and once
because the tenant demands multi-factor registration first (V64); `ActiveDirectoryIntegrated` also
failed, because the builder account is cloud-only rather than federated (V65). Paging the Learn
article on Microsoft Entra authentication with the ODBC driver to the end produced the byte layout
that rule 2 was waiting for, so the access token route is now written from documentation rather than
guesswork and the suite passes (V66). Two small pieces of that call are still not on Learn and are
recorded as such next to the code: the numeric value of `SQL_COPT_SS_ACCESS_TOKEN` comes from the
`msodbcsql.h` header that ships with the driver, and the token audience for a
`datawarehouse.fabric.microsoft.com` server comes from Microsoft's own `fabric-toolbox` sample,
which is a Microsoft repository rather than a Learn page.

Three things that went wrong during the phase 4 live run were environmental, changed no code, and
are worth knowing before the next live run. The Azure CLI token refresh returned HTTP 502 once; the
same failure reproduced in a bare `az account get-access-token`, so it sits outside this repository,
and waiting about twenty seconds and retrying cleared it (V60). The capacity paused itself part way
through, which turns every Fabric call into `CapacityNotActive`; the new manual step above covers it
(V61). The SQL analytics endpoint briefly reported `Invalid object name 'dbo.flights'` for tables
that existed seconds later, which is metadata sync catching up rather than a missing table (V66).
One discovery also changed how the tables are checked: `lh_hub` is a schema-enabled lakehouse, so
the Fabric List Tables REST API refuses it with `UnsupportedOperationForSchemasEnabledLakehouse`,
and the tables are listed through OneLake under `Tables/dbo/` instead (V62). The notebook was run
through the documented Fabric job scheduler rather than by hand, by posting to
`/jobs/RunNotebook/instances` and polling the returned job instance until it reported `Completed`.

One open point from phase 4 needs a decision from the person paying for the capacity, and it is not
a gap in the documentation. The capacity available in this tenant sits in East US, which the
capacity step above tells the reader to avoid, and no capacity exists in a recommended region. Every
phase 4 workload published and ran there, so nothing is blocked today, but a later phase that needs
a workload East US does not carry will fail on region rather than on code (V59).

Phase 5 closed one gap and opened one. The closed gap is the empty reference tables in the
eventhouse: `hubdb` declared `flights` and `bookings`, but a KQL database definition can only carry
schema commands, not ingestion, and `nb_load_reference` writes to the lakehouse rather than to the
eventhouse, so both tables stayed at zero rows and `ConnectionWindows()` could return nothing.
`scripts/load_kql_reference.py` now fills them, plus the new `transfer_rules` table, from the
generated parquet files over the Kusto REST API. The command it uses, `.set-or-replace`, needs at
least Table Admin on the database; a workspace admin has that, a contributor may not, and if it
fails with a permission error the rows have to be pasted into a query tab by hand. The open gap is
Activator. The Reflex item is deployable and its entity catalogue is documented, but there is no
documented `ActStep` row for a `FabricItemInvocation` action and nothing describes how a rule value
reaches a pipeline parameter, so the item is not built from a definition file and the rule is
created in the portal instead, as the second new row in the table above describes.

Phase 5 also corrected one of its own assumptions and recorded one service behaviour that no Learn
page describes. The assumption was that the eventstream custom endpoint address is visible only in
the portal; it is not, and the Get Eventstream Topology and Get Eventstream Source Connection
operations return both values, so `scripts/eventstream_endpoint.py` reads them and the step above
is now a command rather than a click (V69). The service behaviour is the eventhouse destination.
Written the documented `DirectIngestion` way, the destination published and then sat at status
`Warning` and ingested nothing, because that mode is a Kusto pull and needs a connection object
that a definition-only deploy never creates; the giveaway was `resume` on the destination failing
with "not supported for the data source type 'KustoPullMode'". The push shape,
`dataIngestionMode: ProcessedIngestion` with `databaseName` and `inputSerialization` and no
connection, works, and its `itemId` is the KQL database item id rather than the eventhouse item id
(V79, V71). Neither fact appears on Learn; both came from Microsoft's own
`microsoft/fabric-event-streams` repository and from the error text the publish returned, which
rule 2 allows only with the note that is written next to the code and in `verify-list.md` (V80).

Points that are in preview, undocumented or contradictory but not yet blocking are tracked in
`verify-list.md`, not here. A point moves from there to here only when a phase stops on it.
