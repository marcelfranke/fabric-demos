# Verify list

These are the points where the documentation is in preview, silent or contradictory, and the design
limits to say out loud. Phase 0 copies them here from section 7 of `BUILD_SCRIPT.md`; each phase
closes the ones it touches.

Status: **Documented** = the documentation says so, plan around it. **Not found** = the
documentation does not say; test it. **Conflict** = two pages disagree. **Design** = a limit of this
demo's design.

The **Outcome** column is empty until a phase checks the point. When a phase closes an entry it
writes what it saw and which phase saw it.

## Platform and region

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V1 | Qatar Central is a Power BI only region for Fabric. | Documented | Region availability page | Use a region with all Fabric workloads and say so in the demo | Open |
| V2 | Operations agent: Teams messages are processed through an EU endpoint; cross-geo settings are needed outside the US and EU; no trial capacities. One page excludes East US only, another also South Central US. | Documented, Conflict on regions | Both pages for your region | Run A alerts with an Activator rule and a Teams message instead | Open |
| V3 | Ontology is in preview with no published date for general availability. Audit events for ontology queries are not listed; only ontology agent conversations are. | Documented, Not found | Search the audit log after a run | Name it as a gap when you show the proof step | Open |

## Fabric build

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V4 | SQL database: the definition exists (dacpac, sqlproj). Support in fabric-cicd is not stated on Microsoft Learn. | Not found | Deploy once in phase 4 | Create the item with the REST API and apply a schema script | Open |
| V5 | Activator: the item API lists no service principal support; passing parameters to a pipeline is preview. | Documented | Deploy with a user identity | Create the rule in the portal | Open |
| V6 | Ontology from a TMDL definition, including a time series binding to the eventhouse. | Documented in principle | Read-back in phase 6 | Bind to the lakehouse copy, or build in the portal and export the definition | Open |
| V7 | The functions read the lakehouse through the SQL analytics endpoint. How fast a new event is visible there, and which identity that connection uses once the endpoint runs in user's identity mode, is not documented. | Not found | Time it in phase 7; repeat after the mode switch | Read the latest arrival time from the eventhouse, or pass it in from the pipeline | Open |
| V8 | Calling the functions with an application identity. The documentation shows a signed-in user with a delegated permission and mentions a client credential; a managed identity is not shown. Public access has to be on per function. | Not found for managed identity | `scripts/call_udf.py --as app` in phase 7 | Host the same rules module as an Azure Function with managed identity for the planner and the approval workflow; Azure Functions is on the list of tools the guardrail scans. Keep the Fabric function for pipelines | Open |
| V9 | Data agent: at most five sources; ontology as a source is preview and not named in the SDK documentation; managed identities are not supported; service principal calls are not supported with a KQL source. | Documented | Phase 8 | Add the ontology in the portal; keep the KQL database out of this agent | Open |
| V10 | Operations agent: it acts with the identity of the person who created it. Whether it can present several options, and whether playbook and autonomy can be set from the definition, is not documented. | Documented, Not found | Phase 8 | Run A shows one recommendation; options are the point of Run B | Open |
| V11 | Run A approval record. The operations agent's approval happens in its own Teams message, and the pipeline does not learn who approved. Stage 1 is recorded with the configured recipient. | Design | None | Say it in Run A: this is why Run B has its own approval workflow | Open |

## Foundry

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V12 | Fabric IQ tool: the ontology endpoint accepts a signed-in user only. The unattended run therefore gets its data from the function tools. | Documented | None | Already designed in | Open |
| V13 | Guardrails: agent guardrails are preview. Tool responses are scanned for OpenAPI, Azure Functions, Fabric data agent and some other tools, not for MCP tools. Assigning a guardrail in code is documented for hosted agents only. | Documented, Not found for prompt agents | Test S2 | The rules still cap the hold and dispatch still needs approval; show those two defences | Open |
| V14 | AI gateway: limits are set per model deployment at project scope in the Foundry portal. Governance of MCP tools covers only new MCP tools created in the portal without managed OAuth. | Documented, Conflict on status | Test S3 | Set the token limit on the model deployment itself and show the gateway as a slide | Open |
| V15 | Red teaming: cloud runs in East US 2, France Central, Sweden Central, Switzerland West and North Central US. Indirect prompt injection is an attack strategy ("indirect jailbreak"), not a risk category. | Documented | Region of the project | Move the project, or run the local version, which is preview | Open |
| V16 | A Fabric pipeline calling a Foundry agent directly. | Not found | Phase 9 | A small Azure Function between the two | Open |
| V17 | A published agent gets its own identity and its roles have to be assigned again. Published agents have no streaming and no citations in Teams and Microsoft 365 Copilot. | Documented | After publishing | Demo the conversation in the Foundry playground | Open |
| V18 | Model names, versions, prices and regional availability change. They are parameters; nothing is hard-coded. | Design | Before each demo | None needed | Phase 0: the model deployment and both prices are keys in `config/env.example.yaml` (`foundry.model_deployment`, `foundry.price_in_per_million`, `foundry.price_out_per_million`), not constants in code. Stays open as a per-demo check. |

