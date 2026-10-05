---
description: "Phase 5: Real-time path"
---
# Phase 5: Real-time path

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** An event sent by the replay script arrives in the eventhouse within seconds, and a query returns the connections at risk.

## Task

Build the event path. Fetch the Eventstream definition, custom endpoint and CI/CD articles first.

1. `fabric/workspace/es_flight_events.Eventstream`: a custom endpoint source, with two destinations: the table `flight_events` in the KQL database and a table `flight_events` in the lakehouse (the Fabric function in phase 7 reads the lakehouse copy).
2. `scripts/replay_events.py --env <name> [--speed 60] [--until-trigger | --trigger-only | --all] [--dry-run]`: sends the events from `data/flight_events.jsonl` to the custom endpoint with the Event Hubs SDK. Authenticate with Microsoft Entra ID, which the custom endpoint supports next to SAS keys; do not use a connection string. Each event carries a unique ID.
3. KQL functions in the database schema script:
   - `LatestEta()`: the latest known arrival time per flight
   - `ConnectionWindows(inbound_flight_id: string)`: one row per onward flight with flight number, city, departure, `window_min` and `at_risk`, using the rule values from the `transfer_rules` table
   - a deduplication step so that replaying an event twice does not create two rows
4. A trigger for Run B: an Activator rule (`act_connections_at_risk`) that starts the pipeline `pl_on_delay` with the inbound flight ID when a new `eta_update` produces at-risk connections. Create `pl_on_delay.DataPipeline` with one placeholder step; later phases fill it. Activator rules can start a pipeline and pass values to its parameters (parameter passing is in preview). The item definition exists (`ReflexEntities.json`), but the item API does not list service principal support for it, so deploy it with a user identity or document the clicks in `docs/manual-steps.md`.
5. Optional: a Real-Time dashboard `rt_hub_board` with the arrivals list and the connection windows.
6. `tests/live/test_real_time.py`: send the trigger event, poll `ConnectionWindows` and assert the at-risk flights and windows from `expected`.

## Done when

- The live test passes.
- Sending the trigger event twice still returns three at-risk rows.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Give the identity that replays the events the Contributor role on the workspace; Entra ID authentication for the custom endpoint needs it.
- Create or start the Activator rule in the portal if it could not be deployed from the repository.

## Documentation to fetch first

- [Eventstream custom endpoint source](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-source-custom-app)
- [Eventstream CI/CD support](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/eventstream-cicd)
- [Send events with the Event Hubs SDK for Python](https://learn.microsoft.com/azure/event-hubs/event-hubs-python-get-started-send)
- [Entra ID authentication for the custom endpoint](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/custom-endpoint-entra-id-auth)
- [Activator: run Fabric items](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-trigger-fabric-items)
- [Activator (Reflex) definition](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/reflex-definition)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
