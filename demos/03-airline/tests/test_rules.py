"""Tests for the rules engine in :mod:`hubdemo.rules`.

Every number in this file comes from the scenario through ``scenario.expected``
or ``scenario.rules``. Nothing from ``scenario/qr004.yaml`` is written here as a
literal, so these tests check the engine against the contract rather than
against a second copy of the contract.

Flight ids and tier names are read from the scenario too, so a change to the
scenario file moves the tests with it.
"""

from __future__ import annotations

import pytest

from hubdemo import rules
from hubdemo.scenario import load_scenario

SCENARIO = load_scenario()
EXPECTED = SCENARIO.expected

ASSIST_TIERS = rules.meet_assist_tiers(SCENARIO)
CARGO_IDS = [shipment.onward for shipment in SCENARIO.cargo_shipments]
NO_CARGO_IDS = [
    flight.id
    for flight in SCENARIO.onward_flights
    if rules.shipment_on(SCENARIO, flight.id) is None
]
NO_NEXT_IDS = [flight.id for flight in SCENARIO.onward_flights if flight.next_flight is None]
HAS_NEXT_IDS = [flight.id for flight in SCENARIO.onward_flights if flight.next_flight is not None]
HOLD_OK_IDS = [
    flight.id
    for flight in SCENARIO.onward_flights
    if rules.judge(SCENARIO, flight.id, "hold").result == "ok"
]
NOT_OK_FAST_IDS = [
    flight.id
    for flight in SCENARIO.onward_flights
    if rules.judge(SCENARIO, flight.id, "fast").result in rules.NOT_OK_RESULTS
]
LONGEST_WINDOW = max(EXPECTED.windows_min.values())


def assisted_members(onward_id: str) -> int:
    """How many members on a flight would be met and assisted."""
    flight = SCENARIO.onward(onward_id)
    return sum(flight.members.get(tier, 0) for tier in ASSIST_TIERS)


# The scenario's own numbers, checked against the engine.


@pytest.mark.parametrize(("onward_id", "minutes"), sorted(EXPECTED.windows_min.items()))
def test_window_min_matches_the_scenario(onward_id: str, minutes: int) -> None:
    assert rules.window_min(SCENARIO, onward_id) == minutes


def test_a_hold_widens_the_window_by_the_hold() -> None:
    onward_id, minutes = sorted(EXPECTED.windows_min.items())[0]
    hold = SCENARIO.rules.max_hold_min
    assert rules.window_min(SCENARIO, onward_id, hold) == minutes + hold


def test_at_risk_matches_the_scenario() -> None:
    assert rules.at_risk(SCENARIO) == EXPECTED.at_risk


@pytest.mark.parametrize(
    ("onward_id", "option", "result"),
    [
        (onward_id, option, getattr(results, option))
        for onward_id, results in sorted(EXPECTED.option_results.items())
        for option in ("fast", "hold", "rebook")
    ],
)
def test_judge_matches_the_scenario(onward_id: str, option: str, result: str) -> None:
    assert rules.judge(SCENARIO, onward_id, option).result == result


@pytest.mark.parametrize(("onward_id", "option"), sorted(EXPECTED.proposal.items()))
def test_propose_matches_the_scenario(onward_id: str, option: str) -> None:
    assert rules.propose(SCENARIO, onward_id) == option


def test_the_proposed_plan_matches_the_scenario() -> None:
    outcome = rules.evaluate_plan(SCENARIO, EXPECTED.proposal).as_outcome()
    assert outcome == EXPECTED.proposed_plan.model_dump()


@pytest.mark.parametrize("case", EXPECTED.override_cases, ids=lambda case: case.name)
def test_override_cases_match_the_scenario(case: object) -> None:
    outcome = rules.evaluate_plan(SCENARIO, case.choices).as_outcome()
    assert outcome == case.outcome.model_dump()


def test_the_action_count_matches_the_scenario() -> None:
    actions = rules.actions_for(SCENARIO, EXPECTED.proposal)
    assert len(actions) == EXPECTED.proposed_plan.action_count


@pytest.mark.parametrize("case", EXPECTED.override_cases, ids=lambda case: case.name)
def test_override_action_counts_match_the_scenario(case: object) -> None:
    assert len(rules.actions_for(SCENARIO, case.choices)) == case.outcome.action_count


# Properties the rules must hold whatever the numbers are.


@pytest.mark.parametrize("onward_id", [flight.id for flight in SCENARIO.onward_flights])
def test_propose_never_picks_a_risky_or_failing_option(onward_id: str) -> None:
    option = rules.propose(SCENARIO, onward_id)
    if option in rules.KEEPING_OPTIONS:
        assert rules.judge(SCENARIO, onward_id, option).result == "ok"


