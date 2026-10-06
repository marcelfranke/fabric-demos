"""Typed models for the scenario file and for every table the demo writes.

Two groups live here.

The first group mirrors ``scenario/qr004.yaml`` field for field: the inbound
flight, the onward flights, the rules, the tiers, the cargo shipments, the
approval policies, the security fixtures and the expected results. The scenario
file is the single source of numbers (rule 5), so these models refuse unknown
keys: a typo in the file is an error, not a silently ignored value.

The second group is one row model per table and event in section 2 of
``docs/demo-spec.md``. Nothing writes rows yet. They exist so later phases have
one agreed shape per table, and so ``hubdemo docs`` can write
``docs/data-dictionary.md`` from them rather than from a hand-kept list.
"""

from __future__ import annotations

from datetime import datetime
from types import UnionType
from typing import Any, Literal, NamedTuple, Union, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field

# Statuses a plan can hold, from docs/demo-spec.md section 2.3.
PLAN_STATUSES = (
    "proposed",
    "awaiting_approval",
    "rejected",
    "expired",
    "dispatched",
    "superseded",
)

PlanStatus = Literal[
    "proposed",
    "awaiting_approval",
    "rejected",
    "expired",
    "dispatched",
    "superseded",
]

#: The three options the rules engine scores for an onward flight.
TransferOption = Literal["fast", "hold", "rebook"]

#: What scoring an option produces. ``rebook`` is the result of the rebook option.
OptionResult = Literal["ok", "risky", "fails", "rebook"]


class _Strict(BaseModel):
    """Base for the scenario models: unknown keys are a mistake, not a comment."""

    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------
# The scenario file
# --------------------------------------------------------------------------


class Rules(_Strict):
    """Transfer rules, in minutes. Placeholders: the airline sets its own."""

    pax_standard_min: int
    pax_fasttrack_min: int
    bag_standard_min: int
    bag_priority_min: int
    cargo_min: int
    margin_min: int
    max_hold_min: int


class TierBenefits(_Strict):
    """What one loyalty tier is entitled to."""

    lounge_access: bool
    priority_standby: bool
    meet_assist: bool


class InboundFlight(_Strict):
    """The late arrival the whole demo turns on."""

    id: str
    flight_no: str
    origin: str
    origin_city: str
    sched_arrival_local: datetime
    new_eta_local: datetime
    departure_delay_min: int
    arrival_delay_min: int
    gate: str
    pax_onboard: int
    pax_connecting: int


class NextFlight(_Strict):
    """The flight a rebooked passenger is moved to."""

    flight_no: str
    std_local: datetime


class OnwardFlight(_Strict):
    """A departure carrying passengers off the inbound flight.

    ``connecting_pax``, ``bags`` and ``members`` count only people and bags
    arriving on the inbound flight, not the whole load.
    """

    id: str
    flight_no: str
    dest: str
    city: str
    std_local: datetime
    gate: str
    other_pax_onboard: int
    connecting_pax: int
    bags: int
    members: dict[str, int]
    next_flight: NextFlight | None = None

    @property
    def member_count(self) -> int:
        """Members from the inbound flight booked on this departure."""
        return sum(self.members.values())


class CargoShipment(_Strict):
    """A shipment transferring from the inbound flight to an onward flight."""

    id: str
    onward: str
    temperature_controlled: bool
    min_transfer_min: int


class BackgroundArrival(_Strict):
    """Another arrival in the same bank, so the arrivals list is not one row."""

    flight_no: str
    origin_city: str
    sched_local: datetime
    eta_local: datetime
    gate: str


class TriggerEvent(_Strict):
    """The event that starts the demo."""

    event_time_local: datetime
    event_type: str
    flight_id: str
    text: str
    source: str


class ApprovalStage(_Strict):
    """One stage of an approval policy.

    ``always`` marks a stage that is required for every plan. ``when_any`` lists
    the conditions, any one of which pulls the stage in.
    """

    role: str
    always: bool | None = None
    when_any: list[dict[str, Any]] | None = None


class ApprovalPolicy(_Strict):
    """Who has to approve a plan before anything is sent."""

    stage_1: ApprovalStage
    stage_2: ApprovalStage | None = None
    timeout_min: int


class PoisonedRemark(_Strict):
    """A passenger remark carrying an instruction aimed at the agent."""

    on_onward: str
    text: str


class SecurityFixtures(_Strict):
    """Fixtures for the security tests. Synthetic and harmless outside the demo."""

    poisoned_remark: PoisonedRemark
    pii_columns: list[str]


class ExpectedTotals(_Strict):
    """The headline counts every run has to reproduce."""

    onward_flights: int
    connecting_pax: int
    transfer_bags: int
    connecting_members: int
    cargo_shipments: int


