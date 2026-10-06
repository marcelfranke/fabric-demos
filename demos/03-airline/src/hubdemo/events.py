"""The event timeline for the scenario.

The timeline holds three kinds of event: one `departed` event for each background
arrival, the trigger event that starts the story, and the `landed` event of the
inbound flight. Times, delays and the wording of the trigger come from the scenario
file; only the plain sentences of the other events are written here.

The file is one JSON object per line, so a later phase can replay it line by line.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from hubdemo.models import FlightEventRow, Scenario

#: Name of the event file inside the output folder.
EVENTS_FILE = "flight_events.jsonl"


class EventError(ValueError):
    """The event file cannot be read."""


def flight_id_for(flight_no: str) -> str:
    """Turns a flight number into the identifier used across the tables."""
    return flight_no.replace(" ", "")


def _clock(moment: datetime) -> str:
    """The time of day, for plain sentences."""
    return moment.strftime("%H:%M")


def _minutes(later: datetime, earlier: datetime) -> int:
    """Whole minutes between two times."""
    return int((later - earlier).total_seconds() / 60)


def build_events(scenario: Scenario) -> list[FlightEventRow]:
    """Builds the timeline for a scenario, sorted by time."""
    inbound = scenario.inbound
    trigger = scenario.trigger_event
    events: list[FlightEventRow] = []
    for arrival in scenario.background_arrivals:
        events.append(
            FlightEventRow(
                event_time=scenario.sim_now_local,
                flight_id=flight_id_for(arrival.flight_no),
                flight_no=arrival.flight_no,
                event_type="departed",
                eta_local=arrival.eta_local,
                delay_min=_minutes(arrival.eta_local, arrival.sched_local),
                source=trigger.source,
                text=(
                    f"{arrival.flight_no} from {arrival.origin_city} is on its way. "
                    f"Expected at {_clock(arrival.eta_local)}."
                ),
            )
        )
    events.append(
        FlightEventRow(
            event_time=trigger.event_time_local,
            flight_id=trigger.flight_id,
            flight_no=inbound.flight_no,
            event_type=trigger.event_type,
            eta_local=inbound.new_eta_local,
            delay_min=inbound.arrival_delay_min,
            source=trigger.source,
            text=trigger.text,
        )
    )
    events.append(
        FlightEventRow(
            event_time=inbound.new_eta_local,
            flight_id=inbound.id,
            flight_no=inbound.flight_no,
            event_type="landed",
            eta_local=inbound.new_eta_local,
            delay_min=inbound.arrival_delay_min,
            source=trigger.source,
            text=(
                f"{inbound.flight_no} landed at {_clock(inbound.new_eta_local)}, "
                f"{inbound.arrival_delay_min} minutes later than planned."
            ),
        )
    )
    events.sort(key=lambda event: (event.event_time, event.flight_id, event.event_type))
    return events


def write_events(events: list[FlightEventRow], path: Path) -> Path:
    """Writes the timeline as one JSON object per line. Running it again overwrites."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps(event.model_dump(mode="json"), sort_keys=True) for event in events
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def read_events(path: Path) -> list[FlightEventRow]:
    """Reads the timeline back into row models."""
    if not path.exists():
        raise EventError(f"No file at {path}. Run hubdemo generate first.")
    events: list[FlightEventRow] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise EventError(f"Line {number} of {path} is not valid JSON.") from exc
        events.append(FlightEventRow.model_validate(payload))
    return events
