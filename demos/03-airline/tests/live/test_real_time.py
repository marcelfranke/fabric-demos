"""Live checks for the real time path built in phase 5.

These tests reach a real tenant. They are skipped unless HUBDEMO_LIVE=1 is set,
unless the demo config file carries the two eventstream keys, and unless the
optional azure-eventhub dependency is installed. A plain "pytest -q" run
therefore stays offline and green.

What it proves
    The trigger event from scenario/qr004.yaml is sent to the custom endpoint of
    the eventstream, lands in the flight_events table of the eventhouse, and the
    ConnectionWindows() function then returns the connections at risk. The
    numbers are compared against scenario/qr004.yaml only, never against
    literals in this file.

    The last test sends the same trigger a second time. The KQL function dedups
    on event_id, and the replay script derives that id with a deterministic
    uuid5, so a second send must not change the answer.

How it connects
    Events go out over AMQP with the Event Hubs producer client.
    https://learn.microsoft.com/azure/event-hubs/event-hubs-python-get-started-send

    Queries go to the eventhouse over the Kusto REST query endpoint.
    https://learn.microsoft.com/kusto/api/rest/query?view=microsoft-fabric

How it signs in
    AzureCliCredential for the query side and DefaultAzureCredential inside the
    replay script for the send side. No secrets live in this repository.
    https://learn.microsoft.com/python/api/overview/azure/identity-readme

Before the first run
    1. az login
    2. python -m hubdemo.cli generate --out data
    3. python fabric/deploy.py --env demo
    4. python scripts/load_kql_reference.py --env demo
    5. fill eventstream.namespace and eventstream.event_hub in the demo config
       file, see docs/manual-steps.md
    6. give the signed in identity Contributor on the workspace
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import time
from pathlib import Path
from typing import Any

import pytest

# The send side needs the Event Hubs client. Skip the whole module when it is
# missing so an offline machine never fails on an optional dependency.
pytest.importorskip("azure.eventhub", reason="azure-eventhub is only needed for live tests")

from hubdemo.config import ConfigError, get_optional, read_config  # noqa: E402
from hubdemo.events import EVENTS_FILE  # noqa: E402
from hubdemo.fabric_api import (  # noqa: E402
    EVENTHOUSE_ITEM,
    KQL_DATABASE,
    FabricApiError,
    eventhouse_query_uri,
    find_by_display_name,
    get_eventhouse,
    get_kusto_token,
    get_token,
    kusto_records,
    kusto_request,
    list_items,
    list_workspaces,
)
from hubdemo.generate import data_dir  # noqa: E402
from hubdemo.scenario import ScenarioError, at_risk_ids, load_scenario, windows  # noqa: E402

LIVE_ENV = "HUBDEMO_LIVE"
CONFIG_ENV = "HUBDEMO_ENV"
TIMEOUT_ENV = "HUBDEMO_REPLAY_TIMEOUT"

DEFAULT_CONFIG = "demo"
DEFAULT_TIMEOUT = 240.0
POLL_SECONDS = 5.0
WORKSPACE_KEY = "fabric.workspace_name"
NAMESPACE_KEY = "eventstream.namespace"
EVENT_HUB_KEY = "eventstream.event_hub"
EVENTHOUSE_TYPE = "Eventhouse"

REPO_ROOT = Path(__file__).resolve().parents[2]

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.environ.get(LIVE_ENV) != "1",
        reason=f"set {LIVE_ENV}=1 to run the live real time checks",
    ),
]


def load_replay() -> Any:
    """Import scripts/replay_events.py, which is not part of the package."""
    path = REPO_ROOT / "scripts" / "replay_events.py"
    spec = importlib.util.spec_from_file_location("_hubdemo_live_replay", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def timeout_seconds() -> float:
    """How long to wait for an event to show up in the eventhouse."""
    raw = os.environ.get(TIMEOUT_ENV, "").strip()
    if not raw:
        return DEFAULT_TIMEOUT
    return float(raw)


def resolve_service_uri(token: str, workspace_name: str) -> str:
    """Find the query endpoint of the eventhouse in the demo workspace.

    https://learn.microsoft.com/rest/api/fabric/eventhouse/items/get-eventhouse
    """
    workspace = find_by_display_name(list_workspaces(token), workspace_name)
    if workspace is None:
        raise FabricApiError(f"workspace not found: {workspace_name}")
    workspace_id = str(workspace.get("id", ""))
    items = list_items(token, workspace_id, item_type=EVENTHOUSE_TYPE)
    eventhouse = find_by_display_name(items, EVENTHOUSE_ITEM)
    if eventhouse is None:
        raise FabricApiError(f"eventhouse not found: {EVENTHOUSE_ITEM}")
    full = get_eventhouse(token, workspace_id, str(eventhouse.get("id", "")))
    return eventhouse_query_uri(full)


def connection_windows(service_uri: str, token: str, flight_id: str) -> list[dict[str, Any]]:
    """Call ConnectionWindows() in the eventhouse and return its rows."""
    # The flight id comes from scenario/qr004.yaml in this repository, never
    # from user input, so a plain format string is safe here.
    command = f'ConnectionWindows("{flight_id}")'
    payload = kusto_request(service_uri, KQL_DATABASE, command, token)
    return kusto_records(payload)


def at_risk_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the rows the KQL function marked as at risk."""
    return [row for row in rows if row.get("at_risk")]


