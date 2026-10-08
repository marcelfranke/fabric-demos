"""Offline checks for the Fabric item definitions and the Fabric helper code.

These tests never reach a tenant. They check that the files under fabric/workspace/
are well formed and that the pure helpers in src/hubdemo/fabric_api.py and in the
two scripts behave. The live counterpart is tests/live/test_fabric_foundation.py.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

import pytest
import yaml

from hubdemo.events import EVENTS_FILE, build_events, write_events
from hubdemo.fabric_api import (
    CUSTOM_ENDPOINT_TYPE,
    EVENTHOUSE_ITEM,
    EVENTSTREAM_ITEM,
    FABRIC_API_ROOT,
    KQL_DATABASE,
    KUSTO_MGMT_PATH,
    KUSTO_QUERY_PATH,
    KUSTO_SCOPE,
    LAKEHOUSE_ITEM,
    LANDING_PATH,
    FabricApiError,
    create_workspace_body,
    custom_endpoint_source,
    endpoint_address,
    eventhouse_query_uri,
    eventstream_source_connection,
    eventstream_topology,
    find_by_display_name,
    iter_pages,
    kusto_body,
    kusto_columns,
    kusto_datatable,
    kusto_escape,
    kusto_headers,
    kusto_literal,
    kusto_records,
    kusto_rows,
    kusto_set_or_replace,
    kusto_url,
    landing_path,
    next_token,
    onelake_path,
    page_items,
    paged_url,
    retry_after_seconds,
)
from hubdemo.scenario import load_scenario

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = REPO_ROOT / "fabric" / "workspace"

ITEM_FOLDERS = {
    "lh_hub.Lakehouse": "Lakehouse",
    "eh_hub.Eventhouse": "Eventhouse",
    "hubdb.KQLDatabase": "KQLDatabase",
    "sqldb_hub_ops.SQLDatabase": "SQLDatabase",
    "nb_load_reference.Notebook": "Notebook",
    "es_flight_events.Eventstream": "Eventstream",
    "pl_on_delay.DataPipeline": "DataPipeline",
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
    found = [
        entry["find_value"]
        for entry in parameters["find_replace"]
        if entry["item_name"] == "nb_load_reference"
    ]
    assert found
    for value in found:
        assert value in notebook


def test_eventstream_placeholders_are_in_the_eventstream_file() -> None:
    stream = (WORKSPACE_DIR / "es_flight_events.Eventstream" / "eventstream.json").read_text(
        encoding="utf-8"
    )
    parameters = yaml.safe_load((WORKSPACE_DIR / "parameter.yml").read_text(encoding="utf-8"))
    found = [
        entry["find_value"]
        for entry in parameters["find_replace"]
        if entry["item_name"] == "es_flight_events"
    ]
    assert len(found) == 3
    for value in found:
        assert value in stream


def test_parameter_file_targets_items_this_demo_deploys() -> None:
    parameters = yaml.safe_load((WORKSPACE_DIR / "parameter.yml").read_text(encoding="utf-8"))
    names = {folder.split(".")[0]: folder.split(".")[1] for folder in ITEM_FOLDERS}
    assert parameters["find_replace"]
    for entry in parameters["find_replace"]:
        assert entry["item_name"] in names
        assert entry["item_type"] == names[entry["item_name"]]
        assert "demo" in entry["replace_value"]
        assert entry["replace_value"]["demo"]

def _eventstream() -> dict:
    path = WORKSPACE_DIR / "es_flight_events.Eventstream" / "eventstream.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _pipeline_text() -> str:
    path = WORKSPACE_DIR / "pl_on_delay.DataPipeline" / "pipeline-content.json"
    return path.read_text(encoding="utf-8")


def _kql_schema() -> str:
    path = WORKSPACE_DIR / "hubdb.KQLDatabase" / "DatabaseSchema.kql"
    return path.read_text(encoding="utf-8")


def test_item_name_constants_match_the_item_folders() -> None:
    names = {folder.split(".")[0] for folder in ITEM_FOLDERS}
    assert {LAKEHOUSE_ITEM, EVENTHOUSE_ITEM, EVENTSTREAM_ITEM} <= names


def test_eventstream_wires_the_custom_endpoint_to_both_destinations() -> None:
    """An eventstream definition is a graph of sources, streams and destinations.

    https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/overview
    https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-source-custom-app
    """
    stream = _eventstream()
    assert [source["type"] for source in stream["sources"]] == ["CustomEndpoint"]
    assert [node["type"] for node in stream["streams"]] == ["DefaultStream"]
    assert stream["streams"][0]["inputNodes"][0]["name"] == stream["sources"][0]["name"]
    assert stream["operators"] == []
    assert stream["compatibilityLevel"] == "1.1"
    assert {item["type"] for item in stream["destinations"]} == {"Eventhouse", "Lakehouse"}
    for destination in stream["destinations"]:
        assert destination["inputNodes"][0]["name"] == stream["streams"][0]["name"]


def test_eventstream_eventhouse_destination_matches_the_kql_table() -> None:
    """The eventhouse destination runs in processed ingestion mode, which pushes rows.

    Direct ingestion is the pull mode, and it needs a connection the service creates
    for it. A definition only deploy never creates that connection, so the node stays
    in warning and nothing lands. Processed ingestion takes a database name and an
    input serialization instead, matches columns by name, and needs no connection.

    https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/eventstream-definition
    https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-destination-kql-database
    """
    stream = _eventstream()
    properties = next(
        item for item in stream["destinations"] if item["type"] == "Eventhouse"
    )["properties"]
    assert properties["dataIngestionMode"] == "ProcessedIngestion"
    assert properties["databaseName"] == KQL_DATABASE
    assert properties["tableName"] == "flight_events"
    assert properties["inputSerialization"]["type"] == "Json"
    assert properties["inputSerialization"]["properties"]["encoding"] == "UTF8"
    assert "connectionName" not in properties
    assert "mappingRuleName" not in properties


def test_eventstream_lakehouse_destination_writes_the_same_table() -> None:
    """https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/add-destination-lakehouse"""
    stream = _eventstream()
    properties = next(
        item for item in stream["destinations"] if item["type"] == "Lakehouse"
    )["properties"]
    assert properties["schema"] == "dbo"
    assert properties["deltaTable"] == "flight_events"
    assert properties["minimumRows"] > 0
    assert properties["maximumDurationInSeconds"] > 0


def test_pipeline_waits_and_takes_the_inbound_flight() -> None:
    """The wait activity and the pipeline parameters both come from Data Factory.

    https://learn.microsoft.com/azure/data-factory/control-flow-wait-activity
    https://learn.microsoft.com/azure/data-factory/control-flow-execute-pipeline-activity
    """
    pipeline = json.loads(_pipeline_text())
    activities = pipeline["properties"]["activities"]
    assert [activity["type"] for activity in activities] == ["Wait"]
    assert activities[0]["typeProperties"]["waitTimeInSeconds"] >= 1
    parameters = pipeline["properties"]["parameters"]
    assert parameters["inbound_flight_id"]["type"] == "String"


def test_pipeline_carries_no_placeholder_to_replace() -> None:
    text = _pipeline_text()
    for placeholder in ("11111111-", "22222222-", "33333333-"):
        assert placeholder not in text


def test_kql_schema_creates_the_three_reference_tables() -> None:
    text = _kql_schema()
    for table in ("flights", "bookings", "transfer_rules"):
        assert f".create-merge table {table}" in text


def test_kql_schema_carries_the_columns_the_real_time_path_needs() -> None:
    """event_id and city are additions of phase 5, both declared last.

    .create-merge table appends a new column at the end of the table, so a new
    column has to be declared last to keep a live table and this file in step.
    https://learn.microsoft.com/kusto/management/create-merge-table-command?view=microsoft-fabric
    """
    text = _kql_schema()
    assert "event_id: string" in text
    assert "city: string" in text
    assert "$.event_id" in text


def test_latest_eta_is_defined_before_connection_windows() -> None:
    """A function body may only call a function that already exists."""
    text = _kql_schema()
    # Match the signatures, not the prose: the comment block above the tables
    # names ConnectionWindows long before either function is declared.
    latest_eta = text.index("LatestEta(for_flight_id")
    connection_windows = text.index("ConnectionWindows(inbound_flight_id")
    assert latest_eta < connection_windows


def test_connection_windows_reads_its_threshold_from_transfer_rules() -> None:
    """Rule 5: the number lives in the scenario file, never in the query."""
    text = _kql_schema()
    assert 'rule_name == "pax_standard_min"' in text
    assert "at_risk" in text
    assert "by event_id" in text





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


def test_eventhouse_query_uri_reads_the_properties() -> None:
    """https://learn.microsoft.com/rest/api/fabric/eventhouse/items/get-eventhouse"""
    assert eventhouse_query_uri({"properties": {"queryServiceUri": "https://x "}}) == "https://x"
    with pytest.raises(FabricApiError):
        eventhouse_query_uri({"properties": {}})
    with pytest.raises(FabricApiError):
        eventhouse_query_uri({})