class AtRiskTotals(_Strict):
    """What sits on the onward flights whose window is below the standard."""

    pax: int
    bags: int
    members: int
    members_by_tier: dict[str, int]
    cargo_shipments: int


class OptionResults(_Strict):
    """How the three options score for one onward flight."""

    fast: OptionResult
    hold: OptionResult
    rebook: OptionResult


class PlanOutcome(_Strict):
    """The computed effect of a plan, whether proposed or chosen by a person."""

    pax_protected: int
    bags_protected: int
    pax_rebooked: int
    pax_exposed: int
    hold_min_total: int
    cargo_protected: bool
    members_keep_connection: int
    members_rebooked: int
    platinum_rebooked: int
    meet_assist_members: int
    approval_stages: list[str]
    action_count: int


class OverrideCase(_Strict):
    """A plan a person might choose instead of the proposal."""

    name: str
    choices: dict[str, TransferOption]
    outcome: PlanOutcome


class Expected(_Strict):
    """Everything the tests assert. No number is computed anywhere else."""

    totals: ExpectedTotals
    windows_min: dict[str, int]
    at_risk: list[str]
    at_risk_totals: AtRiskTotals
    proposal: dict[str, TransferOption]
    option_results: dict[str, OptionResults]
    proposed_plan: PlanOutcome
    override_cases: list[OverrideCase]


class Scenario(_Strict):
    """The whole of ``scenario/qr004.yaml``."""

    scenario_id: str
    airline_code: str
    hub: str
    timezone: str
    loyalty_programme: str
    sim_now_local: datetime
    inbound: InboundFlight
    rules: Rules
    tiers: dict[str, TierBenefits]
    onward_flights: list[OnwardFlight]
    cargo_shipments: list[CargoShipment]
    background_arrivals: list[BackgroundArrival]
    trigger_event: TriggerEvent
    approval_policy: ApprovalPolicy
    approval_policy_single: ApprovalPolicy
    security_fixtures: SecurityFixtures
    expected: Expected

    def onward(self, onward_id: str) -> OnwardFlight:
        """Return one onward flight by id, naming the known ids when it is absent."""
        for flight in self.onward_flights:
            if flight.id == onward_id:
                return flight
        known = ", ".join(f.id for f in self.onward_flights)
        raise KeyError(f"No onward flight with id {onward_id!r}. Known ids: {known}.")


# --------------------------------------------------------------------------
# Row models, one per table and event in docs/demo-spec.md section 2
# --------------------------------------------------------------------------


class FlightRow(BaseModel):
    """One arrival or departure in the bank."""

    flight_id: str = Field(description="Key. Short id used across the kit, for example QR004.")
    flight_no: str = Field(description="Flight number as a passenger sees it, for example QR 004.")
    direction: Literal["inbound", "outbound"] = Field(description="Arriving or departing.")
    origin: str = Field(description="Airport code the flight comes from.")
    destination: str = Field(description="Airport code the flight goes to.")
    city: str = Field(description="City shown on the board for the far end of the flight.")
    sched_time_local: datetime = Field(
        description="Scheduled arrival or departure, hub local time."
    )
    gate_id: str = Field(description="Gate, joins to gates.gate_id.")
    other_pax_onboard: int = Field(
        description="Passengers on the flight who are not transferring from the inbound flight."
    )
    is_synthetic: bool = Field(description="Always true. Every row in this kit is invented.")


class GateRow(BaseModel):
    """One gate and the concourse it sits on."""

    gate_id: str = Field(description="Key. Gate name, for example C31.")
    concourse: str = Field(description="Concourse letter, used to judge walking distance.")


class PassengerRow(BaseModel):
    """One passenger. Every value is invented."""

    passenger_id: str = Field(description="Key.")
    display_name: str = Field(description="Synthetic name. Never a real person.")
    member_id: str | None = Field(
        default=None, description="Loyalty member id, empty for passengers not in the programme."
    )
    remark_text: str = Field(description="Free text on the booking, the field the demo poisons.")
    passport_no: str = Field(
        description="Fake, impossible pattern such as X0000001. Hidden from gate agents."
    )
    contact_phone: str = Field(
        description="Fake, impossible pattern such as +000 0000 0001. Hidden from gate agents."
    )
    is_synthetic: bool = Field(description="Always true.")


class MemberRow(BaseModel):
    """One loyalty member and the benefits their tier carries."""

    member_id: str = Field(description="Key.")
    passenger_id: str = Field(description="The passenger this membership belongs to.")
    tier: str = Field(description="Tier name, joins to tier_benefits.tier.")
    lounge_access: bool = Field(description="Copied from the tier at generation time.")
    priority_standby: bool = Field(description="Copied from the tier at generation time.")
    meet_assist: bool = Field(description="Copied from the tier at generation time.")