@pytest.mark.parametrize("target", sorted(SCENARIO.tiers))
def test_tier_never_changes_the_proposal(target: str) -> None:
    before = {flight.id: rules.propose(SCENARIO, flight.id) for flight in SCENARIO.onward_flights}
    shuffled = SCENARIO.model_copy(deep=True)
    for flight in shuffled.onward_flights:
        total = sum(flight.members.values())
        flight.members = dict.fromkeys(shuffled.tiers, 0)
        flight.members[target] = total
    after = {flight.id: rules.propose(shuffled, flight.id) for flight in shuffled.onward_flights}
    assert after == before


def test_members_rebooked_by_tier_adds_up() -> None:
    evaluation = rules.evaluate_plan(SCENARIO, EXPECTED.proposal)
    plan = EXPECTED.proposed_plan
    assert sum(evaluation.members_rebooked_by_tier.values()) == plan.members_rebooked
    assert evaluation.members_rebooked_by_tier.get(rules.TOP_TIER, 0) == plan.platinum_rebooked


def test_differs_from_proposal_lists_only_the_overrides() -> None:
    assert rules.evaluate_plan(SCENARIO, EXPECTED.proposal).differs_from_proposal == []
    for case in EXPECTED.override_cases:
        evaluation = rules.evaluate_plan(SCENARIO, case.choices)
        changed = [
            onward_id
            for onward_id, option in case.choices.items()
            if option != EXPECTED.proposal[onward_id]
        ]
        assert evaluation.differs_from_proposal == changed


# Things the rules refuse to do.


def test_a_flight_without_a_next_flight_cannot_be_rebooked() -> None:
    with pytest.raises(rules.RuleError, match="no next_flight"):
        rules.judge(SCENARIO, NO_NEXT_IDS[0], "rebook")


def test_an_unknown_option_is_refused() -> None:
    with pytest.raises(rules.RuleError, match="not a transfer option"):
        rules.judge(SCENARIO, SCENARIO.onward_flights[0].id, "teleport")


def test_rebook_actions_refuse_a_flight_without_a_next_flight() -> None:
    onward_id = NO_NEXT_IDS[0]
    judgement = rules.Judgement(
        onward_id=onward_id,
        option="rebook",
        window_min=rules.window_min(SCENARIO, onward_id),
        hold_min=0,
        result="rebook",
        spare_min=None,
        bags_make_it=False,
        cargo_makes_it=None,
        later_min=0,
    )
    with pytest.raises(rules.RuleError, match="no next_flight"):
        rules._rebook_actions(SCENARIO, judgement)


def test_an_unknown_approval_condition_is_refused() -> None:
    outcome = rules.evaluate_plan(SCENARIO, EXPECTED.proposal)
    with pytest.raises(rules.RuleError, match="not a condition"):
        rules._trigger_fires("a_condition_nobody_wrote", 1, {}, outcome)


def test_an_unknown_approval_policy_is_refused() -> None:
    with pytest.raises(rules.RuleError, match="not an approval policy"):
        rules.approval_stages(SCENARIO, EXPECTED.proposal, "rules")


# Approval stages.


def test_the_single_stage_policy_asks_one_role() -> None:
    stages = rules.approval_stages(SCENARIO, EXPECTED.proposal, "approval_policy_single")
    assert stages == [SCENARIO.approval_policy_single.stage_1.role]


def test_a_small_plan_needs_only_the_first_stage() -> None:
    evaluation = rules.evaluate_plan(SCENARIO, {HOLD_OK_IDS[0]: "hold"})
    assert evaluation.hold_min_total == SCENARIO.rules.max_hold_min
    assert evaluation.platinum_rebooked == 0
    assert evaluation.approval_stages == [SCENARIO.approval_policy.stage_1.role]


def test_total_hold_minutes_alone_trigger_the_second_stage() -> None:
    first, second = HOLD_OK_IDS[:2]
    evaluation = rules.evaluate_plan(SCENARIO, {first: "hold", second: "hold"})
    assert evaluation.hold_min_total > SCENARIO.rules.max_hold_min
    assert evaluation.platinum_rebooked == 0
    assert evaluation.approval_stages == [
        SCENARIO.approval_policy.stage_1.role,
        SCENARIO.approval_policy.stage_2.role,
    ]


def test_an_option_the_rules_dislike_triggers_the_second_stage() -> None:
    stages = rules.approval_stages(SCENARIO, {NOT_OK_FAST_IDS[0]: "fast"})
    assert stages == [
        SCENARIO.approval_policy.stage_1.role,
        SCENARIO.approval_policy.stage_2.role,
    ]


def test_a_switched_off_condition_does_not_trigger_the_second_stage() -> None:
    relaxed = SCENARIO.model_copy(deep=True)
    for condition in relaxed.approval_policy.stage_2.when_any or []:
        if "any_chosen_option_not_ok" in condition:
            condition["any_chosen_option_not_ok"] = False
    stages = rules.approval_stages(relaxed, {NOT_OK_FAST_IDS[0]: "fast"})
    assert stages == [relaxed.approval_policy.stage_1.role]