# ---------------------------------------------------------------- the eventstream endpoint


def _recorder(answer: dict[str, object]):
    """Return a call log and a fetch stub that always gives the same answer."""
    calls: list[tuple[str, str, str]] = []

    def fetch(method: str, url: str, token: str) -> dict[str, object]:
        calls.append((method, url, token))
        return answer

    return calls, fetch


def test_custom_endpoint_type_is_the_documented_name() -> None:
    """https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology"""
    assert CUSTOM_ENDPOINT_TYPE == "CustomEndpoint"


def test_eventstream_topology_builds_the_documented_url() -> None:
    """https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology"""
    calls, fetch = _recorder({"sources": []})
    assert eventstream_topology("t", "ws", "es", fetch=fetch) == {"sources": []}
    assert calls == [("GET", f"{FABRIC_API_ROOT}/workspaces/ws/eventstreams/es/topology", "t")]


def test_eventstream_topology_refuses_an_empty_identifier() -> None:
    _, fetch = _recorder({})
    with pytest.raises(FabricApiError):
        eventstream_topology("t", " ", "es", fetch=fetch)
    with pytest.raises(FabricApiError):
        eventstream_topology("t", "ws", " ", fetch=fetch)


def test_custom_endpoint_source_picks_the_single_source() -> None:
    wanted = {"id": "s1", "name": "CustomEndpointSource", "type": CUSTOM_ENDPOINT_TYPE}
    other = {"id": "s2", "name": "hub", "type": "AzureEventHubs"}
    assert custom_endpoint_source({"sources": [other, wanted]}) == wanted


