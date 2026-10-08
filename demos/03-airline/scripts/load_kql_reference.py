#!/usr/bin/env python
"""Fill the small reference tables inside the KQL database hubdb.

Why this script exists
    The item definition of a KQL database may only carry schema commands, so it
    can create the tables flights, bookings and transfer_rules but it cannot put
    a single row in them. The notebook nb_load_reference writes Delta tables into
    the lakehouse and never touches the eventhouse. Without this script the three
    tables stay empty and the KQL function ConnectionWindows returns nothing.

What it does
    1. Reads config/env.<name>.yaml for the workspace name.
    2. Looks the workspace, the eventhouse eh_hub and its query address up by
       name through the Fabric REST API.
    3. Asks the live table for its column order and column types with getschema,
       so a column added later cannot silently shift the values.
    4. Reads the generated Parquet files and sends one .set-or-replace command
       per table, carrying the rows as an inline datatable.

Usage
    python scripts/load_kql_reference.py --env demo
    python scripts/load_kql_reference.py --env demo --dry-run
    python scripts/load_kql_reference.py --env demo --data data

Idempotency
    .set-or-replace replaces whatever the table held, so a second run leaves the
    same rows behind. Nothing else in the workspace is touched. --dry-run makes
    no network call and needs no filled configuration.

Permissions
    .set-or-replace on an existing table needs at least the Table Admin role on
    that table. A workspace admin has it. See docs/manual-steps.md.

Documentation
    https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
    https://learn.microsoft.com/rest/api/fabric/core/items/list-items
    https://learn.microsoft.com/rest/api/fabric/eventhouse/items/get-eventhouse
    https://learn.microsoft.com/kusto/api/rest/request?view=microsoft-fabric
    https://learn.microsoft.com/kusto/management/data-ingestion/ingest-from-query?view=microsoft-fabric
    https://learn.microsoft.com/kusto/query/getschema-operator?view=microsoft-fabric
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
"""

from __future__ import annotations

import argparse
import sys
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
from hubdemo.fabric_api import (  # noqa: E402
    EVENTHOUSE_ITEM,
    KQL_DATABASE,
    FabricApiError,
    eventhouse_query_uri,
    find_by_display_name,
    get_eventhouse,
    get_kusto_token,
    get_token,
    kusto_datatable,
    kusto_records,
    kusto_request,
    kusto_set_or_replace,
    list_items,
    list_workspaces,
)
from hubdemo.generate import data_dir, read_table  # noqa: E402
from hubdemo.models import ROW_TABLES  # noqa: E402

WORKSPACE_KEY = "fabric.workspace_name"

# The reference tables that hubdb declares and that nothing else fills. They are
# listed in fabric/workspace/hubdb.KQLDatabase/DatabaseSchema.kql; the test
# tests/test_fabric_assets.py keeps the two lists in step.
REFERENCE_TABLES = ("flights", "bookings", "transfer_rules")

# The item type of an eventhouse in the List Items answer.
EVENTHOUSE_TYPE = "Eventhouse"


def _print(message: str) -> None:
    print(message)


def _credential():
    """Return a DefaultAzureCredential.

    Imported inside the function so --dry-run works without azure-identity.
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
    """
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def model_for(table: str) -> Any:
    """Return the row model of one reference table."""
    for entry in ROW_TABLES:
        if entry.table == table:
            return entry.model
    raise FabricApiError(f"no row model for table {table!r}")


def parquet_path(directory: Path, table: str) -> Path:
    """Return the Parquet file the generator writes for one table."""
    return directory / f"{table}.parquet"


def schema_command(table: str) -> str:
    """Return the query that reads the column order and types of a live table.

    getschema answers one row per column with ColumnName, ColumnOrdinal and
    ColumnType, which is the short KQL type name.
    https://learn.microsoft.com/kusto/query/getschema-operator?view=microsoft-fabric
    """
    return f"{table}\n| getschema\n| project ColumnName, ColumnOrdinal, ColumnType"


