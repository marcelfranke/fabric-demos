"""Offline checks for the Fabric item definitions and the Fabric helper code.

These tests never reach a tenant. They check that the files under fabric/workspace/
are well formed and that the pure helpers in src/hubdemo/fabric_api.py and in the
two scripts behave. The live counterpart is tests/live/test_fabric_foundation.py.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
import yaml

from hubdemo.fabric_api import (
    FABRIC_API_ROOT,
    LAKEHOUSE_ITEM,
    LANDING_PATH,
    FabricApiError,
    create_workspace_body,
    find_by_display_name,
    iter_pages,
    landing_path,
    next_token,
    onelake_path,
    page_items,
    paged_url,
    retry_after_seconds,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = REPO_ROOT / "fabric" / "workspace"

ITEM_FOLDERS = {
    "lh_hub.Lakehouse": "Lakehouse",
    "eh_hub.Eventhouse": "Eventhouse",
    "hubdb.KQLDatabase": "KQLDatabase",
    "sqldb_hub_ops.SQLDatabase": "SQLDatabase",
    "nb_load_reference.Notebook": "Notebook",
}

SQL_TABLES = ("plans", "approvals", "actions", "security_events")


def _load_script(name: str):
    """Import a file from scripts/ or fabric/ that is not part of the package."""
    candidates = [REPO_ROOT / "scripts" / f"{name}.py", REPO_ROOT / "fabric" / f"{name}.py"]
    path = next(p for p in candidates if p.is_file())
    spec = importlib.util.spec_from_file_location(f"_hubdemo_script_{name}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------- item definitions


@pytest.mark.parametrize("folder", sorted(ITEM_FOLDERS))
def test_item_folder_exists(folder: str) -> None:
    assert (WORKSPACE_DIR / folder).is_dir()


@pytest.mark.parametrize("folder", sorted(ITEM_FOLDERS))
def test_platform_file_is_complete(folder: str) -> None:
    data = json.loads((WORKSPACE_DIR / folder / ".platform").read_text(encoding="utf-8"))
    assert data["metadata"]["type"] == ITEM_FOLDERS[folder]
    assert data["metadata"]["displayName"] == folder.split(".")[0]
    assert data["metadata"]["description"].strip()
    assert data["config"]["logicalId"]


def test_logical_ids_are_unique() -> None:
    ids = []
    for folder in ITEM_FOLDERS:
        data = json.loads((WORKSPACE_DIR / folder / ".platform").read_text(encoding="utf-8"))
        ids.append(data["config"]["logicalId"])
    assert len(set(ids)) == len(ids)


def test_lakehouse_metadata_is_json() -> None:
    path = WORKSPACE_DIR / "lh_hub.Lakehouse" / "lakehouse.metadata.json"
    assert isinstance(json.loads(path.read_text(encoding="utf-8")), dict)


def test_eventhouse_properties_are_empty() -> None:
    path = WORKSPACE_DIR / "eh_hub.Eventhouse" / "EventhouseProperties.json"
    assert json.loads(path.read_text(encoding="utf-8")) == {}


def test_kql_database_points_at_the_eventhouse() -> None:
    eventhouse = json.loads(
        (WORKSPACE_DIR / "eh_hub.Eventhouse" / ".platform").read_text(encoding="utf-8")
    )
    database = json.loads(
        (WORKSPACE_DIR / "hubdb.KQLDatabase" / "DatabaseProperties.json").read_text(
            encoding="utf-8"
        )
    )
    assert database["parentEventhouseItemId"] == eventhouse["config"]["logicalId"]
    assert database["databaseType"] == "ReadWrite"


def test_kql_schema_creates_the_event_table_and_the_function() -> None:
    text = (WORKSPACE_DIR / "hubdb.KQLDatabase" / "DatabaseSchema.kql").read_text(encoding="utf-8")
    assert ".create-merge table flight_events" in text
    assert "ingestion json mapping" in text
    assert "ConnectionWindows" in text


def test_kql_schema_uses_only_allowed_commands() -> None:
    """Only these commands are allowed in DatabaseSchema.kql.

    https://learn.microsoft.com/fabric/real-time-intelligence/git-eventhouse-kql-database
    """
    allowed = (
        ".create-merge table",
        ".create-or-alter function",
        ".create-or-alter materialized-view",
        ".create-or-alter table",
        ".alter table",
        ".alter ",
    )
    text = (WORKSPACE_DIR / "hubdb.KQLDatabase" / "DatabaseSchema.kql").read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("."):
            assert stripped.startswith(allowed), stripped


def test_sql_project_file_is_the_only_one() -> None:
    folder = WORKSPACE_DIR / "sqldb_hub_ops.SQLDatabase"
    assert [path.name for path in folder.glob("*.sqlproj")] == ["sqldb.sqlproj"]


@pytest.mark.parametrize("table", SQL_TABLES)
def test_sql_table_file_creates_that_table(table: str) -> None:
    path = WORKSPACE_DIR / "sqldb_hub_ops.SQLDatabase" / "dbo" / "Tables" / f"{table}.sql"
    text = path.read_text(encoding="utf-8")
    assert f"[dbo].[{table}]" in text
    assert "CREATE TABLE" in text


def test_notebook_reads_the_landing_folder() -> None:
    path = WORKSPACE_DIR / "nb_load_reference.Notebook" / "notebook-content.py"
    text = path.read_text(encoding="utf-8")
    assert text.startswith("# Fabric notebook source")
    assert LANDING_PATH in text
    assert "saveAsTable" in text


def test_notebook_placeholders_are_in_parameter_file() -> None:
    notebook = (WORKSPACE_DIR / "nb_load_reference.Notebook" / "notebook-content.py").read_text(
        encoding="utf-8"
    )
    parameters = yaml.safe_load((WORKSPACE_DIR / "parameter.yml").read_text(encoding="utf-8"))
    found = [entry["find_value"] for entry in parameters["find_replace"]]
    assert found
    for value in found:
        assert value in notebook


def test_parameter_file_targets_the_notebook() -> None:
    parameters = yaml.safe_load((WORKSPACE_DIR / "parameter.yml").read_text(encoding="utf-8"))
    for entry in parameters["find_replace"]:
        assert entry["item_type"] == "Notebook"
        assert entry["item_name"] == "nb_load_reference"
        assert "demo" in entry["replace_value"]


# ---------------------------------------------------------------- fabric_api helpers


def test_page_items_reads_the_value_list() -> None:
    assert page_items({"value": [{"id": "a"}]}) == [{"id": "a"}]


def test_page_items_rejects_a_non_list() -> None:
    with pytest.raises(FabricApiError):
        page_items({"value": "a"})


def test_next_token_is_none_when_absent() -> None:
    assert next_token({"value": []}) is None
    assert next_token({"continuationToken": "t"}) == "t"


def test_paged_url_adds_the_right_separator() -> None:
    assert paged_url("https://x/v1/workspaces", None) == "https://x/v1/workspaces"
    assert "?continuationToken=t" in paged_url("https://x/v1/workspaces", "t")
    assert "&continuationToken=t" in paged_url("https://x/v1/workspaces?roles=Admin", "t")


def test_iter_pages_follows_the_continuation_token() -> None:
    pages = [
        {"value": [{"id": "a"}], "continuationToken": "t"},
        {"value": [{"id": "b"}]},
    ]
    seen: list[str] = []

    def fetch(method: str, url: str, token: str) -> dict:
        seen.append(url)
        return pages[len(seen) - 1]

    rows = list(iter_pages(f"{FABRIC_API_ROOT}/workspaces", "x", fetch=fetch))
    assert [row["id"] for row in rows] == ["a", "b"]
    assert "continuationToken=t" in seen[1]


def test_iter_pages_stops_at_the_page_limit() -> None:
    def fetch(method: str, url: str, token: str) -> dict:
        return {"value": [], "continuationToken": "t"}

    with pytest.raises(FabricApiError):
        list(iter_pages(f"{FABRIC_API_ROOT}/workspaces", "x", fetch=fetch, max_pages=2))


def test_find_by_display_name_ignores_case_and_spaces() -> None:
    rows = [{"displayName": "Hub Demo", "id": "1"}]
    assert find_by_display_name(rows, " hub demo ")["id"] == "1"
    assert find_by_display_name(rows, "other") is None


def test_create_workspace_body_needs_both_values() -> None:
    body = create_workspace_body("Hub Demo", "cap-1", "note")
    assert body["displayName"] == "Hub Demo"
    assert body["capacityId"] == "cap-1"
    assert body["description"] == "note"
    with pytest.raises(FabricApiError):
        create_workspace_body("", "cap-1")
    with pytest.raises(FabricApiError):
        create_workspace_body("Hub Demo", "")


def test_retry_after_seconds_falls_back() -> None:
    assert retry_after_seconds({"Retry-After": "7"}) == 7
    assert retry_after_seconds({"retry-after": "7"}) == 7
    assert retry_after_seconds({}) > 0
    assert retry_after_seconds({"Retry-After": "nonsense"}) > 0
    assert retry_after_seconds({"Retry-After": "0"}) > 0


def test_onelake_path_builds_the_documented_shape() -> None:
    """https://learn.microsoft.com/fabric/onelake/onelake-access-api"""
    assert onelake_path("lh_hub", "Files", "landing") == "lh_hub.Lakehouse/Files/landing"
    assert landing_path(LAKEHOUSE_ITEM, "flights.parquet").endswith(
        "Files/landing/flights.parquet"
    )
    assert landing_path(LAKEHOUSE_ITEM) == f"{LAKEHOUSE_ITEM}.Lakehouse/{LANDING_PATH}"