def test_custom_endpoint_source_reports_every_wrong_shape() -> None:
    with pytest.raises(FabricApiError):
        custom_endpoint_source({})
    with pytest.raises(FabricApiError):
        custom_endpoint_source({"sources": [{"id": "s2", "type": "AzureEventHubs"}]})
    twice = [{"id": "a", "type": CUSTOM_ENDPOINT_TYPE}, {"id": "b", "type": CUSTOM_ENDPOINT_TYPE}]
    with pytest.raises(FabricApiError):
        custom_endpoint_source({"sources": twice})


def test_source_connection_builds_the_documented_url() -> None:
    """https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-source-connection"""
    calls, fetch = _recorder({"type": CUSTOM_ENDPOINT_TYPE})
    eventstream_source_connection("t", "ws", "es", "src", fetch=fetch)
    wanted = f"{FABRIC_API_ROOT}/workspaces/ws/eventstreams/es/sources/src/connection"
    assert calls == [("GET", wanted, "t")]


def test_source_connection_refuses_an_empty_identifier() -> None:
    _, fetch = _recorder({})
    for workspace, stream, source in ((" ", "es", "s"), ("ws", " ", "s"), ("ws", "es", " ")):
        with pytest.raises(FabricApiError):
            eventstream_source_connection("t", workspace, stream, source, fetch=fetch)


def test_endpoint_address_takes_only_the_two_address_fields() -> None:
    """The access keys in the same answer are never carried any further."""
    connection = {
        "fullyQualifiedNamespace": " example.servicebus.windows.net ",
        "eventHubName": " example_eh ",
        "accessKeys": {"primaryKey": "never read"},
    }
    assert endpoint_address(connection) == ("example.servicebus.windows.net", "example_eh")


