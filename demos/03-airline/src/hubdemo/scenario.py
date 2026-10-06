"""Load the scenario file and check it holds together.

``scenario/qr004.yaml`` is the single source of numbers for the whole demo
(rule 5). Nothing here invents a value: every function either reads a field or
subtracts two times the file already carries.

The five checks in :func:`load_scenario` catch a scenario file that parses but
cannot be true, for example onward flights whose connecting passengers do not
add up to the inbound flight's. Each raises :class:`ScenarioError` naming the
field, what was expected and what was found.

The connection window lives in :func:`hubdemo.rules.window_minutes`. Rule 4
says the rules are code and only ``src/hubdemo/rules.py`` computes them, so this
module imports that one definition rather than carrying a copy.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from hubdemo.config import repo_root
from hubdemo.models import Scenario
from hubdemo.rules import window_minutes

#: Where the scenario file sits when no path is given.
DEFAULT_SCENARIO = "scenario/qr004.yaml"


class ScenarioError(ValueError):
    """The scenario file is missing, unreadable, or does not hold together."""


def scenario_path(path: str | Path | None = None) -> Path:
    """Resolve a scenario path.

    A path is used as given when it exists, so running from any directory works.
    Otherwise it is read relative to the demo root, which keeps
    ``hubdemo describe --scenario scenario/qr004.yaml`` working from anywhere.
    """
    candidate = Path(path) if path is not None else Path(DEFAULT_SCENARIO)
    if candidate.is_absolute() or candidate.exists():
        return candidate
    return repo_root() / candidate


def windows(scenario: Scenario) -> dict[str, int]:
    """The connection window per onward flight, keyed by onward flight id."""
    return {
        flight.id: window_minutes(scenario.inbound, flight)
        for flight in scenario.onward_flights
    }


def totals(scenario: Scenario) -> dict[str, int]:
    """The headline counts, computed from the file rather than read from it.

    The keys match ``expected.totals`` so a test can compare the two directly.
    """
    return {
        "onward_flights": len(scenario.onward_flights),
        "connecting_pax": sum(f.connecting_pax for f in scenario.onward_flights),
        "transfer_bags": sum(f.bags for f in scenario.onward_flights),
        "connecting_members": sum(f.member_count for f in scenario.onward_flights),
        "cargo_shipments": len(scenario.cargo_shipments),
    }


def at_risk_ids(scenario: Scenario) -> list[str]:
    """Onward flights whose window is below the standard connection time."""
    computed = windows(scenario)
    return [
        flight.id
        for flight in scenario.onward_flights
        if computed[flight.id] < scenario.rules.pax_standard_min
    ]


def _check_connecting_pax_add_up(scenario: Scenario) -> None:
    counted = sum(flight.connecting_pax for flight in scenario.onward_flights)
    declared = scenario.inbound.pax_connecting
    if counted != declared:
        raise ScenarioError(
            "The connecting passengers on the onward flights do not add up to the inbound "
            f"flight. onward_flights add up to {counted}, inbound.pax_connecting is {declared}."
        )


def _check_members_fit_in_connecting_pax(scenario: Scenario) -> None:
    for flight in scenario.onward_flights:
        if flight.member_count > flight.connecting_pax:
            raise ScenarioError(
                f"Onward flight {flight.id} has more members than connecting passengers: "
                f"{flight.member_count} members against {flight.connecting_pax} "
                "connecting passengers."
            )


def _check_cargo_points_at_a_real_flight(scenario: Scenario) -> None:
    known = {flight.id for flight in scenario.onward_flights}
    for shipment in scenario.cargo_shipments:
        if shipment.onward not in known:
            listed = ", ".join(sorted(known))
            raise ScenarioError(
                f"Cargo shipment {shipment.id} points at onward flight {shipment.onward!r}, "
                f"which is not in the scenario. Known onward flights: {listed}."
            )


def _check_tight_flights_have_a_next_flight(scenario: Scenario) -> None:
    computed = windows(scenario)
    standard = scenario.rules.pax_standard_min
    for flight in scenario.onward_flights:
        window = computed[flight.id]
        if window < standard and flight.next_flight is None:
            raise ScenarioError(
                f"Onward flight {flight.id} has a window of {window} minutes, below the "
                f"standard of {standard} minutes, so passengers may need rebooking, but it "
                "has no next_flight to rebook them onto."
            )


def _check_tiers_exist(scenario: Scenario) -> None:
    known = set(scenario.tiers)
    for flight in scenario.onward_flights:
        for tier in flight.members:
            if tier not in known:
                listed = ", ".join(sorted(known))
                raise ScenarioError(
                    f"Onward flight {flight.id} counts members in tier {tier!r}, which is not "
                    f"defined under tiers. Known tiers: {listed}."
                )


_CHECKS = (
    _check_connecting_pax_add_up,
    _check_members_fit_in_connecting_pax,
    _check_cargo_points_at_a_real_flight,
    _check_tight_flights_have_a_next_flight,
    _check_tiers_exist,
)


def load_scenario(path: str | Path | None = None) -> Scenario:
    """Read, parse and check the scenario file.

    Raises :class:`ScenarioError` when the file is missing, is not a mapping,
    does not match the models, or fails one of the five consistency checks.
    """
    resolved = scenario_path(path)
    if not resolved.exists():
        raise ScenarioError(f"No scenario file at {resolved}.")

    try:
        raw = yaml.safe_load(resolved.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ScenarioError(f"Could not parse {resolved} as YAML: {exc}") from exc

    if not isinstance(raw, dict):
        raise ScenarioError(f"{resolved} should hold a mapping at the top level.")

    try:
        scenario = Scenario.model_validate(raw)
    except Exception as exc:
        raise ScenarioError(f"{resolved} does not match the scenario contract: {exc}") from exc

    for check in _CHECKS:
        check(scenario)

    return scenario