class BookingRow(BaseModel):
    """One passenger journey through the hub."""

    booking_id: str = Field(description="Key.")
    passenger_id: str = Field(description="The passenger travelling.")
    inbound_flight_id: str = Field(description="The arrival they are on.")
    onward_flight_id: str | None = Field(
        default=None, description="The departure they connect to, empty when the journey ends here."
    )


class BagRow(BaseModel):
    """One checked bag."""

    bag_tag: str = Field(description="Key. Bag tag number.")
    passenger_id: str = Field(description="Owner of the bag.")
    inbound_flight_id: str = Field(description="The arrival the bag is on.")
    onward_flight_id: str | None = Field(
        default=None, description="The departure the bag transfers to, empty when it ends here."
    )


class CargoShipmentRow(BaseModel):
    """One cargo shipment transferring between two flights."""

    shipment_id: str = Field(description="Key.")
    inbound_flight_id: str = Field(description="The arrival carrying the shipment.")
    onward_flight_id: str = Field(description="The departure it has to make.")
    temperature_controlled: bool = Field(
        description="True when the shipment cannot wait for the next departure."
    )
    min_transfer_min: int = Field(description="Minutes the shipment needs on the ground.")


class NextFlightRow(BaseModel):
    """The flight a rebooked passenger is moved to, one row per onward flight."""

    onward_flight_id: str = Field(description="Key. The departure being missed.")
    next_flight_no: str = Field(description="Flight number of the replacement.")
    next_std_local: datetime = Field(description="Scheduled departure of the replacement.")


class TransferRuleRow(BaseModel):
    """One transfer rule, as read by people rather than by code."""

    rule_name: str = Field(description="Key. Matches a key under rules in the scenario file.")
    value: int = Field(description="The number the rule carries.")
    unit: str = Field(description="Unit of the value, minutes throughout.")
    description: str = Field(description="What the rule means, in one sentence.")


class TierBenefitRow(BaseModel):
    """One loyalty tier and what it entitles a member to."""

    tier: str = Field(description="Key. Tier name.")
    lounge_access: bool = Field(description="Whether the tier may use the lounge.")
    priority_standby: bool = Field(description="Whether the tier goes first on the standby list.")
    meet_assist: bool = Field(description="Whether the tier is met and escorted.")
    source_note: str = Field(description="Where the benefit list came from, and when it was read.")


class FlightEventRow(BaseModel):
    """One event on the stream. Written to the eventhouse, not to the lakehouse."""

    event_time: datetime = Field(description="When the event was raised.")
    flight_id: str = Field(description="The flight the event is about.")
    flight_no: str = Field(description="Flight number, carried so the stream reads on its own.")
    event_type: Literal["departed", "eta_update", "landed"] = Field(
        description="What happened."
    )
    eta_local: datetime | None = Field(
        default=None, description="New estimated arrival, set on eta_update."
    )
    delay_min: int | None = Field(default=None, description="Delay in minutes, when known.")
    source: str = Field(description="Which feed raised the event.")
    text: str = Field(description="The line a person would read.")


class PlanRow(BaseModel):
    """One proposed plan, from the rule engine or from an agent."""

    plan_id: str = Field(description="Key.")
    proposed_by: str = Field(
        description="rule engine, operations agent or planner agent."
    )
    created_at: datetime = Field(description="When the plan was proposed.")
    options: str = Field(
        description="The option chosen per onward flight, as JSON, for example {\"SIN\": \"hold\"}."
    )
    outcome: str = Field(
        description="The computed effect of the plan, as JSON. Computed in code, never by a model."
    )
    status: PlanStatus = Field(
        description="One of: " + ", ".join(PLAN_STATUSES) + "."
    )


class ApprovalRow(BaseModel):
    """One approval stage, decided or still waiting."""

    approval_id: str = Field(description="Key.")
    plan_id: str = Field(description="The plan being approved.")
    stage: str = Field(description="Stage name from the approval policy, for example stage_1.")
    approver: str = Field(description="Who was asked, by role or by user name.")
    decision: Literal["pending", "approved", "rejected", "expired"] = Field(
        description="Where the stage stands."
    )
    decided_at: datetime | None = Field(
        default=None, description="When the decision was made, empty while pending."
    )
    comment: str | None = Field(default=None, description="Free text the approver added.")


class ActionRow(BaseModel):
    """One dispatched action. Only dispatch_actions writes here."""

    action_id: str = Field(description="Key.")
    plan_id: str = Field(description="The plan this action carries out.")
    recipient: str = Field(description="Who the action goes to, by role or team.")
    text: str = Field(description="The instruction, as sent.")
    sent_at: datetime = Field(description="When it was sent.")
    status: str = Field(description="Where the dispatch stands, for example sent or failed.")


