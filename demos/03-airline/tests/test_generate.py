"""Tests for the synthetic row data and the event timeline.

The generator has to reproduce the scenario file exactly, it has to give the same
rows for the same seed, and it must never produce an identifier that could be
mistaken for a real one.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from hubdemo.events import EVENTS_FILE, build_events, read_events, write_events
from hubdemo.generate import (
    DEFAULT_SEED,
    Dataset,
    GenerateError,
    build_dataset,
    check_dataset,
    data_dir,
    dataset_digest,
    read_dataset,
    write_dataset,
)
from hubdemo.models import Scenario
from hubdemo.scenario import load_scenario

OTHER_SEEDS = (7, 2026)
VOLUME = 20

PASSPORT = re.compile(r"^X\d{7}$")
PHONE = re.compile(r"^\+000 0000 \d{4}$")


@pytest.fixture(scope="module")
def scenario() -> Scenario:
    """The scenario file, read once for the whole module."""
    return load_scenario()


def materialise(
    scenario: Scenario,
    folder: Path,
    seed: int = DEFAULT_SEED,
    scale: int = 0,
) -> Dataset:
    """Builds the rows and the events and writes them into a folder."""
    dataset = build_dataset(scenario, seed=seed, scale=scale)
    write_dataset(dataset, folder)
    write_events(build_events(scenario), folder / EVENTS_FILE)
    return dataset


@pytest.fixture(scope="module")
def built(scenario: Scenario, tmp_path_factory: pytest.TempPathFactory) -> tuple[Dataset, Path]:
    """The default dataset, built once and shared by the read-only tests."""
    folder = tmp_path_factory.mktemp("seed-default")
    return materialise(scenario, folder), folder


# The rows reproduce the scenario ------------------------------------------


def test_the_default_seed_reproduces_the_scenario(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    _, folder = built
    assert check_dataset(scenario, folder) == []


@pytest.mark.parametrize("seed", OTHER_SEEDS)
def test_other_seeds_reproduce_the_scenario(
    scenario: Scenario, tmp_path: Path, seed: int
) -> None:
    materialise(scenario, tmp_path, seed=seed)
    assert check_dataset(scenario, tmp_path) == []


def test_volume_leaves_the_results_unchanged(scenario: Scenario, tmp_path: Path) -> None:
    materialise(scenario, tmp_path, scale=VOLUME)
    assert check_dataset(scenario, tmp_path) == []


def test_volume_adds_rows(scenario: Scenario, built: tuple[Dataset, Path], tmp_path: Path) -> None:
    plain, _ = built
    scaled = materialise(scenario, tmp_path, scale=VOLUME)
    assert scaled.counts()["passengers"] > plain.counts()["passengers"]
    assert scaled.counts()["flights"] > plain.counts()["flights"]


def test_volume_leaves_the_member_rows_alone(
    scenario: Scenario, built: tuple[Dataset, Path], tmp_path: Path
) -> None:
    plain, _ = built
    scaled = materialise(scenario, tmp_path, scale=VOLUME)
    assert scaled.counts()["members"] == plain.counts()["members"]
    assert scaled.counts()["cargo_shipments"] == plain.counts()["cargo_shipments"]


# The counts come from the scenario file ------------------------------------


def test_one_passenger_row_per_person_on_board(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    assert dataset.counts()["passengers"] == scenario.inbound.pax_onboard
    assert dataset.counts()["bookings"] == scenario.inbound.pax_onboard


def test_the_member_rows_match_the_expected_total(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    assert dataset.counts()["members"] == scenario.expected.totals.connecting_members


def test_the_bag_rows_cover_the_transfers_and_the_journeys_that_end_here(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    ending_here = scenario.inbound.pax_onboard - scenario.inbound.pax_connecting
    expected = scenario.expected.totals.transfer_bags + ending_here
    assert dataset.counts()["bags"] == expected


def test_the_connecting_bookings_match_the_expected_total(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    connecting = [row for row in dataset.tables["bookings"] if row.onward_flight_id]
    assert len(connecting) == scenario.inbound.pax_connecting


# Nothing in the rows can be mistaken for real data -------------------------


def test_passport_numbers_stay_obviously_fake(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    assert all(PASSPORT.match(row.passport_no) for row in dataset.tables["passengers"])


def test_phone_numbers_stay_obviously_fake(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    assert all(PHONE.match(row.contact_phone) for row in dataset.tables["passengers"])


def test_every_passenger_is_marked_synthetic(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    assert all(row.is_synthetic for row in dataset.tables["passengers"])


def test_every_flight_is_marked_synthetic(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    assert all(row.is_synthetic for row in dataset.tables["flights"])


def test_the_names_are_unique(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    names = [row.display_name for row in dataset.tables["passengers"]]
    assert len(set(names)) == len(names)


def test_the_volume_rows_stay_obviously_fake(scenario: Scenario, tmp_path: Path) -> None:
    dataset = materialise(scenario, tmp_path, scale=VOLUME)
    assert all(PASSPORT.match(row.passport_no) for row in dataset.tables["passengers"])
    assert all(PHONE.match(row.contact_phone) for row in dataset.tables["passengers"])


# The poisoned remark -------------------------------------------------------


def test_the_poisoned_remark_appears_exactly_once(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    wanted = scenario.security_fixtures.poisoned_remark.text
    carriers = [row for row in dataset.tables["passengers"] if row.remark_text == wanted]
    assert len(carriers) == 1


def test_the_poisoned_remark_sits_on_the_named_flight(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    dataset, _ = built
    poisoned = scenario.security_fixtures.poisoned_remark
    carrier = next(
        row for row in dataset.tables["passengers"] if row.remark_text == poisoned.text
    )
    booking = next(
        row
        for row in dataset.tables["bookings"]
        if row.passenger_id == carrier.passenger_id
    )
    assert booking.onward_flight_id == poisoned.on_onward


def test_most_passengers_carry_no_remark(built: tuple[Dataset, Path]) -> None:
    dataset, _ = built
    rows = dataset.tables["passengers"]
    with_remark = [row for row in rows if row.remark_text]
    assert len(with_remark) * 2 < len(rows)


@pytest.mark.parametrize("seed", OTHER_SEEDS)
def test_the_poisoned_remark_survives_another_seed(
    scenario: Scenario, tmp_path: Path, seed: int
) -> None:
    dataset = materialise(scenario, tmp_path, seed=seed)
    wanted = scenario.security_fixtures.poisoned_remark.text
    carriers = [row for row in dataset.tables["passengers"] if row.remark_text == wanted]
    assert len(carriers) == 1


# The same seed gives the same data -----------------------------------------


def test_the_same_seed_gives_the_same_rows(scenario: Scenario, tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    materialise(scenario, first)
    materialise(scenario, second)
    assert dataset_digest(first) == dataset_digest(second)


def test_another_seed_gives_other_rows(scenario: Scenario, tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    materialise(scenario, first)
    materialise(scenario, second, seed=OTHER_SEEDS[0])
    assert dataset_digest(first) != dataset_digest(second)


def test_the_digest_covers_the_event_file(built: tuple[Dataset, Path]) -> None:
    _, folder = built
    assert "flight_events" in dataset_digest(folder)


# Reading the files back ----------------------------------------------------


def test_the_files_read_back_unchanged(built: tuple[Dataset, Path]) -> None:
    dataset, folder = built
    assert read_dataset(folder).counts() == dataset.counts()


def test_a_missing_folder_explains_itself(tmp_path: Path) -> None:
    with pytest.raises(GenerateError, match="hubdemo generate"):
        read_dataset(tmp_path / "nothing-here")


def test_a_missing_folder_fails_the_check(scenario: Scenario, tmp_path: Path) -> None:
    with pytest.raises(GenerateError):
        check_dataset(scenario, tmp_path / "nothing-here")


# The event timeline --------------------------------------------------------


def test_the_timeline_covers_the_background_arrivals(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    _, folder = built
    events = read_events(folder / EVENTS_FILE)
    departed = [row for row in events if row.event_type == "departed"]
    assert len(departed) == len(scenario.background_arrivals)


def test_the_timeline_holds_the_trigger_and_the_landing(built: tuple[Dataset, Path]) -> None:
    _, folder = built
    events = read_events(folder / EVENTS_FILE)
    kinds = [row.event_type for row in events]
    assert kinds.count("eta_update") == 1
    assert kinds.count("landed") == 1


def test_the_timeline_is_in_order(built: tuple[Dataset, Path]) -> None:
    _, folder = built
    events = read_events(folder / EVENTS_FILE)
    times = [row.event_time for row in events]
    assert times == sorted(times)


def test_the_landing_carries_the_new_arrival_time(
    scenario: Scenario, built: tuple[Dataset, Path]
) -> None:
    _, folder = built
    events = read_events(folder / EVENTS_FILE)
    landed = next(row for row in events if row.event_type == "landed")
    assert landed.event_time == scenario.inbound.new_eta_local


# Folders -------------------------------------------------------------------


def test_a_relative_folder_lands_under_the_project() -> None:
    assert data_dir("data").is_absolute()


def test_an_absolute_folder_is_kept(tmp_path: Path) -> None:
    assert data_dir(tmp_path) == tmp_path
