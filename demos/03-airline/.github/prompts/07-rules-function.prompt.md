---
description: "Phase 7: Rules as a Fabric function"
---
# Phase 7: Rules as a Fabric function

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The rules engine runs inside Fabric as a governed function that agents and workflows call, and it is the only thing that can dispatch actions.

## Task

Publish the rules as a Fabric user data functions item. Fetch the programming model, the item definition, the data source connections and the invocation articles first.

1. `fabric/build_udf.py`: copies `src/hubdemo/rules.py` and the models it needs into `fabric/workspace/udf_hub_rules.UserDataFunction/`, so there is one source for the rules.
2. `function_app.py` with these functions:
   - `get_connection_context(inbound_flight_id)`: per onward flight the window, passenger, bag and member counts by tier, cargo, and for at-risk connections the passenger remarks. No names, no passport numbers, no phone numbers.
   - `evaluate_options(inbound_flight_id)`: for each at-risk connection the result of every option, the proposal and its explanation.
   - `propose_plan(inbound_flight_id, proposed_by, policy_name, choices=None, trace_id=None)`: evaluates the plan (the proposal when no choices are given), stores it in `plans` with status `proposed`, and returns the plan ID, outcome, summary sentences, required approval stages and a preview of the actions. A new plan for the same flight marks older open plans as `superseded`.
   - `record_decision(plan_id, stage, approver, decision, comment)`: stores the decision in `approvals` and updates the plan status.
   - `dispatch_actions(plan_id)`: checks that every stage required for the plan has an approval. If not, it writes a row to `security_events`, changes nothing else and returns an error. If yes, it writes the actions and sets the plan to `dispatched`. Calling it twice dispatches once.
   - `get_run_record(plan_id)`: the plan with its approvals, actions and trace ID.
3. Connections: the lakehouse for reading, through `FabricLakehouseClient.connectToSql()` (the SQL analytics endpoint, read-only), and the SQL database for the operational tables, through `FabricSqlConnection`. The item definition carries connections under `connectedDataSources`; if a connection still has to be added in the portal, document the clicks.
4. `scripts/call_udf.py --as user|app`: calls a function over its public URL with a Microsoft Entra token. The documentation shows a signed-in user with the delegated permission `UserDataFunction.Execute.All` and mentions a client credential for service-to-service calls; it does not show a managed identity. Test both modes. If the call with the application identity is refused, stop and record it in `docs/verify-list.md`: phases 9 and 10 depend on it.
5. An OpenAPI description at `foundry/tools/hub_rules.openapi.json` that exposes only `get_connection_context`, `evaluate_options`, `propose_plan` and `get_run_record`. Export it from the portal if it cannot be generated, and then remove the other two functions from the file.
6. Tests: unit tests of each function body with fake connections. Live tests: `propose_plan` returns the numbers in `expected.proposed_plan`; `dispatch_actions` on an unapproved plan refuses and leaves a `security_events` row.

## Done when

- Unit tests pass. Live tests pass.
- The OpenAPI file contains no operation that records a decision or dispatches actions.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Publish the functions item after review.
- Turn on Public access for every function that is called from outside Fabric (Run only mode, function properties) and copy the public URLs into the configuration.
- Register the Microsoft Entra application used to call the functions and grant it `UserDataFunction.Execute.All` on the Power BI Service API.
- Add the data connections in the portal if the definition could not carry them.
- Export the OpenAPI specification (Generate invocation code, OpenAPI specification) if needed.

## Documentation to fetch first

- [Fabric user data functions overview](https://learn.microsoft.com/fabric/data-engineering/user-data-functions/user-data-functions-overview)
- [Programming model](https://learn.microsoft.com/fabric/data-engineering/user-data-functions/python-programming-model)
- [User data function item definition](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/user-data-function-definition)
- [Invoke from an external application](https://learn.microsoft.com/fabric/data-engineering/user-data-functions/tutorial-invoke-from-python-app)
- [Generate invocation code and OpenAPI](https://learn.microsoft.com/fabric/data-engineering/user-data-functions/generate-invocation-code)
- [FabricLakehouseClient class](https://learn.microsoft.com/python/api/fabric-user-data-functions/fabric.functions.fabriclakehouseclient)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
