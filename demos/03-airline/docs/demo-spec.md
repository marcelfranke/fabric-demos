# Demo specification

This is the contract for the build. The scenario numbers live in `scenario/qr004.yaml`; this file says what they mean, how the rules work and what the audience sees.

Everything is synthetic. No real passenger, member, flight or operational data is used anywhere in this repository.

## 1. Storyline

One inbound flight from London runs 55 minutes late into Doha. The demo follows that one event through the platform.

| Step | What the audience sees | Platform part |
|---|---|---|
| 1. Signal | The delay arrives as an event at 23:10, hours before landing | Fabric Real-Time Intelligence |
| 2. Context | The flight linked to passengers, Privilege Club tier, onward flights, bags, gates and cargo | Fabric IQ ontology on OneLake |
| 3. Alert | Three connections at risk: 41 passengers, 19 members, 50 bags, 1 shipment | Fabric operations agent, or Activator |
| 4. Recommendation | Three options per connection with the rule behind each; the lightest working one is proposed | Rules as a Fabric function; planner agent in Foundry |
| 5. Decision | The hub duty manager approves; a second approver is added by policy | Teams, approval workflow |
| 6. Proof | Record of the run, outcome, cost | Purview, Application Insights, Sentinel, Fabric |
| 7. Frontline | Gate staff ask about the same situation in their own words | Fabric data agent in Microsoft 365 Copilot |

The demo runs twice on the same data:

- **Run A, "today" (Phase 1 of the enablement roadmap).** Microsoft-built agents only. The operations agent detects the condition and sends its recommendation to Teams. One approver. No custom agent.
- **Run B, "target" (Phase 3).** A planner agent built in Foundry prepares the plan with options and member impact, behind the gateway and the guardrails. Two-stage approval. The agent has no tool that changes operations: only the approval workflow can dispatch actions.

Security is shown inside Run B, as four short moments (section 6).

## 2. Data contract

### 2.1 Reference data (lakehouse `lh_hub`, Delta tables)

| Table | Key | Columns |
|---|---|---|
| `flights` | `flight_id` | `flight_no`, `direction` (inbound/outbound), `origin`, `destination`, `city`, `sched_time_local`, `gate_id`, `other_pax_onboard`, `is_synthetic` |
| `gates` | `gate_id` | `concourse` |
| `passengers` | `passenger_id` | `display_name` (synthetic), `member_id` (nullable), `remark_text`, `passport_no` (fake), `contact_phone` (fake), `is_synthetic` |
| `members` | `member_id` | `passenger_id`, `tier`, `lounge_access`, `priority_standby`, `meet_assist` |
| `bookings` | `booking_id` | `passenger_id`, `inbound_flight_id`, `onward_flight_id` (nullable for passengers ending in Doha) |
| `bags` | `bag_tag` | `passenger_id`, `inbound_flight_id`, `onward_flight_id` (nullable) |
| `cargo_shipments` | `shipment_id` | `inbound_flight_id`, `onward_flight_id`, `temperature_controlled`, `min_transfer_min` |
| `next_flights` | `onward_flight_id` | `next_flight_no`, `next_std_local` |
| `transfer_rules` | `rule_name` | `value`, `unit`, `description` |
| `tier_benefits` | `tier` | `lounge_access`, `priority_standby`, `meet_assist`, `source_note` |

Every row carries `is_synthetic = true` or sits in a table that only holds synthetic rows. `passport_no` and `contact_phone` use patterns that cannot be real (for example `X0000001`, `+000 0000 0001`).

### 2.2 Events (eventhouse `eh_hub`, KQL database `hubdb`)

| Table | Columns |
|---|---|
| `flight_events` | `event_time`, `flight_id`, `flight_no`, `event_type` (`departed`, `eta_update`, `landed`), `eta_local`, `delay_min`, `source`, `text` |

A KQL function `ConnectionWindows(inbound_flight_id)` joins the latest ETA to the onward departures and returns one row per onward flight with `window_min`.

### 2.3 Operational record (SQL database `sqldb_hub_ops`)

| Table | Purpose |
|---|---|
| `plans` | One row per proposed plan: who proposed it (rule engine, operations agent, planner agent), the options chosen, the computed outcome, status |
| `approvals` | One row per approval stage: plan, stage, approver, decision, time, comment |
| `actions` | One row per dispatched action: plan, recipient, text, time, status |
| `security_events` | One row per refused dispatch attempt: plan, caller, reason, time |

