"""Smoke tests.

The package imports, and the scenario file parses and holds the numbers the rest
of the kit asserts against. These two have to hold before anything else is worth
running.

The values checked here are read from the file, never restated: the test asserts
the shape of the contract, not the numbers. Tests that assert the numbers come
with the rules module in a later phase.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

import hubdemo
from hubdemo.config import (
    REQUIRED_KEYS,
    ConfigError,
    config_path,
    get,
    get_optional,
    missing_keys,
    read_config,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_PATH = REPO_ROOT / "scenario" / "qr004.yaml"

TOP_LEVEL_KEYS = (
    "scenario_id",
    "airline_code",
    "hub",
    "timezone",
    "sim_now_local",
    "inbound",
    "rules",
    "onward_flights",
    "cargo_shipments",
    "trigger_event",
    "approval_policy",
    "expected",
)


def load_scenario() -> dict:
    return yaml.safe_load(SCENARIO_PATH.read_text(encoding="utf-8"))


def test_package_imports() -> None:
    assert hubdemo.__version__


def test_scenario_file_exists() -> None:
    assert SCENARIO_PATH.is_file(), f"no scenario file at {SCENARIO_PATH}"


def test_scenario_parses() -> None:
    scenario = load_scenario()
    assert isinstance(scenario, dict)
    for key in TOP_LEVEL_KEYS:
        assert key in scenario, f"scenario/qr004.yaml is missing {key}"


def test_scenario_identifies_itself() -> None:
    scenario = load_scenario()
    assert scenario["scenario_id"] == "qr004-night-bank"


def test_scenario_carries_the_expected_block() -> None:
    """The expected block is the oracle the later phases assert against."""
    expected = load_scenario()["expected"]
    for key in ("totals", "at_risk", "at_risk_totals", "proposal"):
        assert key in expected, f"expected block is missing {key}"
    assert expected["at_risk"], "expected.at_risk must name the at-risk flights"
    assert set(expected["proposal"]) == set(expected["at_risk"]), (
        "every at-risk flight needs a proposed action"
    )


def test_rules_are_numbers_not_text() -> None:
    rules = load_scenario()["rules"]
    assert rules, "scenario/qr004.yaml must carry the rule thresholds"
    for name, value in rules.items():
        assert isinstance(value, int), f"rule {name} must be a whole number of minutes"


def test_example_config_has_every_required_key_and_no_values() -> None:
    """The template is the key contract: all nineteen present, none filled in."""
    values = read_config("example")
    for key in REQUIRED_KEYS:
        assert key in values, f"config/env.example.yaml is missing {key}"
    assert missing_keys(values) == list(REQUIRED_KEYS), (
        "config/env.example.yaml is a template and must carry no values"
    )


def test_loading_the_example_config_fails_with_a_clear_message() -> None:
    try:
        from hubdemo.config import load_config

        load_config("example")
    except ConfigError as exc:
        message = str(exc)
        assert str(config_path("example")) in message
        for key in REQUIRED_KEYS:
            assert key in message, f"the error message should name {key}"
    else:
        raise AssertionError("loading an empty template should raise ConfigError")


def test_get_fails_loud_on_an_empty_value() -> None:
    """Live paths must stop before a network call when a key is still empty."""
    values = read_config("example")
    with pytest.raises(ConfigError):
        get(values, REQUIRED_KEYS[0])


def test_get_optional_returns_the_default_for_an_empty_value() -> None:
    """Dry run paths keep working against the empty template."""
    values = read_config("example")
    assert get_optional(values, REQUIRED_KEYS[0]) == ""
    assert get_optional(values, REQUIRED_KEYS[0], "<not set>") == "<not set>"


def test_get_optional_returns_a_filled_value() -> None:
    values = dict.fromkeys(REQUIRED_KEYS, "")
    values[REQUIRED_KEYS[0]] = "a value"
    assert get_optional(values, REQUIRED_KEYS[0], "<not set>") == "a value"


def test_get_optional_rejects_an_unknown_key() -> None:
    """A typo in a key name is a mistake, not a missing value."""
    with pytest.raises(ConfigError):
        get_optional({}, "fabric.not_a_real_key")