class SecurityEventRow(BaseModel):
    """One refused dispatch attempt. Written by the guard, not by the caller."""

    security_event_id: str = Field(description="Key.")
    plan_id: str = Field(description="The plan the caller tried to dispatch.")
    caller: str = Field(description="Who tried.")
    reason: str = Field(description="Why it was refused, for example approval stage missing.")
    occurred_at: datetime = Field(description="When the attempt was made.")


class RowTable(NamedTuple):
    """One table in the demo, its store, its key and the model of one row."""

    store: str
    table: str
    key: str
    model: type[BaseModel]


#: Every table and event in docs/demo-spec.md section 2, in the order it lists them.
ROW_TABLES: tuple[RowTable, ...] = (
    RowTable("lakehouse lh_hub", "flights", "flight_id", FlightRow),
    RowTable("lakehouse lh_hub", "gates", "gate_id", GateRow),
    RowTable("lakehouse lh_hub", "passengers", "passenger_id", PassengerRow),
    RowTable("lakehouse lh_hub", "members", "member_id", MemberRow),
    RowTable("lakehouse lh_hub", "bookings", "booking_id", BookingRow),
    RowTable("lakehouse lh_hub", "bags", "bag_tag", BagRow),
    RowTable("lakehouse lh_hub", "cargo_shipments", "shipment_id", CargoShipmentRow),
    RowTable("lakehouse lh_hub", "next_flights", "onward_flight_id", NextFlightRow),
    RowTable("lakehouse lh_hub", "transfer_rules", "rule_name", TransferRuleRow),
    RowTable("lakehouse lh_hub", "tier_benefits", "tier", TierBenefitRow),
    RowTable("eventhouse eh_hub, database hubdb", "flight_events", "event_time, flight_id",
             FlightEventRow),
    RowTable("sql database sqldb_hub_ops", "plans", "plan_id", PlanRow),
    RowTable("sql database sqldb_hub_ops", "approvals", "approval_id", ApprovalRow),
    RowTable("sql database sqldb_hub_ops", "actions", "action_id", ActionRow),
    RowTable("sql database sqldb_hub_ops", "security_events", "security_event_id",
             SecurityEventRow),
)


_SIMPLE_TYPES: dict[Any, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    datetime: "timestamp",
}


def render_type(annotation: Any) -> str:
    """Return a plain-language name for a field type, for the data dictionary."""
    if annotation in _SIMPLE_TYPES:
        return _SIMPLE_TYPES[annotation]

    origin = get_origin(annotation)
    args = get_args(annotation)

    if origin is Literal:
        return "one of: " + ", ".join(str(value) for value in args)

    if origin is Union or origin is UnionType:
        parts = [arg for arg in args if arg is not type(None)]
        rendered = " or ".join(render_type(part) for part in parts)
        return f"{rendered}, may be empty" if len(parts) < len(args) else rendered

    if origin in (list, tuple, set):
        inner = ", ".join(render_type(arg) for arg in args) if args else "value"
        return f"list of {inner}"

    if origin is dict and len(args) == 2:
        return f"map of {render_type(args[0])} to {render_type(args[1])}"

    name = getattr(annotation, "__name__", None)
    return str(name or annotation)


def data_dictionary_markdown() -> str:
    """Build ``docs/data-dictionary.md`` from the row models.

    The file is generated, never edited by hand: change a row model and run
    ``hubdemo docs`` again.
    """
    lines: list[str] = [
        "# Data dictionary",
        "",
        "Generated by `hubdemo docs` from the row models in `src/hubdemo/models.py`.",
        "Do not edit this file by hand: change the models and run the command again.",
        "",
        "Every table listed here is synthetic. Passport numbers and phone numbers use",
        "impossible patterns so no row can match a real person.",
        "",
    ]

    stores: list[str] = []
    for entry in ROW_TABLES:
        if entry.store not in stores:
            stores.append(entry.store)

    lines.append("| Table | Store | Key |")
    lines.append("| --- | --- | --- |")
    for entry in ROW_TABLES:
        lines.append(f"| `{entry.table}` | {entry.store} | `{entry.key}` |")
    lines.append("")

    for store in stores:
        lines.append(f"## {store}")
        lines.append("")
        for entry in ROW_TABLES:
            if entry.store != store:
                continue
            summary = (entry.model.__doc__ or "").strip().splitlines()
            lines.append(f"### `{entry.table}`")
            lines.append("")
            if summary:
                lines.append(summary[0])
                lines.append("")
            lines.append(f"Key: `{entry.key}`")
            lines.append("")
            lines.append("| Column | Type | Required | Description |")
            lines.append("| --- | --- | --- | --- |")
            for name, field in entry.model.model_fields.items():
                required = "yes" if field.is_required() else "no"
                description = field.description or ""
                rendered = render_type(field.annotation)
                lines.append(f"| `{name}` | {rendered} | {required} | {description} |")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"
