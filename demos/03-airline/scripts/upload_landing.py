#!/usr/bin/env python
"""Upload the generated reference Parquet files to the lakehouse landing folder.

What it does
    Reads the Parquet files written by `python -m hubdemo.cli generate` and copies
    them to `Files/landing/` in the lakehouse `lh_hub`, using the OneLake API and
    `DefaultAzureCredential`. The notebook `nb_load_reference` then reads that
    folder and writes one Delta table per file.

Usage
    python scripts/upload_landing.py --env demo
    python scripts/upload_landing.py --env demo --dry-run
    python scripts/upload_landing.py --env demo --data data

Idempotency
    Every file is uploaded with overwrite, so running this twice leaves the same
    files with the same content. Nothing else in the workspace is touched.

Documentation
    OneLake access API (path syntax, Entra authentication):
        https://learn.microsoft.com/fabric/onelake/onelake-access-api
    DataLakeServiceClient:
        https://learn.microsoft.com/python/api/azure-storage-file-datalake/azure.storage.filedatalake.datalakeserviceclient
    DefaultAzureCredential:
        https://learn.microsoft.com/python/api/azure-identity/azure.identity.defaultazurecredential
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from hubdemo.config import (  # noqa: E402
    ConfigError,
    get,
    get_optional,
    missing_keys,
    read_config,
)
from hubdemo.fabric_api import (  # noqa: E402
    LAKEHOUSE_ITEM,
    LANDING_PATH,
    ONELAKE_ACCOUNT_URL,
    landing_path,
)
from hubdemo.generate import PARQUET_TABLES, data_dir  # noqa: E402

WORKSPACE_KEY = "fabric.workspace_name"

# Read the whole file into memory. The generated files are small, see docs/status.md.
MAX_UPLOAD_BYTES = 64 * 1024 * 1024


def _print(message: str) -> None:
    print(message)


def expected_file_names() -> list[str]:
    """Return the Parquet file names the generator writes, in a stable order."""
    return sorted(f"{table.table}.parquet" for table in PARQUET_TABLES)


def find_parquet_files(directory: Path) -> list[Path]:
    """Return the Parquet files in `directory`, sorted by name.

    Raises FileNotFoundError when the directory is missing, so the caller can tell
    the person to run the generator first.
    """
    if not directory.is_dir():
        raise FileNotFoundError(
            f"no data directory at {directory}. "
            "Run: python -m hubdemo.cli generate --out data"
        )
    return sorted(directory.glob("*.parquet"))


def missing_file_names(files: list[Path]) -> list[str]:
    """Return the expected file names that are not in `files`."""
    present = {path.name for path in files}
    return [name for name in expected_file_names() if name not in present]


def plan(workspace_name: str, files: list[Path]) -> list[str]:
    """Return the steps this script would take, as plain lines."""
    lines = [
        f"1. sign in with DefaultAzureCredential and open {ONELAKE_ACCOUNT_URL}",
        f"2. open the file system named after the workspace: {workspace_name}",
        f"3. upload {len(files)} file(s) to {LAKEHOUSE_ITEM}.Lakehouse/{LANDING_PATH}, overwriting",
    ]
    for path in files:
        target = landing_path(LAKEHOUSE_ITEM, path.name)
        lines.append(f"   {path.name} ({path.stat().st_size} bytes) -> {target}")
    return lines


def _file_system_client(workspace_name: str):
    """Return a file system client for the workspace container in OneLake.

    The import is inside the function so that --dry-run works without the Azure
    packages installed.
    """
    from azure.identity import DefaultAzureCredential
    from azure.storage.filedatalake import DataLakeServiceClient

    # The account name is always onelake and the container is the workspace name.
    # https://learn.microsoft.com/fabric/onelake/onelake-access-api
    service = DataLakeServiceClient(ONELAKE_ACCOUNT_URL, credential=DefaultAzureCredential())
    return service.get_file_system_client(workspace_name)


def upload(workspace_name: str, files: list[Path]) -> int:
    """Upload every file and return the number uploaded."""
    file_system = _file_system_client(workspace_name)
    uploaded = 0
    for path in files:
        size = path.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            raise ValueError(f"{path.name} is {size} bytes, larger than this script uploads")
        target = landing_path(LAKEHOUSE_ITEM, path.name)
        data = path.read_bytes()
        file_client = file_system.get_file_client(target)
        file_client.upload_data(data, overwrite=True)
        _print(f"uploaded {path.name} ({size} bytes) to {target}")
        uploaded += 1
    return uploaded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--data", default=None, help="directory holding the Parquet files")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    directory = Path(args.data) if args.data else data_dir()
    try:
        files = find_parquet_files(directory)
    except FileNotFoundError as error:
        _print(str(error))
        return 1
    if not files:
        _print(f"no Parquet files in {directory}. Run: python -m hubdemo.cli generate --out data")
        return 1

    absent = missing_file_names(files)
    if absent:
        _print("missing expected files: " + ", ".join(absent))
        _print("Run: python -m hubdemo.cli generate --out data")
        return 1

    if args.dry_run:
        workspace_name = "<fabric.workspace_name>"
        try:
            values = read_config(args.env)
        except ConfigError:
            values = {}
        else:
            workspace_name = str(get_optional(values, WORKSPACE_KEY, workspace_name))
        for line in plan(workspace_name, files):
            _print(line)
        if values:
            empty = [key for key in missing_keys(values) if key == WORKSPACE_KEY]
            if empty:
                _print("still empty in the configuration: " + ", ".join(empty))
        else:
            _print(f"no configuration found for environment {args.env!r}")
        _print("dry run, no network call was made")
        return 0

    try:
        values = read_config(args.env)
    except ConfigError as error:
        _print(str(error))
        return 1

    empty = [key for key in missing_keys(values) if key == WORKSPACE_KEY]
    if empty:
        _print("fill these keys before running: " + ", ".join(empty))
        return 1

    workspace_name = str(get(values, WORKSPACE_KEY))
    uploaded = upload(workspace_name, files)
    _print(f"uploaded {uploaded} file(s) to {LAKEHOUSE_ITEM}.Lakehouse/{LANDING_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
