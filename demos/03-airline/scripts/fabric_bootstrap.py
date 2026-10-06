#!/usr/bin/env python
"""Create the Fabric workspace for this demo if it does not exist yet.

What it does
    1. Reads config/env.<name>.yaml and takes fabric.capacity_name and
       fabric.workspace_name from it.
    2. Asks Microsoft Entra ID for a Fabric token through DefaultAzureCredential,
       which reuses an existing "az login" session. No secret is read or stored.
    3. Looks the capacity up by display name.
    4. Looks the workspace up by display name. If it is already there the script
       prints its id and stops. Otherwise it creates the workspace on that
       capacity and prints the new id.

Usage
    python scripts/fabric_bootstrap.py --env demo
    python scripts/fabric_bootstrap.py --env demo --dry-run

Idempotency
    Running it twice is safe. The second run finds the workspace and changes
    nothing. --dry-run makes no network call at all, so it also works before a
    tenant exists.

Documentation
    https://learn.microsoft.com/rest/api/fabric/core/capacities/list-capacities
    https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
    https://learn.microsoft.com/rest/api/fabric/core/workspaces/create-workspace
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from hubdemo.config import ConfigError, get_optional, missing_keys, read_config  # noqa: E402
from hubdemo.fabric_api import (  # noqa: E402
    FabricApiError,
    create_workspace,
    find_by_display_name,
    get_token,
    list_capacities,
    list_workspaces,
)

# The two configuration keys this script needs. Everything else in the file is
# used by later phases.
CAPACITY_KEY = "fabric.capacity_name"
WORKSPACE_KEY = "fabric.workspace_name"

DESCRIPTION = "Hub recovery demo. Synthetic data only."


def _print(message: str) -> None:
    print(message)


def _credential():
    """Return a DefaultAzureCredential.

    Imported inside the function so that --dry-run works on a machine without
    the azure-identity package installed.
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
    """
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def plan(capacity_name: str, workspace_name: str) -> list[str]:
    """Return the steps this script would take, in order."""
    return [
        f"read a Fabric token for {workspace_name!r} through DefaultAzureCredential",
        f"list capacities and look for display name {capacity_name!r}",
        f"list workspaces and look for display name {workspace_name!r}",
        f"create workspace {workspace_name!r} on that capacity only if it is missing",
    ]


def bootstrap(capacity_name: str, workspace_name: str) -> str:
    """Make sure the workspace exists and return its id."""
    token = get_token(_credential())

    workspaces = list_workspaces(token)
    existing = find_by_display_name(workspaces, workspace_name)
    if existing is not None:
        workspace_id = str(existing.get("id", ""))
        if not workspace_id:
            raise FabricApiError(f"workspace {workspace_name!r} came back without an id")
        _print(f"workspace {workspace_name!r} already exists")
        return workspace_id

    capacities = list_capacities(token)
    capacity = find_by_display_name(capacities, capacity_name)
    if capacity is None:
        names = ", ".join(sorted(str(row.get("displayName", "")) for row in capacities))
        raise FabricApiError(
            f"no capacity named {capacity_name!r}. Visible capacities: {names or 'none'}"
        )
    capacity_id = str(capacity.get("id", ""))
    if not capacity_id:
        raise FabricApiError(f"capacity {capacity_name!r} came back without an id")
    _print(f"capacity {capacity_name!r} has id {capacity_id}")

    created = create_workspace(token, workspace_name, capacity_id, DESCRIPTION)
    workspace_id = str(created.get("id", ""))
    if not workspace_id:
        raise FabricApiError(f"creating workspace {workspace_name!r} returned no id")
    _print(f"created workspace {workspace_name!r}")
    return workspace_id


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument("--env", default="demo", help="configuration name, default demo")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the plan and make no network call",
    )
    args = parser.parse_args(argv)

    try:
        values = read_config(args.env)
    except ConfigError as error:
        _print(f"configuration problem: {error}")
        return 1

    capacity_name = get_optional(values, CAPACITY_KEY)
    workspace_name = get_optional(values, WORKSPACE_KEY)

    if args.dry_run:
        _print(f"dry run for configuration {args.env!r}")
        for step in plan(capacity_name or "<capacity_name>", workspace_name or "<workspace_name>"):
            _print(f"  would {step}")
        empty = [key for key in missing_keys(values) if key in (CAPACITY_KEY, WORKSPACE_KEY)]
        if empty:
            _print(f"  these keys are still empty: {', '.join(empty)}")
        else:
            _print("  both keys this script needs are filled in")
        _print("no network call was made")
        return 0

    empty = [key for key in (CAPACITY_KEY, WORKSPACE_KEY) if not get_optional(values, key)]
    if empty:
        _print(f"these keys must be filled in first: {', '.join(empty)}")
        return 1

    try:
        workspace_id = bootstrap(capacity_name, workspace_name)
    except FabricApiError as error:
        _print(f"Fabric API problem: {error}")
        return 1

    _print(f"workspace id: {workspace_id}")
    _print("put this id nowhere by hand. The other scripts look it up by name.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