def test_endpoint_address_reports_a_missing_field() -> None:
    with pytest.raises(FabricApiError):
        endpoint_address({"eventHubName": "example_eh"})
    with pytest.raises(FabricApiError):
        endpoint_address({"fullyQualifiedNamespace": "example.servicebus.windows.net"})


# ---------------------------------------------------------------- kusto helpers


def test_kusto_scope_is_the_documented_audience() -> None:
    """https://learn.microsoft.com/kusto/api/rest/authentication?view=microsoft-fabric"""
    assert KUSTO_SCOPE == "https://api.kusto.windows.net/.default"


def test_kusto_url_picks_query_or_management() -> None:
    """https://learn.microsoft.com/kusto/api/rest/request?view=microsoft-fabric"""
    host = "https://trd-example.z4.kusto.fabric.microsoft.com"
    assert kusto_url(host + "/") == host + KUSTO_QUERY_PATH
    assert kusto_url(host, management=True) == host + KUSTO_MGMT_PATH


def test_kusto_url_rejects_an_empty_service() -> None:
    with pytest.raises(FabricApiError):
        kusto_url("  ")


def test_kusto_body_carries_the_database_and_the_command() -> None:
    assert kusto_body("hubdb", "flights | count") == {"db": "hubdb", "csl": "flights | count"}
    with pytest.raises(FabricApiError):
        kusto_body(" ", "flights | count")
    with pytest.raises(FabricApiError):
        kusto_body("hubdb", " ")


def test_kusto_headers_ask_for_json() -> None:
    headers = kusto_headers("a-token")
    assert "Authorization" in headers
    assert headers["Accept"] == "application/json"
    assert headers["Content-Type"].startswith("application/json")


def test_kusto_reader_turns_a_response_into_records() -> None:
    """https://learn.microsoft.com/kusto/api/rest/response?view=microsoft-fabric"""
    payload = {
        "Tables": [
            {
                "Columns": [{"ColumnName": "city"}, {"ColumnName": "window_min"}],
                "Rows": [["MCT", 20], ["SIN", 30]],
            },
            {"Columns": [], "Rows": []},
        ]
    }
    assert kusto_columns(payload) == ["city", "window_min"]
    assert kusto_rows(payload) == [["MCT", 20], ["SIN", 30]]
    assert kusto_records(payload)[0] == {"city": "MCT", "window_min": 20}


def test_kusto_reader_rejects_a_response_without_a_result_table() -> None:
    with pytest.raises(FabricApiError):
        kusto_columns({"Tables": []})
    with pytest.raises(FabricApiError):
        kusto_columns({"Tables": ["not an object"]})
    with pytest.raises(FabricApiError):
        kusto_rows({})


def test_kusto_escape_doubles_a_backslash() -> None:
    """https://learn.microsoft.com/kusto/query/scalar-data-types/string?view=microsoft-fabric"""
    assert kusto_escape("a\\b") == "a\\\\b"
    assert kusto_escape("a\tb") == "a\\tb"


def test_kusto_literal_writes_each_scalar_type() -> None:
    """https://learn.microsoft.com/kusto/query/scalar-data-types/null-values?view=microsoft-fabric"""
    assert kusto_literal('say "hi"\n', "string") == '"say \\"hi\\"\\n"'
    assert kusto_literal(True, "bool") == "true"
    assert kusto_literal(False, "bool") == "false"
    assert kusto_literal(45, "int") == "45"
    moment = datetime(2026, 11, 15, 0, 35)
    assert kusto_literal(moment, "datetime") == "datetime(2026-11-15T00:35:00)"
    assert kusto_literal(None, "string") == '""'
    assert kusto_literal(None, "int") == "int(null)"


def test_kusto_literal_writes_a_missing_string_as_the_empty_string() -> None:
    """The string type carries no null value, so a datatable cannot hold string(null).

    https://learn.microsoft.com/kusto/query/scalar-data-types/null-values?view=microsoft-fabric
    """
    rendered = kusto_datatable([("a", "string")], [[None]])
    assert "string(null)" not in rendered
    assert '""' in rendered


def test_kusto_literal_rejects_a_type_it_cannot_write() -> None:
    with pytest.raises(FabricApiError):
        kusto_literal("x", "guid")


