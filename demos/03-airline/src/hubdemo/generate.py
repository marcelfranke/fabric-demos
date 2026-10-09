"""Deterministic synthetic rows for the scenario.

The generator reads a `Scenario` and writes one Parquet file per reference table in
section 2.1 of docs/demo-spec.md. Every count, time, gate and identifier that belongs
to the story comes from the scenario file; this module only holds invented names,
remark wording and identifier formats, which carry no meaning for the result.

Running the generator twice with the same seed produces the same rows. The extra
inbound flights added by `scale` are built after the scenario rows, so they can never
change a number that the scenario asserts.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from types import UnionType
from typing import Any, Literal, Union, get_args, get_origin

import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import BaseModel

from hubdemo.config import repo_root
from hubdemo.events import EVENTS_FILE, flight_id_for, read_events
from hubdemo.models import (
    ROW_TABLES,
    BagRow,
    BookingRow,
    CargoShipmentRow,
    FlightEventRow,
    FlightRow,
    GateRow,
    InboundFlight,
    MemberRow,
    NextFlight,
    NextFlightRow,
    OnwardFlight,
    PassengerRow,
    Scenario,
    TierBenefitRow,
    TransferRuleRow,
)
from hubdemo.rules import evaluate_plan
from hubdemo.scenario import at_risk_ids, totals, windows

LAKEHOUSE = "lakehouse lh_hub"
PARQUET_TABLES = tuple(table for table in ROW_TABLES if table.store == LAKEHOUSE)

#: The event timeline is landed in the lakehouse as well, so the ontology can bind to it.
EVENTS_TABLE = "ontology_flight_events"

DEFAULT_SEED = 42
DEFAULT_DATA_DIR = "data"

#: Invented given names. No list of real people was read.
GIVEN_NAMES = (
    "Arin", "Belun", "Caras", "Doreth", "Elvin", "Faron", "Gilra", "Hesper",
    "Ivarn", "Jolen", "Kesla", "Lumen", "Marek", "Nerida", "Orvin", "Pellan",
    "Quorra", "Rienne", "Solven", "Tamsin", "Ulreth", "Varan", "Wessa", "Ythan",
)

#: Invented family names. No list of real people was read.
FAMILY_NAMES = (
    "Abrenn", "Bellmore", "Cardon", "Delvane", "Ethrin", "Fennow", "Garrow", "Halvern",
    "Ismay", "Jorrel", "Kessel", "Larkin", "Morrow", "Neave", "Ollander", "Pryor",
    "Quilane", "Renshaw", "Stellin", "Thorne", "Ulvane", "Vendry", "Westley", "Yarrow",
)

#: Harmless remarks, handed out to every REMARK_EVERY-th passenger.
HARMLESS_REMARKS = (
    "Vegetarian meal booked.",
    "Wheelchair to the gate.",
    "Window seat requested.",
)

#: How often a harmless remark appears. A generator choice, not a scenario number.
#: Deliberately not a value that also appears in the scenario file.
REMARK_EVERY = 23

#: Passengers generated for each inbound flight added by --scale.
#: Deliberately not a value that also appears in the scenario file.
SCALE_PAX_PER_FLIGHT = 18

#: Plain wording for the transfer rules. The values come from the scenario file.
RULE_DESCRIPTIONS = {
    "pax_standard_min": (
        "Minutes a connecting passenger needs between arrival and departure "
        "on the normal way through the hub."
    ),
    "pax_fasttrack_min": (
        "Minutes a connecting passenger needs when a team walks them through the hub."
    ),
    "bag_standard_min": (
        "Minutes a checked bag needs to reach the next aircraft on the normal belt."
    ),
    "bag_priority_min": (
        "Minutes a checked bag needs when it is carried across as priority."
    ),
    "cargo_min": "Minutes a cargo shipment needs on the ground between two flights.",
    "margin_min": (
        "Minutes of spare time a plan keeps so a small further delay does not break it."
    ),
    "max_hold_min": "The longest a departure may be held for connecting passengers.",
}

#: Where the tier benefits came from. They are invented for this demo.
TIER_SOURCE_NOTE = (
    "Invented for this demo. The benefits come from the scenario file, "
    "not from a real loyalty programme."
)

RULE_UNIT = "minutes"

_ARROW_TYPES: dict[Any, pa.DataType] = {
    str: pa.string(),
    int: pa.int64(),
    bool: pa.bool_(),
    datetime: pa.timestamp("s"),
}


class GenerateError(ValueError):
    """The scenario cannot be turned into rows, or the rows cannot be read back."""


@dataclass(frozen=True)
class Dataset:
    """One list of rows per reference table, keyed by table name."""

    tables: dict[str, list[BaseModel]]

    def counts(self) -> dict[str, int]:
        """How many rows each table holds."""
        return {name: len(rows) for name, rows in self.tables.items()}


def data_dir(path: str | Path | None = None) -> Path:
    """Turns a folder given on the command line into a path under the project."""
    candidate = Path(path or DEFAULT_DATA_DIR)
    if candidate.is_absolute():
        return candidate
    return repo_root() / candidate


def _arrow_type(annotation: Any) -> pa.DataType:
    """Maps a field annotation to the Parquet column type."""
    origin = get_origin(annotation)
    if origin is Literal:
        return pa.string()
    if origin in (Union, UnionType):
        inner = [arg for arg in get_args(annotation) if arg is not type(None)]
        if len(inner) != 1:
            raise GenerateError(f"Cannot store a field of type {annotation!r}.")
        return _arrow_type(inner[0])
    try:
        return _ARROW_TYPES[annotation]
    except KeyError as exc:
        raise GenerateError(f"Cannot store a field of type {annotation!r}.") from exc


def schema_for(model: type[BaseModel]) -> pa.Schema:
    """The Parquet schema for a row model, written out instead of guessed."""
    return pa.schema(
        [(name, _arrow_type(f.annotation)) for name, f in model.model_fields.items()]
    )


def _clock(moment: datetime) -> str:
    """The time of day, for plain sentences."""
    return moment.strftime("%H:%M")


@dataclass
class _Build:
    """Carries the rows while they are being built."""

    scenario: Scenario
    rng: random.Random
    flights: list[FlightRow] = field(default_factory=list)
    passengers: list[PassengerRow] = field(default_factory=list)
    members: list[MemberRow] = field(default_factory=list)
    bookings: list[BookingRow] = field(default_factory=list)
    bags: list[BagRow] = field(default_factory=list)
    next_flights: list[NextFlightRow] = field(default_factory=list)
    by_onward: dict[str, list[PassengerRow]] = field(
        default_factory=lambda: defaultdict(list)
    )
    terminating: list[PassengerRow] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._passenger_no = itertools.count(1)
        self._booking_no = itertools.count(1)
        self._bag_no = itertools.count(1)
        self._member_no = itertools.count(1)
        self._name_no = itertools.count(0)
        self._names_used: Counter[str] = Counter()

    # Small helpers -------------------------------------------------------

    def name(self) -> str:
        """An invented name, made unique by a counter when it comes round again."""
        index = next(self._name_no)
        given = GIVEN_NAMES[index % len(GIVEN_NAMES)]
        family = FAMILY_NAMES[(index // len(GIVEN_NAMES)) % len(FAMILY_NAMES)]
        name = f"{given} {family}"
        self._names_used[name] += 1
        seen = self._names_used[name]
        return name if seen == 1 else f"{name} {seen}"

    def add_passenger(self) -> PassengerRow:
        """One passenger with an obviously fake passport number and phone number."""
        number = next(self._passenger_no)
        row = PassengerRow(
            passenger_id=f"P{number:07d}",
            display_name=self.name(),
            member_id=None,
            remark_text="",
            passport_no=f"X{number:07d}",
            contact_phone=f"+000 0000 {number:04d}",
            is_synthetic=True,
        )
        self.passengers.append(row)
        return row

    def add_booking(
        self, passenger: PassengerRow, inbound_id: str, onward_id: str | None
    ) -> None:
        """One booking per passenger, with or without an onward flight."""
        self.bookings.append(
            BookingRow(
                booking_id=f"BK{next(self._booking_no):07d}",
                passenger_id=passenger.passenger_id,
                inbound_flight_id=inbound_id,
                onward_flight_id=onward_id,
            )
        )

    def add_bag(
        self, passenger: PassengerRow, inbound_id: str, onward_id: str | None
    ) -> None:
        """One checked bag."""
        self.bags.append(
            BagRow(
                bag_tag=f"B{next(self._bag_no):07d}",
                passenger_id=passenger.passenger_id,
                inbound_flight_id=inbound_id,
                onward_flight_id=onward_id,
            )
        )

    def add_flight(
        self,
        flight_no: str,
        direction: str,
        origin: str,
        destination: str,
        city: str,
        sched_time_local: datetime,
        gate_id: str,
        other_pax_onboard: int,
        flight_id: str | None = None,
    ) -> FlightRow:
        """One row in the flights table."""
        row = FlightRow(
            flight_id=flight_id or flight_id_for(flight_no),
            flight_no=flight_no,
            direction=direction,
            origin=origin,
            destination=destination,
            city=city,
            sched_time_local=sched_time_local,
            gate_id=gate_id,
            other_pax_onboard=other_pax_onboard,
            is_synthetic=True,
        )
        self.flights.append(row)
        return row

    def spread(self, count: int, pool: list[PassengerRow]) -> list[PassengerRow]:
        """Hands out `count` items over `pool`, starting at a seeded position."""
        if count <= 0:
            return []
        if not pool:
            raise GenerateError("Cannot spread bags over a flight with no passengers.")
        offset = self.rng.randrange(len(pool))
        return [pool[(offset + step) % len(pool)] for step in range(count)]

    # The scenario rows ---------------------------------------------------

    def build_flights(self) -> None:
        """The inbound flight, the onward flights, the arrivals and the next flights."""
        scenario = self.scenario
        inbound = scenario.inbound
        self.add_flight(
            flight_no=inbound.flight_no,
            direction="inbound",
            origin=inbound.origin,
            destination=scenario.hub,
            city=inbound.origin_city,
            sched_time_local=inbound.sched_arrival_local,
            gate_id=inbound.gate,
            other_pax_onboard=0,
            flight_id=inbound.id,
        )
        for flight in scenario.onward_flights:
            self.add_flight(
                flight_no=flight.flight_no,
                direction="outbound",
                origin=scenario.hub,
                destination=flight.dest,
                city=flight.city,
                sched_time_local=flight.std_local,
                gate_id=flight.gate,
                other_pax_onboard=flight.other_pax_onboard,
                flight_id=flight.id,
            )
            if flight.next_flight is None:
                continue
            self.add_flight(
                flight_no=flight.next_flight.flight_no,
                direction="outbound",
                origin=scenario.hub,
                destination=flight.dest,
                city=flight.city,
                sched_time_local=flight.next_flight.std_local,
                gate_id="",
                other_pax_onboard=0,
            )
            self.next_flights.append(
                NextFlightRow(
                    onward_flight_id=flight.id,
                    next_flight_no=flight.next_flight.flight_no,
                    next_std_local=flight.next_flight.std_local,
                )
            )
        for arrival in scenario.background_arrivals:
            self.add_flight(
                flight_no=arrival.flight_no,
                direction="inbound",
                origin="",
                destination=scenario.hub,
                city=arrival.origin_city,
                sched_time_local=arrival.sched_local,
                gate_id=arrival.gate,
                other_pax_onboard=0,
            )

    def build_passengers(self) -> None:
        """One passenger per person on the inbound flight, in a seeded order."""
        inbound = self.scenario.inbound
        seats: list[str | None] = []
        for flight in self.scenario.onward_flights:
            seats.extend([flight.id] * flight.connecting_pax)
        if len(seats) != inbound.pax_connecting:
            raise GenerateError(
                "The connecting passengers on the onward flights do not add up to "
                f"{inbound.pax_connecting}."
            )
        ending_here = inbound.pax_onboard - len(seats)
        if ending_here < 0:
            raise GenerateError(
                "The inbound flight carries fewer passengers than it connects."
            )
        seats.extend([None] * ending_here)
        self.rng.shuffle(seats)
        for onward_id in seats:
            passenger = self.add_passenger()
            self.add_booking(passenger, inbound.id, onward_id)
            if onward_id is None:
                self.terminating.append(passenger)
            else:
                self.by_onward[onward_id].append(passenger)

    def build_members(self) -> None:
        """Exactly the tier counts of the scenario file, per onward flight."""
        scenario = self.scenario
        for flight in scenario.onward_flights:
            pool = list(self.by_onward[flight.id])
            self.rng.shuffle(pool)
            taken = 0
            for tier, benefits in scenario.tiers.items():
                for _ in range(flight.members.get(tier, 0)):
                    if taken >= len(pool):
                        raise GenerateError(
                            f"Flight {flight.id} has more members than connecting "
                            "passengers."
                        )
                    passenger = pool[taken]
                    taken += 1
                    member = MemberRow(
                        member_id=f"PC{next(self._member_no):07d}",
                        passenger_id=passenger.passenger_id,
                        tier=tier,
                        lounge_access=benefits.lounge_access,
                        priority_standby=benefits.priority_standby,
                        meet_assist=benefits.meet_assist,
                    )
                    passenger.member_id = member.member_id
                    self.members.append(member)

    def build_bags(self) -> None:
        """Exactly the bag count of the scenario file, plus one bag per ending journey."""
        inbound = self.scenario.inbound
        for flight in self.scenario.onward_flights:
            for passenger in self.spread(flight.bags, self.by_onward[flight.id]):
                self.add_bag(passenger, inbound.id, flight.id)
        for passenger in self.terminating:
            self.add_bag(passenger, inbound.id, None)

    def build_remarks(self) -> None:
        """One poisoned remark, a handful of harmless ones, nothing else."""
        poisoned = self.scenario.security_fixtures.poisoned_remark
        pool = self.by_onward.get(poisoned.on_onward, [])
        if not pool:
            raise GenerateError(
                f"No connecting passenger on {poisoned.on_onward} for the remark test."
            )
        carrier = pool[self.rng.randrange(len(pool))]
        carrier.remark_text = poisoned.text
        rest = [row for row in self.passengers if row is not carrier]
        for position, passenger in enumerate(rest):
            if position % REMARK_EVERY:
                continue
            slot = position // REMARK_EVERY
            passenger.remark_text = HARMLESS_REMARKS[slot % len(HARMLESS_REMARKS)]

    # Volume --------------------------------------------------------------

    def build_scale(self, scale: int) -> None:
        """Extra inbound flights with safe connections, for volume only."""
        if scale <= 0:
            return
        scenario = self.scenario
        rules = scenario.rules
        for step in range(1, scale + 1):
            arrival = scenario.inbound.new_eta_local + timedelta(hours=step)
            inbound_no = f"{scenario.airline_code} 9{step:03d}"
            inbound_id = flight_id_for(inbound_no)
            self.add_flight(
                flight_no=inbound_no,
                direction="inbound",
                origin="",
                destination=scenario.hub,
                city=f"Synthetic city {step}",
                sched_time_local=arrival,
                gate_id=f"Z{step:02d}",
                other_pax_onboard=0,
            )
            onward_ids: list[str] = []
            for slot, gate in enumerate(("Y", "W")):
                onward_no = f"{scenario.airline_code} 9{5 + slot}{step:02d}"
                onward_id = flight_id_for(onward_no)
                onward_ids.append(onward_id)
                self.add_flight(
                    flight_no=onward_no,
                    direction="outbound",
                    origin=scenario.hub,
                    destination="",
                    city=f"Synthetic city {step}",
                    sched_time_local=arrival
                    + timedelta(minutes=rules.pax_standard_min * (slot + 2)),
                    gate_id=f"{gate}{step:02d}",
                    other_pax_onboard=0,
                )
            half = SCALE_PAX_PER_FLIGHT // 2
            seats: list[str | None] = [
                onward_ids[seat % len(onward_ids)] for seat in range(half)
            ]
            seats.extend([None] * (SCALE_PAX_PER_FLIGHT - half))
            self.rng.shuffle(seats)
            for onward_id in seats:
                passenger = self.add_passenger()
                self.add_booking(passenger, inbound_id, onward_id)
                self.add_bag(passenger, inbound_id, onward_id)

    # The tables that are read straight off the scenario -------------------

    def gate_rows(self) -> list[GateRow]:
        """Every gate the flights table mentions, with the concourse letter in front."""
        gates = sorted({row.gate_id for row in self.flights if row.gate_id})
        return [GateRow(gate_id=gate, concourse=gate[0]) for gate in gates]

    def cargo_rows(self) -> list[CargoShipmentRow]:
        """The cargo shipments of the scenario file."""
        return [
            CargoShipmentRow(
                shipment_id=shipment.id,
                inbound_flight_id=self.scenario.inbound.id,
                onward_flight_id=shipment.onward,
                temperature_controlled=shipment.temperature_controlled,
                min_transfer_min=shipment.min_transfer_min,
            )
            for shipment in self.scenario.cargo_shipments
        ]

    def rule_rows(self) -> list[TransferRuleRow]:
        """The transfer rules of the scenario file, with plain wording added."""
        return [
            TransferRuleRow(
                rule_name=name,
                value=value,
                unit=RULE_UNIT,
                description=RULE_DESCRIPTIONS.get(name, ""),
            )
            for name, value in self.scenario.rules.model_dump().items()
        ]

    def tier_rows(self) -> list[TierBenefitRow]:
        """The tier benefits of the scenario file."""
        return [
            TierBenefitRow(
                tier=tier,
                lounge_access=benefits.lounge_access,
                priority_standby=benefits.priority_standby,
                meet_assist=benefits.meet_assist,
                source_note=TIER_SOURCE_NOTE,
            )
            for tier, benefits in self.scenario.tiers.items()
        ]


def build_dataset(scenario: Scenario, seed: int = DEFAULT_SEED, scale: int = 0) -> Dataset:
    """Builds every reference table for a scenario. The same seed gives the same rows."""
    build = _Build(scenario=scenario, rng=random.Random(seed))
    build.build_flights()
    build.build_passengers()
    build.build_members()
    build.build_bags()
    build.build_remarks()
    build.build_scale(scale)
    tables: dict[str, list[BaseModel]] = {
        "flights": list(build.flights),
        "gates": list(build.gate_rows()),
        "passengers": list(build.passengers),
        "members": list(build.members),
        "bookings": list(build.bookings),
        "bags": list(build.bags),
        "cargo_shipments": list(build.cargo_rows()),
        "next_flights": list(build.next_flights),
        "transfer_rules": list(build.rule_rows()),
        "tier_benefits": list(build.tier_rows()),
    }
    missing = [table.table for table in PARQUET_TABLES if table.table not in tables]
    if missing:
        raise GenerateError(f"No rows were built for {', '.join(missing)}.")
    return Dataset(tables=tables)


def write_dataset(dataset: Dataset, out_dir: Path) -> list[Path]:
    """Writes one Parquet file per table. Running it again overwrites the files."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for table in PARQUET_TABLES:
        rows = dataset.tables[table.table]
        arrow = pa.Table.from_pylist(
            [row.model_dump() for row in rows], schema=schema_for(table.model)
        )
        path = out_dir / f"{table.table}.parquet"
        pq.write_table(arrow, path)
        written.append(path)
    return written