# Sentences for people.


@pytest.mark.parametrize(("onward_id", "option"), sorted(EXPECTED.proposal.items()))
def test_explain_describes_the_proposal(onward_id: str, option: str) -> None:
    flight = SCENARIO.onward(onward_id)
    sentence = rules.explain(SCENARIO, onward_id)
    assert sentence.startswith(f"{flight.flight_no} to {flight.city}")
    assert sentence.endswith(".")
    assert str(EXPECTED.windows_min[onward_id]) in sentence
    if option == rules.REBOOK:
        assert flight.next_flight is not None
        assert f"rebook the {flight.connecting_pax} passengers" in sentence
        assert flight.next_flight.flight_no in sentence
    elif option == "hold":
        assert f"hold the flight {SCENARIO.rules.max_hold_min} minutes" in sentence
    else:
        assert sentence.endswith("so the proposal is to fast-track the passengers.")


def test_explain_names_the_margin_on_a_risky_option() -> None:
    risky = [
        onward_id
        for onward_id, results in EXPECTED.option_results.items()
        if "risky" in (results.fast, results.hold)
    ]
    sentence = rules.explain(SCENARIO, risky[0])
    assert f"against a {SCENARIO.rules.margin_min} minute margin and is risky" in sentence


def test_explain_says_how_far_short_a_failing_option_falls() -> None:
    failing = [
        onward_id
        for onward_id, results in EXPECTED.option_results.items()
        if results.fast == "fails"
    ]
    assert "minutes short and fails" in rules.explain(SCENARIO, failing[0])


def test_plan_text_reads_back_the_proposed_plan() -> None:
    plan = EXPECTED.proposed_plan
    text = rules.plan_text(SCENARIO, EXPECTED.proposal)
    assert text.startswith(
        f"{plan.pax_protected} passengers and {plan.bags_protected} bags keep their connection"
    )
    assert f"{plan.pax_rebooked} passengers rebooked" in text
    assert f"{plan.hold_min_total} hold minutes" in text
    assert "exposed" not in text
    assert text.endswith(".")


def test_plan_text_names_exposed_passengers() -> None:
    case = next(case for case in EXPECTED.override_cases if case.outcome.pax_exposed)
    text = rules.plan_text(SCENARIO, case.choices)
    assert f"{case.outcome.pax_exposed} passengers left exposed" in text


def test_member_text_reads_back_the_proposed_plan() -> None:
    plan = EXPECTED.proposed_plan
    text = rules.member_text(SCENARIO, EXPECTED.proposal)
    assert text.startswith(f"{plan.members_keep_connection} members keep their connection")
    assert f"{plan.members_rebooked} are rebooked" in text
    assert f"{plan.platinum_rebooked} {rules.TOP_TIER}" in text
    assert f"{plan.meet_assist_members} " in text
    for tier in ASSIST_TIERS:
        assert tier in text


def test_member_text_names_one_tier_when_only_one_is_assisted() -> None:
    single = SCENARIO.model_copy(deep=True)
    for tier in ASSIST_TIERS[1:]:
        single.tiers[tier].meet_assist = False
    text = rules.member_text(single, EXPECTED.proposal)
    assert f"{ASSIST_TIERS[0]} members get meet and assist" in text


# Cargo wording, one branch per shape of the fleet.


def test_cargo_is_not_mentioned_when_no_shipment_is_affected() -> None:
    choices = {NO_CARGO_IDS[0]: "fast"}
    assert "no shipment is affected" in rules.plan_text(SCENARIO, choices)
    assert rules.evaluate_plan(SCENARIO, choices).cargo_protected is True


def test_one_shipment_that_makes_it() -> None:
    onward_id = next(
        cargo_id for cargo_id in CARGO_IDS if rules.judge(SCENARIO, cargo_id, "hold").cargo_makes_it
    )
    assert "the shipment makes it" in rules.plan_text(SCENARIO, {onward_id: "hold"})


def test_one_shipment_that_is_re_planned() -> None:
    onward_id = next(cargo_id for cargo_id in CARGO_IDS if cargo_id in HAS_NEXT_IDS)
    assert "the shipment is re-planned" in rules.plan_text(SCENARIO, {onward_id: rules.REBOOK})


def test_every_shipment_makes_it() -> None:
    kept = [
        cargo_id
        for cargo_id in CARGO_IDS
        if rules.judge(SCENARIO, cargo_id, "fast").cargo_makes_it
    ]
    choices = dict.fromkeys(kept, "fast")
    assert f"all {len(kept)} shipments make it" in rules.plan_text(SCENARIO, choices)