## Copilot

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V19 | Data agent in Microsoft 365 Copilot is preview and portal-only. The Microsoft 365 orchestrator may rephrase the answer, and responses may leave Fabric's compliance or geographic boundary. | Documented | Rehearse the gate agent questions in Copilot itself | Show the data agent in Fabric | Open |
| V20 | A Copilot Studio agent with a Fabric data agent inside Microsoft 365 Copilot: one article says it is not supported, another describes it. | Conflict | Test in Teams first | Leave it out; it is optional | Open |

## Security

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V21 | OneLake security through the data agent. The data agent "honors all user permissions" including row and column level; it queries the lakehouse through the SQL analytics endpoint, which enforces OneLake roles only in user's identity mode. Workspace Admin, Member and Contributor are not restricted. | Documented in parts, not as one statement | Test S1 with two users | Column permissions in SQL in delegated mode | Open |
| V22 | Purview: audit of data agent interactions is preview and needs three settings. Labels are set through an admin API that only a user who is Fabric administrator can call. For Copilot in Fabric, labels and data loss prevention do not act on the interaction itself. | Documented | Find the run in the audit log | Show the trace and the run record | Open |
| V23 | Defender: threat protection for AI services is generally available for model deployments; coverage of Foundry agents is preview and applies to published agents. Which alert S2 raises, and how fast, is not documented. | Documented, Not found | Rehearse S2 and record what appears where | Show the guardrail annotation in the trace | Open |
| V24 | Sentinel: the Logs Ingestion API is the documented way to send custom rows; scheduled rules query tables in the workspace on the analytics plan. The mechanism that forwards `security_events` is Copilot's to choose and name. | Documented | Test S4 | Show the row in `security_events` and the refusal | Open |
| V25 | Agent 365: published Foundry agents appear in the registry. Blocking one in the Microsoft 365 admin center affects its availability in Microsoft 365 Copilot Chat only. | Documented, Conflict on status | After publishing | Disable the agent identity in Microsoft Entra | Open |

## Approval

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V26 | Teams connector: user connection only, no managed identity. The Power Automate article says the user ID of the person who submitted the card is available; the connector reference does not list the fields. | Documented in part | Phase 10 | Stop and decide. Do not record an assumed approver in Run B | Open |
| V27 | Multistage approvals in Copilot Studio agent flows are preview. | Documented | None | It is the alternative, not the default | Open |

## Rules engine

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V34 | The sentences `explain`, `plan_text` and `member_text` produce, and the text of each action, are not pinned anywhere. `demo-spec.md` section 5 shows one headline sentence and section 3.1 names the recipients and what each action is about, but no wording is prescribed and the scenario file asserts only `action_count`. | Design | Read the three sentences and the eleven action texts out loud before a demo | Change the wording in `src/hubdemo/rules.py`; no number or count moves with it | Phase 2: the wording was written to match section 5 and section 3.1 as closely as the data allows, and the proposed plan's sentence reads back the same numbers section 5 quotes. Tests assert the numbers inside each sentence, not the prose, so the wording can be changed without breaking the contract. |
| V35 | `cargo_protected` when no shipment is affected. The scenario file asserts `cargo_protected` only for plans that do carry a shipment, so the value for a plan with none is this demo's choice. | Design | `evaluate_plan` on a set of choices where no flight carries a shipment | Return `false` instead, and say so in the plan sentence | Phase 2: it is vacuously `true` — "every shipment that is affected makes it" is true when none is affected. The plan sentence says "no shipment is affected" in that case, so the demo never claims a shipment was protected that did not exist. Covered by a test. |
| V36 | `bags_protected` counts the bags of a connection that is kept **and** whose window reaches `bag_priority_min`. In this scenario the two always coincide, so the fixtures cannot tell the two readings apart. | Design | Lower `bag_priority_min` below a kept connection's window and re-run `evaluate_plan` | Count every kept connection's bags instead | Phase 2: the stricter reading is implemented, because section 3 states the bag test separately from the passenger test. A test raises `bag_priority_min` on a copy of the scenario and shows the bag count fall while the passenger count stays, which proves the two are not the same test. |
| V37 | Each cargo shipment carries its own `min_transfer_min`, and all three equal `rules.cargo_min`. Section 3 of `demo-spec.md` tests cargo against `rules.cargo_min` only, so the per-shipment field is unused. | Conflict | Compare `cargo_shipments[].min_transfer_min` with `rules.cargo_min` in the scenario file | Read the per-shipment value instead, which changes nothing while the three agree | Phase 2: the engine follows section 3 and uses `rules.cargo_min`. The per-shipment field is left in the scenario file as the place to put a shipment that needs longer. If a future scenario sets the two apart, this entry is the decision to revisit. |
| V38 | `Platinum` is written into `src/hubdemo/rules.py` as the name of the top tier, because `expected.proposed_plan` asserts a field called `platinum_rebooked`. It is a tier name, not a number, but it is still a value from the scenario file sitting in code. | Design | Rename a tier in `scenario/qr004.yaml` and run `pytest -q` | Derive the top tier from the order of `tiers` in the scenario file | Phase 2: kept as a single named constant `TOP_TIER` at the top of the module, so there is one place to change. Rule 5 is about numbers; no threshold or count is written in the module. |