def test_kusto_datatable_renders_rows_in_column_order() -> None:
    """https://learn.microsoft.com/kusto/query/datatable-operator?view=microsoft-fabric"""
    columns = [("rule_name", "string"), ("value", "int")]
    text = kusto_datatable(columns, [["pax_standard_min", 45]])
    assert text.startswith("datatable(rule_name: string, value: int)")
    assert '"pax_standard_min", 45' in text
    assert kusto_datatable(columns, []).endswith("[]")


def test_kusto_datatable_rejects_a_row_of_the_wrong_width() -> None:
    with pytest.raises(FabricApiError):
        kusto_datatable([("a", "int")], [[1, 2]])
    with pytest.raises(FabricApiError):
        kusto_datatable([], [])


def test_kusto_set_or_replace_names_the_table() -> None:
    """https://learn.microsoft.com/kusto/management/data-ingestion/ingest-from-query?view=microsoft-fabric"""
    command = kusto_set_or_replace("transfer_rules", "datatable(a: int)\n[]")
    assert command.startswith(".set-or-replace transfer_rules <|")
    with pytest.raises(FabricApiError):
        kusto_set_or_replace(" ", "datatable(a: int)")
    with pytest.raises(FabricApiError):
        kusto_set_or_replace("transfer_rules", " ")


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


# ---------------------------------------------------------------- the reference loader


def test_reference_tables_exist_in_the_kql_schema() -> None:
    module = _load_script("load_kql_reference")
    text = _kql_schema()
    for table in module.REFERENCE_TABLES:
        assert f".create-merge table {table}" in text


def test_reference_loader_knows_a_row_model_per_table() -> None:
    module = _load_script("load_kql_reference")
    for table in module.REFERENCE_TABLES:
        assert module.model_for(table) is not None
    with pytest.raises(FabricApiError):
        module.model_for("not_a_table")


def test_reference_loader_orders_columns_by_ordinal() -> None:
    """https://learn.microsoft.com/kusto/query/getschema-operator?view=microsoft-fabric"""
    module = _load_script("load_kql_reference")
    records = [
        {"ColumnName": "value", "ColumnOrdinal": 1, "ColumnType": "int"},
        {"ColumnName": "rule_name", "ColumnOrdinal": 0, "ColumnType": "string"},
    ]
    columns = module.columns_from_schema(records)
    assert columns == [("rule_name", "string"), ("value", "int")]
    assert module.rows_for(columns, [{"rule_name": "a", "value": 1}]) == [["a", 1]]


def test_reference_loader_rejects_a_schema_it_cannot_use() -> None:
    module = _load_script("load_kql_reference")
    with pytest.raises(FabricApiError):
        module.columns_from_schema([])
    with pytest.raises(FabricApiError):
        module.rows_for([("rule_name", "string")], [{"other": "a"}])