def write_events_table(events: list[FlightEventRow], out_dir: Path) -> Path:
    """Writes the event timeline as a Parquet file as well, next to the reference tables.

    The eventhouse holds the live copy of these events. The ontology binds its arrival
    time series to the lakehouse copy instead, because the ontology definition format has
    no way to name an eventhouse table. Running it again overwrites the file.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    arrow = pa.Table.from_pylist(
        [row.model_dump() for row in events], schema=schema_for(FlightEventRow)
    )
    path = out_dir / f"{EVENTS_TABLE}.parquet"
    pq.write_table(arrow, path)
    return path


def read_table(path: Path, model: type[BaseModel]) -> list[BaseModel]:
    """Reads one Parquet file back into row models."""
    if not path.exists():
        raise GenerateError(f"No file at {path}. Run hubdemo generate first.")
    return [model.model_validate(row) for row in pq.read_table(path).to_pylist()]


def read_dataset(out_dir: Path) -> Dataset:
    """Reads every reference table back into row models."""
    tables = {
        table.table: read_table(out_dir / f"{table.table}.parquet", table.model)
        for table in PARQUET_TABLES
    }
    return Dataset(tables=tables)


def dataset_digest(out_dir: Path) -> dict[str, str]:
    """A hash per table over the sorted row contents, not over the file bytes."""
    digest: dict[str, str] = {}
    dataset = read_dataset(out_dir)
    for name, rows in dataset.tables.items():
        digest[name] = _hash_rows(rows)
    events_path = out_dir / EVENTS_FILE
    if events_path.exists():
        digest["flight_events"] = _hash_rows(read_events(events_path))
    return digest


def _hash_rows(rows: list[BaseModel]) -> str:
    """Sorts the rows by their contents and hashes them."""
    lines = sorted(
        json.dumps(row.model_dump(mode="json"), sort_keys=True) for row in rows
    )
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def rebuild_scenario(
    scenario: Scenario, dataset: Dataset, events: list[FlightEventRow]
) -> Scenario:
    """Builds a scenario back out of the rows, so the rules can be run against them.

    Only the rows of the inbound flight named in the scenario are read, so the extra
    flights added by --scale cannot reach any number.
    """
    inbound_id = scenario.inbound.id
    flights = {row.flight_id: row for row in dataset.tables["flights"]}
    if inbound_id not in flights:
        raise GenerateError(f"The flights table has no row for {inbound_id}.")
    passengers = {row.passenger_id: row for row in dataset.tables["passengers"]}
    members = {row.member_id: row for row in dataset.tables["members"]}
    next_flights = {row.onward_flight_id: row for row in dataset.tables["next_flights"]}
    bookings = [
        row for row in dataset.tables["bookings"] if row.inbound_flight_id == inbound_id
    ]
    bags = [row for row in dataset.tables["bags"] if row.inbound_flight_id == inbound_id]
    cargo = [
        row
        for row in dataset.tables["cargo_shipments"]
        if row.inbound_flight_id == inbound_id
    ]

    onward_rows: list[OnwardFlight] = []
    onward_ids = {row.onward_flight_id for row in bookings if row.onward_flight_id}
    for onward_id in sorted(onward_ids):
        if onward_id not in flights:
            raise GenerateError(f"The flights table has no row for {onward_id}.")
        row = flights[onward_id]
        booked = [
            booking.passenger_id
            for booking in bookings
            if booking.onward_flight_id == onward_id
        ]
        tiers: Counter[str] = Counter()
        for passenger_id in booked:
            member_id = passengers[passenger_id].member_id
            if member_id:
                tiers[members[member_id].tier] += 1
        later = next_flights.get(onward_id)
        onward_rows.append(
            OnwardFlight(
                id=onward_id,
                flight_no=row.flight_no,
                dest=row.destination,
                city=row.city,
                std_local=row.sched_time_local,
                gate=row.gate_id,
                other_pax_onboard=row.other_pax_onboard,
                connecting_pax=len(booked),
                bags=len([bag for bag in bags if bag.onward_flight_id == onward_id]),
                members=dict(sorted(tiers.items())),
                next_flight=(
                    None
                    if later is None
                    else NextFlight(
                        flight_no=later.next_flight_no, std_local=later.next_std_local
                    )
                ),
            )
        )
    onward_rows.sort(key=lambda flight: flight.std_local)

    landed = [
        event
        for event in events
        if event.flight_id == inbound_id and event.event_type == "landed"
    ]
    if not landed:
        raise GenerateError(f"The event file has no landed event for {inbound_id}.")
    inbound_row = flights[inbound_id]
    new_eta = landed[-1].event_time
    inbound = InboundFlight(
        id=inbound_id,
        flight_no=inbound_row.flight_no,
        origin=inbound_row.origin,
        origin_city=inbound_row.city,
        sched_arrival_local=inbound_row.sched_time_local,
        new_eta_local=new_eta,
        # No row model carries the departure delay, and no rule reads it.
        departure_delay_min=scenario.inbound.departure_delay_min,
        arrival_delay_min=int(
            (new_eta - inbound_row.sched_time_local).total_seconds() / 60
        ),
        gate=inbound_row.gate_id,
        pax_onboard=len(bookings),
        pax_connecting=len([row for row in bookings if row.onward_flight_id]),
    )
    shipments = [
        {
            "id": row.shipment_id,
            "onward": row.onward_flight_id,
            "temperature_controlled": row.temperature_controlled,
            "min_transfer_min": row.min_transfer_min,
        }
        for row in cargo
    ]
    return Scenario.model_validate(
        {
            **scenario.model_dump(),
            "inbound": inbound,
            "onward_flights": onward_rows,
            "cargo_shipments": shipments,
        }
    )


def _compare(what: str, actual: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    """Reports every key that does not match, in a plain sentence."""
    problems: list[str] = []
    for key in sorted(set(actual) | set(expected)):
        if actual.get(key) != expected.get(key):
            problems.append(
                f"{what} {key}: the rows give {actual.get(key)!r}, "
                f"the scenario expects {expected.get(key)!r}."
            )
    return problems


def check_dataset(scenario: Scenario, out_dir: Path) -> list[str]:
    """Recomputes the scenario from the rows and compares it with the expected block.

    Returns one sentence per mismatch. An empty list means the rows reproduce the
    scenario.
    """
    dataset = read_dataset(out_dir)
    events = read_events(out_dir / EVENTS_FILE)
    rebuilt = rebuild_scenario(scenario, dataset, events)
    expected = scenario.expected
    problems = _compare("Total", totals(rebuilt), expected.totals.model_dump())
    problems += _compare("Window", windows(rebuilt), expected.windows_min)
    actual_at_risk = at_risk_ids(rebuilt)
    if actual_at_risk != expected.at_risk:
        problems.append(
            f"At risk: the rows give {actual_at_risk}, "
            f"the scenario expects {expected.at_risk}."
        )
    outcome = evaluate_plan(rebuilt, expected.proposal).as_outcome()
    problems += _compare("Plan", outcome, expected.proposed_plan.model_dump())
    return problems