# ---------------------------------------------------------------- the three scripts


def test_bootstrap_plan_names_both_resources() -> None:
    module = _load_script("fabric_bootstrap")
    lines = module.plan("cap", "ws")
    assert any("cap" in line for line in lines)
    assert any("ws" in line for line in lines)


def test_bootstrap_dry_run_makes_no_call(capsys: pytest.CaptureFixture[str]) -> None:
    module = _load_script("fabric_bootstrap")
    assert module.main(["--env", "example", "--dry-run"]) == 0
    assert "no network call" in capsys.readouterr().out


def test_upload_expects_one_file_per_lakehouse_table() -> None:
    module = _load_script("upload_landing")
    names = module.expected_file_names()
    assert "flights.parquet" in names
    assert names == sorted(names)
    assert module.missing_file_names([Path("flights.parquet")]) == [
        name for name in names if name != "flights.parquet"
    ]


def test_upload_dry_run_makes_no_call(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    module = _load_script("upload_landing")
    for name in module.expected_file_names():
        (tmp_path / name).write_bytes(b"")
    code = module.main(["--env", "example", "--data", str(tmp_path), "--dry-run"])
    assert code == 0
    assert "no network call" in capsys.readouterr().out


def test_upload_reports_a_missing_folder(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _load_script("upload_landing")
    code = module.main(["--env", "example", "--data", str(tmp_path / "gone"), "--dry-run"])
    assert code == 1
    assert "generate" in capsys.readouterr().out


def test_deploy_plan_lists_every_item_folder() -> None:
    module = _load_script("deploy")
    lines = module.plan("ws", WORKSPACE_DIR)
    text = "\n".join(lines)
    for folder in ITEM_FOLDERS:
        assert folder in text
    assert "nothing is removed" in text


def test_deploy_scope_matches_the_item_folders() -> None:
    module = _load_script("deploy")
    types = {folder.split(".")[1] for folder in ITEM_FOLDERS}
    assert types == set(module.ITEM_TYPES)


def test_deploy_dry_run_makes_no_call(capsys: pytest.CaptureFixture[str]) -> None:
    module = _load_script("deploy")
    assert module.main(["--env", "example", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "no network call" in out
    assert "parameter.yml" in out