def test_no_shipment_makes_it() -> None:
    strict = SCENARIO.model_copy(deep=True)
    strict.rules.cargo_min = LONGEST_WINDOW + 1
    choices = dict.fromkeys(CARGO_IDS, "fast")
    text = rules.plan_text(strict, choices)
    assert f"all {len(CARGO_IDS)} shipments are re-planned" in text
    assert rules.evaluate_plan(strict, choices).cargo_protected is False


def test_some_shipments_make_it() -> None:
    windows = {cargo_id: rules.window_min(SCENARIO, cargo_id) for cargo_id in CARGO_IDS}
    widest = max(windows, key=lambda cargo_id: windows[cargo_id])
    mixed = SCENARIO.model_copy(deep=True)
    mixed.rules.cargo_min = windows[widest]
    choices = dict.fromkeys(CARGO_IDS, "fast")
    assert f"1 of {len(CARGO_IDS)} shipments make it" in rules.plan_text(mixed, choices)


# The action list, section 3.1.


def test_a_rebook_starts_with_reservations() -> None:
    onward_id = next(
        onward_id for onward_id, option in EXPECTED.proposal.items() if option == rules.REBOOK
    )
    flight = SCENARIO.onward(onward_id)
    actions = rules.actions_for(SCENARIO, {onward_id: rules.REBOOK})
    assert [action.recipient for action in actions[:3]] == [
        rules.RESERVATIONS,
        rules.CUSTOMER_MESSAGES,
        rules.BAGGAGE,
    ]
    assert flight.next_flight is not None
    assert flight.next_flight.flight_no in actions[0].text
    assert str(flight.bags) in actions[2].text


def test_a_hold_starts_at_the_gate() -> None:
    onward_id = next(
        onward_id for onward_id, option in EXPECTED.proposal.items() if option == "hold"
    )
    flight = SCENARIO.onward(onward_id)
    actions = rules.actions_for(SCENARIO, {onward_id: "hold"})
    assert actions[0].recipient == rules.AIRPORT_OPERATIONS
    assert flight.gate in actions[0].text
    assert rules.MEMBER_SERVICES in [action.recipient for action in actions]


def test_a_fast_track_does_not_hold_the_gate() -> None:
    onward_id = next(
        onward_id for onward_id, option in EXPECTED.proposal.items() if option == "fast"
    )
    recipients = [action.recipient for action in rules.actions_for(SCENARIO, {onward_id: "fast"})]
    assert rules.AIRPORT_OPERATIONS not in recipients
    assert recipients[0] == rules.GROUND_HANDLING


def test_a_connection_without_assisted_members_gets_no_meet_and_assist() -> None:
    onward_id = next(
        flight.id for flight in SCENARIO.onward_flights if assisted_members(flight.id) == 0
    )
    recipients = [action.recipient for action in rules.actions_for(SCENARIO, {onward_id: "fast"})]
    assert rules.MEMBER_SERVICES not in recipients


def test_a_failing_connection_gets_no_meet_and_assist() -> None:
    onward_id = next(
        flight.id
        for flight in SCENARIO.onward_flights
        if assisted_members(flight.id) > 0
        and rules.judge(SCENARIO, flight.id, "fast").result == "fails"
    )
    recipients = [action.recipient for action in rules.actions_for(SCENARIO, {onward_id: "fast"})]
    assert rules.MEMBER_SERVICES not in recipients


def test_a_kept_connection_can_still_lose_its_shipment() -> None:
    onward_id = next(
        cargo_id
        for cargo_id in CARGO_IDS
        if not rules.judge(SCENARIO, cargo_id, "fast").cargo_makes_it
    )
    cargo = [
        action for action in rules.actions_for(SCENARIO, {onward_id: "fast"})
        if action.recipient == rules.CARGO
    ]
    assert len(cargo) == 1
    assert cargo[0].text.startswith("Re-plan shipment")


def test_a_kept_connection_keeps_a_shipment_that_makes_it() -> None:
    onward_id = next(
        cargo_id for cargo_id in CARGO_IDS if rules.judge(SCENARIO, cargo_id, "fast").cargo_makes_it
    )
    cargo = [
        action for action in rules.actions_for(SCENARIO, {onward_id: "fast"})
        if action.recipient == rules.CARGO
    ]
    assert len(cargo) == 1
    assert "stays on" in cargo[0].text


def test_bags_can_miss_on_a_kept_connection() -> None:
    strict = SCENARIO.model_copy(deep=True)
    strict.rules.bag_priority_min = LONGEST_WINDOW + 1
    evaluation = rules.evaluate_plan(strict, EXPECTED.proposal)
    assert evaluation.pax_protected == EXPECTED.proposed_plan.pax_protected
    assert evaluation.bags_protected == 0