def has_eta(rows: list[dict[str, Any]]) -> bool:
    """True once the trigger event has been ingested and the ETA is filled in."""
    return bool(rows) and all(row.get("eta_local") for row in rows)


def wait_for_windows(service_uri: str, token: str, flight_id: str) -> list[dict[str, Any]]:
    """Poll ConnectionWindows() until the new ETA shows up, then return the rows."""
    deadline = time.monotonic() + timeout_seconds()
    rows: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        rows = connection_windows(service_uri, token, flight_id)
        if has_eta(rows):
            return rows
        time.sleep(POLL_SECONDS)
    pytest.fail(
        f"ConnectionWindows({flight_id}) still had no ETA after "
        f"{timeout_seconds():.0f}s, got {len(rows)} rows"
    )
    return rows


def send_trigger(replay: Any, namespace: str, event_hub: str, directory: Path) -> int:
    """Send the single trigger event from the generated timeline."""
    scenario = load_scenario()
    events = replay.read_timeline(directory)
    chosen = replay.select(events, scenario.trigger_event.event_type, replay.TRIGGER_ONLY)
    pauses = replay.waits(chosen, replay.DEFAULT_SPEED)
    return asyncio.run(replay.send_events(namespace, event_hub, chosen, pauses))


@pytest.fixture(scope="module")
def scenario() -> Any:
    """The scenario contract, the only source of the asserted numbers."""
    try:
        return load_scenario()
    except ScenarioError as error:  # pragma: no cover - live only
        pytest.skip(f"scenario file is not usable: {error}")


@pytest.fixture(scope="module")
def values() -> dict[str, Any]:
    """The demo config file, without demanding that every key is filled in."""
    name = os.environ.get(CONFIG_ENV, "").strip() or DEFAULT_CONFIG
    try:
        return read_config(name)
    except ConfigError as error:  # pragma: no cover - live only
        pytest.skip(f"config/env.{name}.yaml is not usable: {error}")


@pytest.fixture(scope="module")
def endpoint(values: dict[str, Any]) -> tuple[str, str]:
    """The custom endpoint address a person copied out of the portal."""
    namespace = str(get_optional(values, NAMESPACE_KEY))
    event_hub = str(get_optional(values, EVENT_HUB_KEY))
    if not namespace or not event_hub:
        pytest.skip(f"fill {NAMESPACE_KEY} and {EVENT_HUB_KEY}, see docs/manual-steps.md")
    replay = load_replay()
    return replay.fully_qualified(namespace), event_hub


@pytest.fixture(scope="module")
def timeline() -> Path:
    """The folder holding the generated event timeline."""
    directory = data_dir()
    if not (directory / EVENTS_FILE).is_file():
        pytest.skip("run: python -m hubdemo.cli generate --out data")
    return directory