def test_reference_loader_dry_run_makes_no_call(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _load_script("load_kql_reference")
    assert module.main(["--env", "example", "--data", str(tmp_path), "--dry-run"]) == 0
    assert "no network call" in capsys.readouterr().out


# ---------------------------------------------------------------- the replay script


def test_replay_accepts_both_namespace_spellings() -> None:
    """https://learn.microsoft.com/azure/event-hubs/event-hubs-python-get-started-send"""
    module = _load_script("replay_events")
    expected = "hub.servicebus.windows.net"
    assert module.fully_qualified("hub") == expected
    assert module.fully_qualified(expected) == expected
    assert module.fully_qualified("sb://hub.servicebus.windows.net/") == expected
    with pytest.raises(module.ReplayError):
        module.fully_qualified("  ")


def test_replay_event_id_is_the_same_for_the_same_event() -> None:
    """A resend keeps the identifier, so the deduplication in the query holds."""
    module = _load_script("replay_events")
    events = build_events(load_scenario())
    first = module.event_id_for(events[0])
    assert first == module.event_id_for(events[0])
    assert len({module.event_id_for(event) for event in events}) == len(events)
    assert module.payload_for(events[0])["event_id"] == first


def test_replay_selects_the_three_parts_of_the_timeline() -> None:
    module = _load_script("replay_events")
    scenario = load_scenario()
    events = build_events(scenario)
    trigger = scenario.trigger_event.event_type
    whole = module.select(events, trigger, module.EVERYTHING)
    until = module.select(events, trigger, module.UNTIL_TRIGGER)
    only = module.select(events, trigger, module.TRIGGER_ONLY)
    assert whole == events
    assert until[-1].event_type == trigger
    assert len(until) < len(whole)
    assert only == [until[-1]]


def test_replay_needs_the_trigger_event_in_the_timeline() -> None:
    module = _load_script("replay_events")
    events = build_events(load_scenario())
    with pytest.raises(module.ReplayError):
        module.select(events, "no_such_type", module.UNTIL_TRIGGER)


def test_replay_waits_follow_the_gaps_in_the_timeline() -> None:
    module = _load_script("replay_events")
    events = build_events(load_scenario())
    pauses = module.waits(events, 60.0)
    assert len(pauses) == len(events)
    assert pauses[0] == 0.0
    assert all(pause >= 0 for pause in pauses)
    assert sum(module.waits(events, 600.0)) < sum(pauses)
    with pytest.raises(module.ReplayError):
        module.waits(events, 0)


def test_replay_dry_run_makes_no_call(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    module = _load_script("replay_events")
    write_events(build_events(load_scenario()), tmp_path / EVENTS_FILE)
    assert module.main(["--env", "example", "--data", str(tmp_path), "--dry-run"]) == 0
    assert "no network call" in capsys.readouterr().out


# ---------------------------------------------------------------- the endpoint reader


def test_endpoint_plan_names_both_configuration_keys() -> None:
    module = _load_script("eventstream_endpoint")
    text = "\n".join(module.plan("ws"))
    assert module.NAMESPACE_KEY in text
    assert module.EVENT_HUB_KEY in text
    assert EVENTSTREAM_ITEM in text
    assert "never printed" in text


def test_endpoint_config_lines_match_the_configuration_keys() -> None:
    module = _load_script("eventstream_endpoint")
    lines = module.config_lines("example.servicebus.windows.net", "example_eh")
    assert lines[0] == "eventstream:"
    assert module.NAMESPACE_KEY == "eventstream." + lines[1].split(":")[0].strip()
    assert module.EVENT_HUB_KEY == "eventstream." + lines[2].split(":")[0].strip()
    assert "example_eh" in lines[2]


def test_endpoint_namespace_is_the_spelling_the_replay_script_wants() -> None:
    reader = _load_script("eventstream_endpoint")
    replay = _load_script("replay_events")
    namespace = reader.config_lines("example.servicebus.windows.net", "eh")[1].split(": ", 1)[1]
    assert replay.fully_qualified(namespace) == namespace


def test_endpoint_resolves_the_workspace_and_the_eventstream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_script("eventstream_endpoint")
    monkeypatch.setattr(module, "list_workspaces", lambda token: [{"id": "ws", "displayName": "d"}])
    monkeypatch.setattr(
        module,
        "list_items",
        lambda token, workspace_id, item_type="": [
            {"id": "es", "displayName": EVENTSTREAM_ITEM, "type": item_type}
        ],
    )
    assert module.resolve_eventstream("t", "d") == ("ws", "es")
    with pytest.raises(FabricApiError):
        module.resolve_eventstream("t", "no such workspace")


def test_endpoint_reader_chains_topology_then_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_script("eventstream_endpoint")
    monkeypatch.setattr(
        module,
        "eventstream_topology",
        lambda token, workspace_id, eventstream_id: {
            "sources": [{"id": "src", "type": CUSTOM_ENDPOINT_TYPE}]
        },
    )
    monkeypatch.setattr(
        module,
        "eventstream_source_connection",
        lambda token, workspace_id, eventstream_id, source_id: {
            "fullyQualifiedNamespace": "example.servicebus.windows.net",
            "eventHubName": "example_eh",
            "accessKeys": {"primaryKey": "never read"},
        },
    )
    assert module.read_endpoint("t", "ws", "es") == ("example.servicebus.windows.net", "example_eh")


def test_endpoint_dry_run_makes_no_call(capsys: pytest.CaptureFixture[str]) -> None:
    module = _load_script("eventstream_endpoint")
    assert module.main(["--env", "example", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "no network call" in out
    assert module.NAMESPACE_KEY in out