Plan status is one of `proposed`, `awaiting_approval`, `rejected`, `expired`, `dispatched`, `superseded`.

`dispatch_actions` refuses to write to `actions` unless every stage required by the approval policy has an `approved` row in `approvals` for that plan. This check is in the function, not in the agent.

## 3. Rules

All times in minutes. The parameters are in `scenario/qr004.yaml` under `rules`.

```
window        = onward departure - inbound new ETA (+ hold, if the option holds the flight)

Option "fast":   fast-track transfer, no hold
Option "hold":   hold the departure by max_hold_min, plus fast-track
Option "rebook": move the passengers to the next flight

For "fast" and "hold":
  spare   = window - pax_fasttrack_min
  result  = ok     if spare >= margin_min
            risky  if 0 <= spare < margin_min
            fails  if spare < 0
  bags make it     if window >= bag_priority_min
  cargo makes it   if window >= cargo_min        (only where a shipment is on that flight)

A connection is at risk   if window < pax_standard_min
Proposal for a connection = the first of [fast, hold] whose result is ok, otherwise rebook
```

Privilege Club tier never changes the proposal. It is reported next to each option and it adds service actions:

- Meet and assist is requested for Gold and Platinum members on connections that are kept (the benefit has conditions; the airline confirms when it applies).
- Lounge access goes to every rebooked passenger; for Silver and above it is already a tier benefit.

The rules are computed in code. No language model computes a time, a count or a result.

### 3.1 Actions per connection

The action list follows from the option chosen. The count is part of the test oracle.

| Option | Actions, in this order |
|---|---|
| `rebook` | Reservations: move the passengers to the next flight. Customer messages: new itinerary and lounge access, sent before landing. Baggage: reroute the bags. Cargo: re-plan the shipment (only where a shipment is on the flight). |
| `fast` | Ground handling: escort the passengers from the inbound gate to the departure gate. Baggage: tail-to-tail transfer. Member services: meet and assist for Gold and Platinum members (only where there are such members and the result is not `fails`). Cargo: shipment stays or is re-planned (only where a shipment is on the flight). |
| `hold` | Airport operations: hold the flight at its gate until the new time. Then the same actions as `fast`. |

## 4. Approval policy

| Stage | Approver | When |
|---|---|---|
| 1 | Hub duty manager | Always |
| 2 | Operations control manager | Total hold above `max_hold_min`, or a person chose an option the rules call risky or failing, or at least one Platinum member is rebooked |

No answer within the timeout means nothing is sent. A rejection at any stage ends the plan. In the proposed plan one Platinum member is rebooked, so both stages apply.

## 5. Expected results

The `expected` block in the scenario file is the test oracle. The headline numbers:

- 11 onward flights, 164 connecting passengers, 195 transfer bags, 63 connecting members, 3 cargo shipments.
- At risk: Muscat (20 min), Singapore (30), Sydney (35). 41 passengers, 50 bags, 19 members (3 Platinum, 3 Gold, 6 Silver, 7 Burgundy), 1 shipment.
- Proposal: rebook Muscat, hold Singapore 10 minutes and fast-track, fast-track Sydney.
- Outcome of the proposal: 36 passengers and 44 bags keep their connection, 5 passengers rebooked, 10 hold minutes, the shipment makes it. 16 members keep their connection, 3 are rebooked including 1 Platinum, 5 Gold and Platinum members get meet and assist. 11 actions.

## 6. Security moments

| # | Moment | Control shown | Pass condition |
|---|---|---|---|
| S1 | A gate agent and the duty manager ask for a passenger's phone number | OneLake security, column-level, with the SQL analytics endpoint in user's identity mode | The gate agent gets no value; the duty manager does |
| S2 | A passenger remark contains an instruction to the agent | Foundry guardrail, indirect attack at tool response | The run is blocked or annotated; no hold beyond the rules appears in any plan; the event is found afterwards in the trace. A Defender alert is recorded if one is raised, not assumed |
| S3 | A script sends requests above the token limit | AI gateway token limit | The gateway answers 429 or 403; the planner's normal run still works afterwards |
| S4 | A script calls `dispatch_actions` for a plan with no approval | Function-level check, Sentinel rule | The function refuses; the Sentinel rule raises an incident |

## 7. What is not in the demo

- Private networking. It is a slide, not a build step.
- Real optimisation. The rules are simple on purpose so that every result can be explained.
- Any real integration with airport, baggage, reservations or messaging systems. Actions are rows in `actions` and messages in a Teams channel.