## Tooling

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V28 | Prompt files are in public preview according to GitHub. The VS Code page says they are deprecated for Agent Host sessions and not loaded there. | Conflict | Type `/` in the chat and look for the prompt names | Use "Read and carry out `.github/prompts/...`" | Phase 0: confirmed. This phase ran from an agent session where prompt files are not loaded. The fallback worked: the prompt file was read from disk and carried out directly. Use the fallback for every phase. |
| V31 | The Microsoft Learn MCP tool (`microsoft_docs_search`) returned an empty result set for every query tried in this build environment, including queries whose pages do exist. | Not found | Run one `microsoft_docs_search` query whose page you know exists | Confirm the page with a direct fetch of its `learn.microsoft.com` URL instead, and record the confirmed URL next to the call | Phase 0: hit. `az account show` and the Fabric CLI both returned `{"results":[]}`. Both pages were then confirmed by direct fetch and the URLs are in `scripts/check_prereqs.py`. Rule 2 is satisfied by the fetched URL. Phase 1: still empty, but the phase names no platform API, so nothing had to be looked up. The direct fetch stays the standing workaround. Phase 2: same again — the rules engine is pure Python over the models, so no platform API was called and nothing had to be looked up. |
| V32 | `.github/workflows/ci.yml` only runs when this kit is the root of its own repository. GitHub reads workflows from the repository root `.github/workflows/` only, so the file does nothing while the kit sits in a subfolder of another repository. | Documented | Push and look for a run in the Actions tab | Run `ruff check .` and `pytest -q` locally, which is what the definition of done requires anyway | Phase 0: the kit is currently a subfolder, so CI does not run. Manual step 1 (own private repository) closes this. Local checks are the gate until then. |
| V33 | On Python 3.11 a `X \| None` annotation is a `types.UnionType`, and `typing.get_origin` returns `types.UnionType` for it, not `typing.Union`. Code that only tests `origin is Union` falls through and prints the raw annotation. | Not found | Run `hubdemo docs` and read every type cell in `docs/data-dictionary.md` | Test for `types.UnionType` next to `typing.Union` | Phase 1: hit and fixed. The first generated data dictionary printed optional columns as `str \| None`, and the bare pipe split the markdown table row. `render_type` in `src/hubdemo/models.py` now checks both. Every type cell was read back after the fix: 7 optional columns read "may be empty" and no cell contains a bare pipe. |

## Customer content

| # | Point | Status | Check | If it fails | Outcome |
| --- | --- | --- | --- | --- | --- |
| V29 | Privilege Club: meet and assist has conditions. Priority baggage and fast track are not on the public tier page, so the demo does not claim them. Tier does not change the proposal; whether it should is the airline's decision. | From the public tier page, 5 October 2026 | Ask the customer | Remove the service action | Open |
| V30 | Where Privilege Club and operational data live today, and whether the customer conversation needs the BigQuery pattern. Mirroring keeps a copy in OneLake; a Google Cloud Storage shortcut reads files in place and does not cover BigQuery tables. | Documented for the two patterns; customer facts not sourced | Account team | Skip phase 15 | Open |