@pytest.fixture(scope="module")
def query_token() -> str:
    """An access token for the Kusto query endpoint of the eventhouse."""
    from azure.identity import AzureCliCredential

    return get_kusto_token(AzureCliCredential(process_timeout=120))


@pytest.fixture(scope="module")
def service_uri(values: dict[str, Any]) -> str:
    """The query endpoint of the eventhouse in the demo workspace."""
    from azure.identity import AzureCliCredential

    workspace_name = str(get_optional(values, WORKSPACE_KEY))
    if not workspace_name:
        pytest.skip(f"fill {WORKSPACE_KEY} in the demo config file")
    token = get_token(AzureCliCredential(process_timeout=120))
    try:
        return resolve_service_uri(token, workspace_name)
    except FabricApiError as error:  # pragma: no cover - live only
        pytest.skip(f"cannot reach the eventhouse: {error}")


@pytest.fixture(scope="module")
def replayed(
    endpoint: tuple[str, str],
    timeline: Path,
    service_uri: str,
    query_token: str,
    scenario: Any,
) -> list[dict[str, Any]]:
    """Send the trigger once and return the connection windows it produced."""
    replay = load_replay()
    namespace, event_hub = endpoint
    sent = send_trigger(replay, namespace, event_hub, timeline)
    assert sent == 1, f"expected one trigger event, sent {sent}"
    return wait_for_windows(service_uri, query_token, scenario.inbound.id)


def test_the_trigger_event_reaches_the_eventhouse(
    replayed: list[dict[str, Any]],
    scenario: Any,
) -> None:
    """One event over AMQP ends up in a KQL answer within the timeout."""
    expected = len(windows(scenario))
    assert len(replayed) == expected, (
        f"ConnectionWindows returned {len(replayed)} rows, "
        f"the scenario has {expected} onward flights"
    )


def test_the_new_eta_is_the_one_from_the_scenario(
    replayed: list[dict[str, Any]],
    scenario: Any,
) -> None:
    """Every row carries the new ETA that the trigger event announced."""
    expected = scenario.inbound.new_eta_local.isoformat()
    for row in replayed:
        actual = str(row.get("eta_local", ""))
        assert actual.startswith(expected), (
            f"{row.get('onward_flight_id')}: eventhouse says {actual}, "
            f"the scenario says {expected}"
        )


def test_the_connection_windows_match_the_scenario(
    replayed: list[dict[str, Any]],
    scenario: Any,
) -> None:
    """Each window in minutes equals the one the scenario file states."""
    expected = windows(scenario)
    for row in replayed:
        onward = str(row.get("onward_flight_id", ""))
        assert onward in expected, f"unexpected onward flight {onward}"
        assert row.get("window_min") == expected[onward], (
            f"{onward}: eventhouse says {row.get('window_min')} minutes, "
            f"the scenario says {expected[onward]}"
        )


def test_the_connections_at_risk_match_the_scenario(
    replayed: list[dict[str, Any]],
    scenario: Any,
) -> None:
    """The at risk flag reproduces the at risk list of the scenario."""
    expected = sorted(at_risk_ids(scenario))
    actual = sorted(str(row.get("onward_flight_id", "")) for row in at_risk_rows(replayed))
    assert actual == expected, f"eventhouse says {actual}, the scenario says {expected}"


def test_sending_the_trigger_twice_keeps_the_same_answer(
    replayed: list[dict[str, Any]],
    endpoint: tuple[str, str],
    timeline: Path,
    service_uri: str,
    query_token: str,
    scenario: Any,
) -> None:
    """A repeated send dedups on event_id, so the answer does not change."""
    replay = load_replay()
    namespace, event_hub = endpoint
    sent = send_trigger(replay, namespace, event_hub, timeline)
    assert sent == 1, f"expected one trigger event, sent {sent}"
    again = wait_for_windows(service_uri, query_token, scenario.inbound.id)
    expected = sorted(at_risk_ids(scenario))
    actual = sorted(str(row.get("onward_flight_id", "")) for row in at_risk_rows(again))
    assert actual == expected, f"after the second send {actual}, the scenario says {expected}"
    assert len(again) == len(replayed), (
        f"after the second send {len(again)} rows, the first send gave {len(replayed)}"
    )