def columns_from_schema(records: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Turn a getschema answer into (name, type) pairs in column order."""
    if not records:
        raise FabricApiError("getschema answered without any column")
    ordered = sorted(records, key=lambda row: int(row.get("ColumnOrdinal", 0)))
    pairs = []
    for row in ordered:
        name = str(row.get("ColumnName", "")).strip()
        kind = str(row.get("ColumnType", "")).strip()
        if not name or not kind:
            raise FabricApiError(f"getschema returned an unusable column: {row!r}")
        pairs.append((name, kind))
    return pairs


def rows_for(columns: list[tuple[str, str]], records: list[dict[str, Any]]) -> list[list[Any]]:
    """Pick the values of every record in the column order of the live table."""
    names = [name for name, _ in columns]
    rows = []
    for record in records:
        missing = [name for name in names if name not in record]
        if missing:
            raise FabricApiError(
                "the generated rows carry no value for: " + ", ".join(sorted(missing))
            )
        rows.append([record[name] for name in names])
    return rows


def read_rows(directory: Path, table: str) -> list[dict[str, Any]]:
    """Read one generated Parquet file back as plain dictionaries."""
    path = parquet_path(directory, table)
    return [row.model_dump() for row in read_table(path, model_for(table))]


def load_table(
    service_uri: str,
    database: str,
    table: str,
    records: list[dict[str, Any]],
    token: str,
    *,
    request: Any = None,
) -> int:
    """Replace the contents of one table and return the number of rows sent."""
    call = request if request is not None else kusto_request
    schema = call(service_uri, database, schema_command(table), token)
    columns = columns_from_schema(kusto_records(schema))
    rows = rows_for(columns, records)
    command = kusto_set_or_replace(table, kusto_datatable(columns, rows))
    call(service_uri, database, command, token, management=True)
    return len(rows)


def resolve_service_uri(token: str, workspace_name: str) -> tuple[str, str]:
    """Return the workspace id and the query address of the eventhouse."""
    workspace = find_by_display_name(list_workspaces(token), workspace_name)
    if workspace is None:
        raise FabricApiError(f"no workspace named {workspace_name!r}")
    workspace_id = str(workspace.get("id", ""))
    if not workspace_id:
        raise FabricApiError(f"workspace {workspace_name!r} came back without an id")

    items = list_items(token, workspace_id, item_type=EVENTHOUSE_TYPE)
    eventhouse = find_by_display_name(items, EVENTHOUSE_ITEM)
    if eventhouse is None:
        raise FabricApiError(
            f"no eventhouse named {EVENTHOUSE_ITEM!r} in {workspace_name!r}. "
            "Run: python fabric/deploy.py --env <name>"
        )
    eventhouse_id = str(eventhouse.get("id", ""))
    full = get_eventhouse(token, workspace_id, eventhouse_id)
    return workspace_id, eventhouse_query_uri(full)


def plan(workspace_name: str, directory: Path, counts: dict[str, int]) -> list[str]:
    """Return the steps this script would take, as plain lines."""
    lines = [
        f"1. sign in with DefaultAzureCredential and look up workspace {workspace_name}",
        f"2. read the query address of the eventhouse {EVENTHOUSE_ITEM}",
        f"3. for every table below, read its column order from {KQL_DATABASE} with getschema",
        "4. send one .set-or-replace per table, carrying the rows as a datatable",
    ]
    for table in REFERENCE_TABLES:
        count = counts.get(table, -1)
        found = f"{count} row(s)" if count >= 0 else "file missing"
        lines.append(f"   {table}: {found} from {parquet_path(directory, table).name}")
    return lines


def count_rows(directory: Path) -> dict[str, int]:
    """Return the row count of every reference file that is present."""
    counts = {}
    for table in REFERENCE_TABLES:
        try:
            counts[table] = len(read_rows(directory, table))
        except Exception:  # noqa: BLE001 - a missing or unreadable file is reported as -1
            counts[table] = -1
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--data", default=None, help="directory holding the Parquet files")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    directory = Path(args.data) if args.data else data_dir()

    if args.dry_run:
        try:
            values = read_config(args.env)
        except ConfigError:
            values = {}
            workspace_name = "<fabric.workspace_name>"
        else:
            workspace_name = str(get_optional(values, WORKSPACE_KEY, "<fabric.workspace_name>"))
        for line in plan(workspace_name, directory, count_rows(directory)):
            _print(line)
        if not values:
            _print(f"no configuration found for environment {args.env!r}")
        elif WORKSPACE_KEY in missing_keys(values):
            _print(f"still empty in the configuration: {WORKSPACE_KEY}")
        _print("dry run, no network call was made")
        return 0

    try:
        values = read_config(args.env)
    except ConfigError as error:
        _print(str(error))
        return 1
    if WORKSPACE_KEY in missing_keys(values):
        _print(f"fill this key before running: {WORKSPACE_KEY}")
        return 1
    workspace_name = str(get(values, WORKSPACE_KEY))

    missing = [t for t in REFERENCE_TABLES if not parquet_path(directory, t).exists()]
    if missing:
        _print("missing generated files for: " + ", ".join(missing))
        _print("Run: python -m hubdemo.cli generate --out data")
        return 1

    credential = _credential()
    try:
        _, service_uri = resolve_service_uri(get_token(credential), workspace_name)
    except FabricApiError as error:
        _print(f"Fabric API problem: {error}")
        return 1
    _print(f"eventhouse {EVENTHOUSE_ITEM} answers at {service_uri}")

    kusto_token = get_kusto_token(credential)
    total = 0
    for table in REFERENCE_TABLES:
        try:
            sent = load_table(
                service_uri, KQL_DATABASE, table, read_rows(directory, table), kusto_token
            )
        except FabricApiError as error:
            _print(f"loading {table} failed: {error}")
            return 1
        _print(f"replaced {table} with {sent} row(s)")
        total += sent
    _print(f"loaded {total} row(s) into {KQL_DATABASE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
