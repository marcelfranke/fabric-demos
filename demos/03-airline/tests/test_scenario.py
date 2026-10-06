"""Tests for the scenario contract.

The numbers never appear here. Each test compares what the code works out
from the scenario file against the expected block inside the same file, so
the file stays the single source of numbers.
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest
import yaml

from hubdemo.scenario import (
    ScenarioError,
    at_risk_ids,
    load_scenario,
    scenario_path,
    totals,
    windows,
)


@pytest.fixture(scope="module")
def scenario():
    """The real scenario file, loaded once."""
    return load_scenario()


@pytest.fixture
def raw() -> dict:
    """A fresh copy of the scenario file as plain data, ready to break."""
    text = scenario_path().read_text(encoding="utf-8")
    return copy.deepcopy(yaml.safe_load(text))


def write_scenario(tmp_path: Path, data: dict) -> Path:
    """Write a scenario copy to a temporary file and return its path."""
    target = tmp_path / "broken.yaml"
    target.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return target


def test_totals_match_the_expected_block(scenario) -> None:
    assert totals(scenario) == scenario.expected.totals.model_dump()


def test_windows_match_the_expected_block(scenario) -> None:
    assert windows(scenario) == scenario.expected.windows_min


def test_at_risk_flights_match_the_expected_block(scenario) -> None:
    assert sorted(at_risk_ids(scenario)) == sorted(scenario.expected.at_risk)


def test_every_onward_flight_has_a_window(scenario) -> None:
    computed = windows(scenario)
    assert sorted(computed) == sorted(flight.id for flight in scenario.onward_flights)


def test_a_missing_file_is_reported(tmp_path: Path) -> None:
    with pytest.raises(ScenarioError, match="No scenario file at"):
        load_scenario(tmp_path / "not-here.yaml")


def test_a_file_that_is_not_yaml_is_reported(tmp_path: Path) -> None:
    target = tmp_path / "broken.yaml"
    target.write_text("scenario_id: qr004\n  bad indent: true\n", encoding="utf-8")
    with pytest.raises(ScenarioError, match="as YAML"):
        load_scenario(target)


def test_connecting_passengers_must_add_up(tmp_path: Path, raw: dict) -> None:
    raw["onward_flights"][0]["connecting_pax"] += 1
    with pytest.raises(ScenarioError, match="do not add up"):
        load_scenario(write_scenario(tmp_path, raw))


def test_members_must_fit_in_the_connecting_passengers(tmp_path: Path, raw: dict) -> None:
    flight = raw["onward_flights"][0]
    tier = next(iter(flight["members"]))
    flight["members"][tier] = flight["connecting_pax"] + 1
    with pytest.raises(ScenarioError, match="more members than connecting passengers"):
        load_scenario(write_scenario(tmp_path, raw))


def test_cargo_must_point_at_a_real_onward_flight(tmp_path: Path, raw: dict) -> None:
    raw["cargo_shipments"][0]["onward"] = "ZZZ"
    with pytest.raises(ScenarioError, match="not in the scenario"):
        load_scenario(write_scenario(tmp_path, raw))


def test_a_tight_flight_needs_a_next_flight(tmp_path: Path, raw: dict) -> None:
    tightest = min(
        raw["onward_flights"],
        key=lambda flight: str(flight["std_local"]),
    )
    tightest.pop("next_flight", None)
    with pytest.raises(ScenarioError, match="no next_flight"):
        load_scenario(write_scenario(tmp_path, raw))


def test_member_tiers_must_be_defined(tmp_path: Path, raw: dict) -> None:
    flight = raw["onward_flights"][0]
    flight["members"] = {"Diamond": 1}
    with pytest.raises(ScenarioError, match="not defined under tiers"):
        load_scenario(write_scenario(tmp_path, raw))
