#!/usr/bin/env python
"""Replay the flight events into the eventstream es_flight_events.

Why this script exists
    The generator writes the timeline once, as data/flight_events.jsonl. The demo
    needs those lines to arrive in the eventhouse as live traffic, because the KQL
    function ConnectionWindows reads the latest estimated arrival time from the
    table flight_events, and the Activator rule only fires on a new row.

What it does
    1. Reads config/env.<name>.yaml for the address of the custom endpoint on the
       eventstream es_flight_events.
    2. Reads the timeline back from data/flight_events.jsonl.
    3. Picks the part of the timeline asked for: everything up to the trigger
       event, the trigger event alone, or the whole file.
    4. Sends every line to the custom endpoint with the Event Hubs client, waiting
       between two events for the gap in the timeline divided by --speed.

Usage
    python scripts/replay_events.py --env demo
    python scripts/replay_events.py --env demo --trigger-only
    python scripts/replay_events.py --env demo --all --speed 600
    python scripts/replay_events.py --env demo --dry-run

Sign in
    The client signs in with DefaultAzureCredential, so `az login` is enough and
    no connection string is stored anywhere. The identity needs the Contributor
    role on the workspace. See docs/manual-steps.md.

Each event carries an identifier
    event_id is built from the content of the event, so the same line always gets
    the same identifier. Replaying the file twice therefore writes the same
    identifier again, and the deduplication step inside ConnectionWindows keeps
    one row per event.

Idempotency
    Sending an event a second time does not change the answer of
    ConnectionWindows, because the function keeps the newest row per event_id and
    then the newest estimated arrival time. --dry-run makes no network call and
    needs no filled configuration.

Documentation
    https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/custom-endpoint-entra-id-auth
    https://learn.microsoft.com/azure/event-hubs/event-hubs-python-get-started-send
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from hubdemo.config import (  # noqa: E402
    ConfigError,
    get,
    get_optional,
    missing_keys,
    read_config,
)
from hubdemo.events import EVENTS_FILE, EventError, read_events  # noqa: E402
from hubdemo.generate import data_dir  # noqa: E402
from hubdemo.models import FlightEventRow  # noqa: E402
from hubdemo.scenario import ScenarioError, load_scenario  # noqa: E402

#: Configuration keys that hold the address of the custom endpoint. Both are
#: copied by hand from the Fabric portal, because no documented REST call
#: answers them. See docs/verify-list.md entry V69.
NAMESPACE_KEY = "eventstream.namespace"
EVENT_HUB_KEY = "eventstream.event_hub"

#: What the portal appends to a bare namespace name.
NAMESPACE_SUFFIX = ".servicebus.windows.net"

#: Fixed namespace for the event identifier. It only has to stay the same over
#: time, so that a replay of the same line produces the same identifier again.
EVENT_NAMESPACE = uuid.UUID("7b1f0a52-4c3d-4a0e-9f21-0a1b2c3d0100")

#: How much faster than the clock the timeline is replayed by default.
DEFAULT_SPEED = 60.0

#: The three parts of the timeline this script can send.
UNTIL_TRIGGER = "until-trigger"
TRIGGER_ONLY = "trigger-only"
EVERYTHING = "all"


class ReplayError(RuntimeError):
    """The timeline cannot be replayed."""


def _print(message: str) -> None:
    print(message)


def fully_qualified(namespace: str) -> str:
    """Return the full host name of the event hub namespace.

    The portal shows the namespace sometimes as a bare name and sometimes as a
    host name, so both are accepted and only a bare name gets the suffix.
    https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/custom-endpoint-entra-id-auth
    """
    name = namespace.strip().rstrip("/")
    if name.startswith("sb://"):
        name = name[len("sb://") :].rstrip("/")
    if not name:
        raise ReplayError("the event hub namespace is empty")
    if "." in name:
        return name
    return f"{name}{NAMESPACE_SUFFIX}"


def event_id_for(event: FlightEventRow) -> str:
    """Return the identifier of one event, built from its content."""
    canonical = json.dumps(event.model_dump(mode="json"), sort_keys=True)
    return str(uuid.uuid5(EVENT_NAMESPACE, canonical))


def payload_for(event: FlightEventRow) -> dict[str, Any]:
    """Return the JSON object that is sent for one event."""
    body = event.model_dump(mode="json")
    body["event_id"] = event_id_for(event)
    return body


def select(events: list[FlightEventRow], trigger_type: str, part: str) -> list[FlightEventRow]:
    """Return the part of the timeline that was asked for."""
    if part == EVERYTHING:
        return list(events)
    position = next(
        (index for index, event in enumerate(events) if event.event_type == trigger_type), None
    )
    if position is None:
        raise ReplayError(
            f"no event of type {trigger_type!r} in the timeline. "
            "Run: python -m hubdemo.cli generate --out data"
        )
    if part == TRIGGER_ONLY:
        return [events[position]]
    return events[: position + 1]


def waits(events: list[FlightEventRow], speed: float) -> list[float]:
    """Return the seconds to wait before each event, in the same order."""
    if speed <= 0:
        raise ReplayError("--speed must be greater than zero")
    pauses: list[float] = []
    previous = None
    for event in events:
        if previous is None:
            pauses.append(0.0)
        else:
            gap = (event.event_time - previous).total_seconds()
            pauses.append(max(0.0, gap / speed))
        previous = event.event_time
    return pauses


def describe(event: FlightEventRow, wait: float) -> str:
    """Return one plain line about an event, for the console."""
    moment = event.event_time.strftime("%H:%M:%S")
    return (
        f"{moment}  {event.flight_no:<8} {event.event_type:<10} "
        f"wait {wait:6.2f}s  id {event_id_for(event)}"
    )


def plan(namespace: str, event_hub: str, events: list[FlightEventRow], speed: float) -> list[str]:
    """Return the steps this script would take, as plain lines."""
    pauses = waits(events, speed)
    lines = [
        "1. sign in with DefaultAzureCredential",
        f"2. open the custom endpoint {event_hub} on {namespace}",
        f"3. send {len(events)} event(s), replayed {speed:g} times faster than the clock",
    ]
    lines.extend(
        f"   {describe(event, wait)}" for event, wait in zip(events, pauses, strict=True)
    )
    lines.append(f"4. total wait {sum(pauses):.2f}s")
    return lines


async def send_events(
    namespace: str,
    event_hub: str,
    events: list[FlightEventRow],
    pauses: list[float],
) -> int:
    """Send every event to the custom endpoint and return how many were sent.

    The passwordless pattern of the Event Hubs client, one batch per event so the
    gaps in the timeline are kept.
    https://learn.microsoft.com/azure/event-hubs/event-hubs-python-get-started-send
    """
    from azure.eventhub import EventData
    from azure.eventhub.aio import EventHubProducerClient
    from azure.identity.aio import DefaultAzureCredential

    credential = DefaultAzureCredential()
    producer = EventHubProducerClient(
        fully_qualified_namespace=namespace,
        eventhub_name=event_hub,
        credential=credential,
    )
    sent = 0
    try:
        async with producer:
            for event, wait in zip(events, pauses, strict=True):
                if wait > 0:
                    await asyncio.sleep(wait)
                batch = await producer.create_batch()
                batch.add(EventData(json.dumps(payload_for(event), sort_keys=True)))
                await producer.send_batch(batch)
                sent += 1
                _print(f"sent {describe(event, wait)}")
    finally:
        await credential.close()
    return sent


def read_timeline(directory: Path) -> list[FlightEventRow]:
    """Read the generated timeline back from disk."""
    return read_events(directory / EVENTS_FILE)


def chosen_part(args: argparse.Namespace) -> str:
    """Return which part of the timeline the flags ask for."""
    if args.trigger_only:
        return TRIGGER_ONLY
    if args.all:
        return EVERYTHING
    return UNTIL_TRIGGER


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--data", default=None, help="directory holding the generated files")
    parser.add_argument("--scenario", default=None, help="path of the scenario file")
    parser.add_argument(
        "--speed",
        type=float,
        default=DEFAULT_SPEED,
        help=f"how many times faster than the clock, default {DEFAULT_SPEED:g}",
    )
    part = parser.add_mutually_exclusive_group()
    part.add_argument(
        "--until-trigger",
        action="store_true",
        help="send everything up to and including the trigger event, the default",
    )
    part.add_argument("--trigger-only", action="store_true", help="send the trigger event alone")
    part.add_argument("--all", action="store_true", help="send the whole timeline")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    directory = Path(args.data) if args.data else data_dir()

    try:
        scenario = load_scenario(args.scenario)
    except (ScenarioError, OSError) as error:
        _print(f"the scenario file cannot be read: {error}")
        return 1
    trigger_type = scenario.trigger_event.event_type

    try:
        events = select(read_timeline(directory), trigger_type, chosen_part(args))
    except (EventError, ReplayError) as error:
        _print(str(error))
        return 1

    if args.dry_run:
        try:
            values = read_config(args.env)
        except ConfigError:
            values = {}
            namespace = f"<{NAMESPACE_KEY}>"
            event_hub = f"<{EVENT_HUB_KEY}>"
        else:
            namespace = str(get_optional(values, NAMESPACE_KEY, f"<{NAMESPACE_KEY}>"))
            event_hub = str(get_optional(values, EVENT_HUB_KEY, f"<{EVENT_HUB_KEY}>"))
        try:
            for line in plan(namespace, event_hub, events, args.speed):
                _print(line)
        except ReplayError as error:
            _print(str(error))
            return 1
        if not values:
            _print(f"no configuration found for environment {args.env!r}")
        else:
            empty = [key for key in (NAMESPACE_KEY, EVENT_HUB_KEY) if key in missing_keys(values)]
            if empty:
                _print("still empty in the configuration: " + ", ".join(empty))
        _print("dry run, no network call was made")
        return 0

    try:
        values = read_config(args.env)
    except ConfigError as error:
        _print(str(error))
        return 1
    empty = [key for key in (NAMESPACE_KEY, EVENT_HUB_KEY) if key in missing_keys(values)]
    if empty:
        _print("fill these keys before running: " + ", ".join(empty))
        _print("They are copied from the custom endpoint in the portal, see docs/manual-steps.md")
        return 1

    try:
        namespace = fully_qualified(str(get(values, NAMESPACE_KEY)))
        pauses = waits(events, args.speed)
    except ReplayError as error:
        _print(str(error))
        return 1
    event_hub = str(get(values, EVENT_HUB_KEY))

    _print(f"sending {len(events)} event(s) to {event_hub} on {namespace}")
    sent = asyncio.run(send_events(namespace, event_hub, events, pauses))
    _print(f"sent {sent} event(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
