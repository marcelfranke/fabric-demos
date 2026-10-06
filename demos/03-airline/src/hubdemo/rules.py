"""The transfer rules, proposals, member impact, actions and approval stages.

This module implements sections 3, 3.1 and 4 of ``docs/demo-spec.md``. Every
function here is pure: it reads a :class:`~hubdemo.models.Scenario` and returns
a value. Nothing reads a file, calls a service or prints.

The module imports ``hubdemo.models`` and the standard library only. It is
later copied into a Fabric function, so it must not reach for anything else in
the package.

Every threshold, count and policy number is read from the scenario. No number
from ``scenario/qr004.yaml`` is written here as a literal.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from hubdemo.models import (
    ApprovalPolicy,
    ApprovalStage,
    CargoShipment,
    InboundFlight,
    OnwardFlight,
    OptionResult,
    Scenario,
    TransferOption,
)

#: The options a person may pick for a connection, in the order the rules try them.
KEEPING_OPTIONS: tuple[TransferOption, ...] = ("fast", "hold")

#: The option that moves passengers off the flight they were booked on.
REBOOK: TransferOption = "rebook"

#: Results that mean the rules do not stand behind the choice.
NOT_OK_RESULTS: frozenset[OptionResult] = frozenset({"risky", "fails"})

#: The tier counted separately in the approval policy and in the member summary.
TOP_TIER = "Platinum"

#: Recipients of the actions in section 3.1, as named in the demo spec.
RESERVATIONS = "Reservations"
CUSTOMER_MESSAGES = "Customer messages"
BAGGAGE = "Baggage"
CARGO = "Cargo"
GROUND_HANDLING = "Ground handling"
MEMBER_SERVICES = "Member services"
AIRPORT_OPERATIONS = "Airport operations"


class RuleError(ValueError):
    """Raised when a choice cannot be judged against the scenario."""


def window_minutes(
    inbound: InboundFlight,
    onward: OnwardFlight,
    hold_min: int = 0,
) -> int:
    """Minutes between the inbound flight landing and the onward flight leaving.

    This is the one place the connection window is derived. ``hold_min`` is the
    delay added to the departure when the option holds the flight.
    """
    delta = (onward.std_local - inbound.new_eta_local).total_seconds() / 60
    return int(delta) + hold_min


def window_min(scenario: Scenario, onward_id: str, hold_min: int = 0) -> int:
    """The connection window for one onward flight, in minutes."""
    return window_minutes(scenario.inbound, scenario.onward(onward_id), hold_min)


def at_risk(scenario: Scenario) -> list[str]:
    """Onward flights whose window is below the standard minimum, in departure order."""
    flights = sorted(scenario.onward_flights, key=lambda flight: flight.std_local)
    return [
        flight.id
        for flight in flights
        if window_minutes(scenario.inbound, flight) < scenario.rules.pax_standard_min
    ]


def shipment_on(scenario: Scenario, onward_id: str) -> CargoShipment | None:
    """The cargo shipment booked on one onward flight, when there is one."""
    for shipment in scenario.cargo_shipments:
        if shipment.onward == onward_id:
            return shipment
    return None


@dataclass(frozen=True)
class Judgement:
    """What the rules make of one option on one onward flight."""

    onward_id: str
    option: TransferOption
    window_min: int
    hold_min: int
    result: OptionResult
    spare_min: int | None
    bags_make_it: bool
    cargo_makes_it: bool | None
    later_min: int | None

    @property
    def keeps_connection(self) -> bool:
        """True when the passengers stay on the flight they were booked on."""
        return self.option in KEEPING_OPTIONS and self.result != "fails"


def judge(scenario: Scenario, onward_id: str, option: TransferOption) -> Judgement:
    """Judge one option on one onward flight against the rules in section 3."""
    flight = scenario.onward(onward_id)
    rules = scenario.rules
    shipment = shipment_on(scenario, onward_id)

    if option == REBOOK:
        if flight.next_flight is None:
            raise RuleError(f"{onward_id} has no next_flight, so it cannot be rebooked")
        later = (flight.next_flight.std_local - flight.std_local).total_seconds() / 60
        return Judgement(
            onward_id=onward_id,
            option=option,
            window_min=window_minutes(scenario.inbound, flight),
            hold_min=0,
            result=REBOOK,
            spare_min=None,
            bags_make_it=False,
            cargo_makes_it=None if shipment is None else False,
            later_min=int(later),
        )

    if option not in KEEPING_OPTIONS:
        raise RuleError(f"{option} is not a transfer option on {onward_id}")

    hold_min = rules.max_hold_min if option == "hold" else 0
    window = window_minutes(scenario.inbound, flight, hold_min)
    spare = window - rules.pax_fasttrack_min
    if spare < 0:
        result: OptionResult = "fails"
    elif spare < rules.margin_min:
        result = "risky"
    else:
        result = "ok"

    return Judgement(
        onward_id=onward_id,
        option=option,
        window_min=window,
        hold_min=hold_min,
        result=result,
        spare_min=spare,
        bags_make_it=window >= rules.bag_priority_min,
        cargo_makes_it=None if shipment is None else window >= rules.cargo_min,
        later_min=None,
    )


def propose(scenario: Scenario, onward_id: str) -> TransferOption:
    """The first of ``fast`` and ``hold`` the rules call ``ok``, otherwise ``rebook``."""
    for option in KEEPING_OPTIONS:
        if judge(scenario, onward_id, option).result == "ok":
            return option
    return REBOOK


def _result_clause(scenario: Scenario, judgement: Judgement) -> str:
    """How one option reads in a sentence."""
    spare = judgement.spare_min
    if judgement.result == "ok":
        return f"leaves {spare} minutes of spare and works"
    if judgement.result == "risky":
        return (
            f"leaves {spare} minutes of spare against a "
            f"{scenario.rules.margin_min} minute margin and is risky"
        )
    return f"falls {abs(spare or 0)} minutes short and fails"


def explain(scenario: Scenario, onward_id: str) -> str:
    """One sentence stating the window and why the proposal follows."""
    flight = scenario.onward(onward_id)
    fast = judge(scenario, onward_id, "fast")
    hold = judge(scenario, onward_id, "hold")
    proposal = propose(scenario, onward_id)

    if proposal == REBOOK:
        rebook = judge(scenario, onward_id, REBOOK)
        next_flight = flight.next_flight
        if next_flight is None:  # pragma: no cover - judge already refused this flight
            raise RuleError(f"{onward_id} has no next_flight, so it cannot be rebooked")
        next_no = next_flight.flight_no
        tail = (
            f"so the proposal is to rebook the {flight.connecting_pax} passengers onto "
            f"{next_no}, {rebook.later_min} minutes later"
        )
    elif proposal == "hold":
        tail = (
            f"so the proposal is to hold the flight {hold.hold_min} minutes "
            "and fast-track the passengers"
        )
    else:
        tail = "so the proposal is to fast-track the passengers"

    return (
        f"{flight.flight_no} to {flight.city} has a {fast.window_min} minute window, "
        f"fast-track {_result_clause(scenario, fast)}, "
        f"a {hold.hold_min} minute hold {_result_clause(scenario, hold)}, "
        f"{tail}."
    )


def meet_assist_tiers(scenario: Scenario) -> list[str]:
    """Tiers entitled to meet and assist, in the order the scenario lists them."""
    return [tier for tier, benefits in scenario.tiers.items() if benefits.meet_assist]


@dataclass(frozen=True)
class PlanEvaluation:
    """What a set of choices does to passengers, bags, cargo and members."""

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
    members_rebooked_by_tier: dict[str, int] = field(default_factory=dict)
    differs_from_proposal: list[str] = field(default_factory=list)

    def as_outcome(self) -> dict[str, object]:
        """The fields the scenario asserts, in the order it lists them."""
        return {
            "pax_protected": self.pax_protected,
            "bags_protected": self.bags_protected,
            "pax_rebooked": self.pax_rebooked,
            "pax_exposed": self.pax_exposed,
            "hold_min_total": self.hold_min_total,
            "cargo_protected": self.cargo_protected,
            "members_keep_connection": self.members_keep_connection,
            "members_rebooked": self.members_rebooked,
            "platinum_rebooked": self.platinum_rebooked,
            "meet_assist_members": self.meet_assist_members,
            "approval_stages": self.approval_stages,
            "action_count": self.action_count,
        }


def _judge_all(
    scenario: Scenario,
    choices: dict[str, TransferOption],
) -> dict[str, Judgement]:
    """Judge every choice once, so the rest of the plan reads the same numbers."""
    return {
        onward_id: judge(scenario, onward_id, option) for onward_id, option in choices.items()
    }


def evaluate_plan(scenario: Scenario, choices: dict[str, TransferOption]) -> PlanEvaluation:
    """What a plan protects, rebooks and exposes, and what it needs approved."""
    judgements = _judge_all(scenario, choices)
    assist_tiers = meet_assist_tiers(scenario)

    pax_protected = bags_protected = pax_rebooked = pax_exposed = 0
    hold_min_total = members_keep = members_rebooked = meet_assist = 0
    by_tier: dict[str, int] = {}

    for onward_id, judgement in judgements.items():
        flight = scenario.onward(onward_id)
        hold_min_total += judgement.hold_min

        if judgement.option == REBOOK:
            pax_rebooked += flight.connecting_pax
            members_rebooked += flight.member_count
            for tier, count in flight.members.items():
                by_tier[tier] = by_tier.get(tier, 0) + count
        elif judgement.keeps_connection:
            pax_protected += flight.connecting_pax
            if judgement.bags_make_it:
                bags_protected += flight.bags
            members_keep += flight.member_count
            meet_assist += sum(flight.members.get(tier, 0) for tier in assist_tiers)
        else:
            pax_exposed += flight.connecting_pax

    cargo_protected = all(
        judgement.cargo_makes_it
        for judgement in judgements.values()
        if judgement.cargo_makes_it is not None
    )
    differs = [
        onward_id
        for onward_id, option in choices.items()
        if option != propose(scenario, onward_id)
    ]

    outcome = PlanEvaluation(
        pax_protected=pax_protected,
        bags_protected=bags_protected,
        pax_rebooked=pax_rebooked,
        pax_exposed=pax_exposed,
        hold_min_total=hold_min_total,
        cargo_protected=cargo_protected,
        members_keep_connection=members_keep,
        members_rebooked=members_rebooked,
        platinum_rebooked=by_tier.get(TOP_TIER, 0),
        meet_assist_members=meet_assist,
        approval_stages=[],
        action_count=0,
        members_rebooked_by_tier=by_tier,
        differs_from_proposal=differs,
    )
    return replace(
        outcome,
        approval_stages=_stages_for(scenario, judgements, outcome),
        action_count=len(_actions_from(scenario, judgements)),
    )


@dataclass(frozen=True)
class Action:
    """One instruction the plan asks a team to carry out."""

    onward_id: str
    recipient: str
    text: str


def _clock(moment: datetime) -> str:
    """Local time of day, as it is written in an instruction."""
    return moment.strftime("%H:%M")


def _tier_phrase(tiers: list[str]) -> str:
    """Tier names as they read in a sentence, for example ``Gold and Platinum``."""
    names = sorted(tiers)
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _rebook_actions(scenario: Scenario, judgement: Judgement) -> list[Action]:
    """Section 3.1, rebook: reservations, customer messages, baggage, cargo."""
    flight = scenario.onward(judgement.onward_id)
    next_flight = flight.next_flight
    if next_flight is None:
        raise RuleError(f"{flight.id} has no next_flight, so it cannot be rebooked")
    actions = [
        Action(
            flight.id,
            RESERVATIONS,
            f"Move the {flight.connecting_pax} connecting passengers from "
            f"{flight.flight_no} to {next_flight.flight_no} at {_clock(next_flight.std_local)}.",
        ),
        Action(
            flight.id,
            CUSTOMER_MESSAGES,
            f"Send the new itinerary and lounge access to the {flight.connecting_pax} "
            f"rebooked passengers on {flight.flight_no} before landing.",
        ),
        Action(
            flight.id,
            BAGGAGE,
            f"Reroute the {flight.bags} transfer bags from {flight.flight_no} "
            f"to {next_flight.flight_no}.",
        ),
    ]
    shipment = shipment_on(scenario, flight.id)
    if shipment is not None:
        actions.append(
            Action(
                flight.id,
                CARGO,
                f"Re-plan shipment {shipment.id} off {flight.flight_no}.",
            )
        )
    return actions


def _keep_actions(scenario: Scenario, judgement: Judgement) -> list[Action]:
    """Section 3.1, fast and hold: the ground, baggage, member and cargo instructions."""
    flight = scenario.onward(judgement.onward_id)
    actions: list[Action] = []

    if judgement.option == "hold":
        held_to = flight.std_local + timedelta(minutes=judgement.hold_min)
        actions.append(
            Action(
                flight.id,
                AIRPORT_OPERATIONS,
                f"Hold {flight.flight_no} at gate {flight.gate} until {_clock(held_to)}.",
            )
        )

    actions.append(
        Action(
            flight.id,
            GROUND_HANDLING,
            f"Escort the {flight.connecting_pax} connecting passengers from gate "
            f"{scenario.inbound.gate} to gate {flight.gate} for {flight.flight_no}.",
        )
    )
    actions.append(
        Action(
            flight.id,
            BAGGAGE,
            f"Transfer the {flight.bags} bags tail to tail from "
            f"{scenario.inbound.flight_no} to {flight.flight_no}.",
        )
    )

    assist_tiers = meet_assist_tiers(scenario)
    assisted = sum(flight.members.get(tier, 0) for tier in assist_tiers)
    if assisted and judgement.result != "fails":
        actions.append(
            Action(
                flight.id,
                MEMBER_SERVICES,
                f"Meet and assist {assisted} {_tier_phrase(assist_tiers)} members "
                f"on {flight.flight_no}.",
            )
        )

    shipment = shipment_on(scenario, flight.id)
    if shipment is not None:
        if judgement.cargo_makes_it:
            text = f"Shipment {shipment.id} stays on {flight.flight_no}."
        else:
            text = f"Re-plan shipment {shipment.id} off {flight.flight_no}."
        actions.append(Action(flight.id, CARGO, text))

    return actions


def _actions_from(scenario: Scenario, judgements: dict[str, Judgement]) -> list[Action]:
    """The action list for judgements already made."""
    actions: list[Action] = []
    for judgement in judgements.values():
        if judgement.option == REBOOK:
            actions.extend(_rebook_actions(scenario, judgement))
        else:
            actions.extend(_keep_actions(scenario, judgement))
    return actions


def actions_for(scenario: Scenario, choices: dict[str, TransferOption]) -> list[Action]:
    """The section 3.1 action list for a plan, in the order the spec gives."""
    return _actions_from(scenario, _judge_all(scenario, choices))


def _policy(scenario: Scenario, policy_name: str) -> ApprovalPolicy:
    """One named approval policy from the scenario."""
    policy = getattr(scenario, policy_name, None)
    if not isinstance(policy, ApprovalPolicy):
        raise RuleError(f"{policy_name} is not an approval policy in the scenario")
    return policy


def _trigger_fires(
    key: str,
    value: object,
    judgements: dict[str, Judgement],
    outcome: PlanEvaluation,
) -> bool:
    """Whether one ``when_any`` condition from the policy holds for this plan."""
    if key == "total_hold_min_greater_than":
        return outcome.hold_min_total > int(value)  # type: ignore[arg-type]
    if key == "any_chosen_option_not_ok":
        return bool(value) and any(j.result in NOT_OK_RESULTS for j in judgements.values())
    if key == "platinum_members_rebooked_at_least":
        return outcome.platinum_rebooked >= int(value)  # type: ignore[arg-type]
    raise RuleError(f"{key} is not a condition the rules know")


def _stage_applies(
    stage: ApprovalStage,
    judgements: dict[str, Judgement],
    outcome: PlanEvaluation,
) -> bool:
    """Whether one stage of the policy is required for this plan."""
    if stage.always:
        return True
    for condition in stage.when_any or []:
        for key, value in condition.items():
            if _trigger_fires(key, value, judgements, outcome):
                return True
    return False


def _stages_for(
    scenario: Scenario,
    judgements: dict[str, Judgement],
    outcome: PlanEvaluation,
    policy_name: str = "approval_policy",
) -> list[str]:
    """The roles a plan needs, in stage order."""
    policy = _policy(scenario, policy_name)
    stages = [policy.stage_1, policy.stage_2]
    return [
        stage.role
        for stage in stages
        if stage is not None and _stage_applies(stage, judgements, outcome)
    ]


def approval_stages(
    scenario: Scenario,
    choices: dict[str, TransferOption],
    policy_name: str = "approval_policy",
) -> list[str]:
    """The roles the named policy requires for a plan, in stage order."""
    judgements = _judge_all(scenario, choices)
    outcome = evaluate_plan(scenario, choices)
    return _stages_for(scenario, judgements, outcome, policy_name)


def _cargo_clause(scenario: Scenario, choices: dict[str, TransferOption]) -> str:
    """How the plan leaves the shipments on the flights it touches."""
    judgements = _judge_all(scenario, choices)
    carried = [j for j in judgements.values() if j.cargo_makes_it is not None]
    if not carried:
        return "no shipment is affected"
    made = [j for j in carried if j.cargo_makes_it]
    noun = "the shipment" if len(carried) == 1 else f"all {len(carried)} shipments"
    if len(made) == len(carried):
        return f"{noun} makes it" if len(carried) == 1 else f"{noun} make it"
    if not made:
        return "the shipment is re-planned" if len(carried) == 1 else f"{noun} are re-planned"
    return f"{len(made)} of {len(carried)} shipments make it"


def plan_text(scenario: Scenario, choices: dict[str, TransferOption]) -> str:
    """The operational summary an approver reads."""
    outcome = evaluate_plan(scenario, choices)
    parts = [
        f"{outcome.pax_protected} passengers and {outcome.bags_protected} bags "
        "keep their connection",
        f"{outcome.pax_rebooked} passengers rebooked",
        f"{outcome.hold_min_total} hold minutes",
        _cargo_clause(scenario, choices),
    ]
    if outcome.pax_exposed:
        parts.insert(1, f"{outcome.pax_exposed} passengers left exposed")
    return f"{', '.join(parts)}."


def member_text(scenario: Scenario, choices: dict[str, TransferOption]) -> str:
    """The member summary an approver reads."""
    outcome = evaluate_plan(scenario, choices)
    tiers = _tier_phrase(meet_assist_tiers(scenario))
    return (
        f"{outcome.members_keep_connection} members keep their connection, "
        f"{outcome.members_rebooked} are rebooked including "
        f"{outcome.platinum_rebooked} {TOP_TIER}, "
        f"{outcome.meet_assist_members} {tiers} members get meet and assist."
    )
