#!/usr/bin/env python
"""Deploy the Fabric item definitions in fabric/workspace/ with fabric-cicd.

What it does
    Looks up the workspace named in the configuration, then publishes every item
    definition under fabric/workspace/ into it: the lakehouse, the eventhouse, the
    KQL database, the SQL database and the notebook.

Usage
    python fabric/deploy.py --env demo
    python fabric/deploy.py --env demo --dry-run

Idempotency
    fabric-cicd publishes the full set of items every run and updates the items it
    already finds, so running this twice leaves one copy of each item. This script
    never removes items: `unpublish_all_orphan_items` is deliberately not called,
    because it deletes anything in the workspace that is not in this repository.
    Remove items by hand instead, see docs/manual-steps.md.

Documentation
    fabric-cicd, FabricWorkspace and publish_all_items:
        https://microsoft.github.io/fabric-cicd/latest/
    Running fabric-cicd locally:
        https://learn.microsoft.com/fabric/cicd/tutorial-fabric-cicd-local
    Parameterisation with parameter.yml:
        https://microsoft.github.io/fabric-cicd/latest/how_to/parameterization/
    List workspaces (used to turn the workspace name into an id):
        https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
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
    FabricApiError,
    find_by_display_name,
    get_token,
    list_workspaces,
)

WORKSPACE_KEY = "fabric.workspace_name"

# The folder fabric-cicd reads. parameter.yml has to sit in the root of this folder.
WORKSPACE_DIR = REPO_ROOT / "fabric" / "workspace"

# The item types this demo deploys. All seven are supported by fabric-cicd,
# see the supported item types list at https://microsoft.github.io/fabric-cicd/latest/
# and fabric_cicd.constants.ACCEPTED_ITEM_TYPES in the installed package.
# Eventstream and DataPipeline were added in phase 5 for the real time path.
ITEM_TYPES = [
    "Lakehouse",
    "Eventhouse",
    "KQLDatabase",
    "SQLDatabase",
    "Notebook",
    "Eventstream",
    "DataPipeline",
]


def _print(message: str) -> None:
    print(message)


def _credential():
    """Return an Azure credential.

    The import is inside the function so that --dry-run works without the Azure
    packages installed. Rule 6 of .github/copilot-instructions.md: no secrets in
    the repository, sign in with az login first.
    https://learn.microsoft.com/python/api/azure-identity/azure.identity.defaultazurecredential
    """
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def item_folders(directory: Path) -> list[str]:
    """Return the item folder names this script publishes, sorted.

    The ontology folder is skipped on purpose. It is published by
    fabric/deploy_ontology.py instead, because its definition carries the
    lakehouse address, which is read from the workspace at run time.
    """
    if not directory.is_dir():
        return []
    names = (path.name for path in directory.iterdir() if path.is_dir())
    return sorted(name for name in names if name.split(".")[-1] in ITEM_TYPES)


def plan(workspace_name: str, directory: Path) -> list[str]:
    """Return the steps this script would take, as plain lines."""
    lines = [
        f"1. sign in with DefaultAzureCredential and find the workspace named {workspace_name}",
        f"2. read the item definitions in {directory}",
        f"3. publish these item types: {', '.join(ITEM_TYPES)}",
    ]
    for name in item_folders(directory):
        lines.append(f"   {name}")
    lines.append("4. leave anything else in the workspace alone, nothing is removed")
    return lines


def resolve_workspace_id(token: str, workspace_name: str) -> str:
    """Return the id of the workspace with this display name.

    https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
    """
    workspaces = list_workspaces(token)
    found = find_by_display_name(workspaces, workspace_name)
    if found is None:
        visible = ", ".join(sorted(str(row.get("displayName", "")) for row in workspaces))
        raise FabricApiError(
            f"no workspace named {workspace_name!r}. Visible workspaces: {visible or 'none'}. "
            "Run scripts/fabric_bootstrap.py first."
        )
    return str(found["id"])


def publish(workspace_id: str, environment: str, directory: Path, credential) -> None:
    """Publish every item definition in `directory` into the workspace.

    The import is inside the function so that --dry-run works without fabric-cicd
    installed. Every FabricWorkspace argument has to be a keyword argument.
    https://microsoft.github.io/fabric-cicd/latest/
    """
    from fabric_cicd import FabricWorkspace, publish_all_items

    workspace = FabricWorkspace(
        workspace_id=workspace_id,
        environment=environment,
        repository_directory=str(directory),
        item_type_in_scope=ITEM_TYPES,
        token_credential=credential,
    )
    publish_all_items(workspace)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    if not WORKSPACE_DIR.is_dir():
        _print(f"no item definitions at {WORKSPACE_DIR}")
        return 1

    if args.dry_run:
        workspace_name = "<fabric.workspace_name>"
        try:
            values = read_config(args.env)
        except ConfigError:
            values = {}
            _print(f"no configuration found for environment {args.env!r}")
        else:
            workspace_name = str(get_optional(values, WORKSPACE_KEY, workspace_name))
        for line in plan(workspace_name, WORKSPACE_DIR):
            _print(line)
        if values:
            empty = [key for key in missing_keys(values) if key == WORKSPACE_KEY]
            if empty:
                _print("still empty in the configuration: " + ", ".join(empty))
        _print(f"environment key used in parameter.yml: {args.env}")
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
    credential = _credential()
    try:
        workspace_id = resolve_workspace_id(get_token(credential), workspace_name)
    except FabricApiError as error:
        _print(str(error))
        return 1

    _print(f"workspace {workspace_name}: {workspace_id}")
    publish(workspace_id, args.env, WORKSPACE_DIR, credential)
    _print(f"published {len(item_folders(WORKSPACE_DIR))} item definition(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
