#!/usr/bin/env python
"""Read the custom endpoint address of the eventstream es_flight_events.

Why this script exists
    scripts/replay_events.py sends the flight events to the custom endpoint of
    the eventstream, so config/env.<name>.yaml needs the namespace and the event
    hub name of that endpoint. Both are created by Fabric when the eventstream
    is published, so they cannot be written into the repository up front. This
    script reads them back from the topology API instead of asking a human to
    copy them out of the portal.

What it does
    1. Reads config/env.<name>.yaml for the workspace name.
    2. Looks the workspace and the eventstream up by name.
    3. Reads the topology and picks the single custom endpoint source.
    4. Reads the connection of that source and prints the two address fields.

Usage
    python scripts/eventstream_endpoint.py --env demo
    python scripts/eventstream_endpoint.py --env demo --dry-run

Secrets
    The connection answer also carries access keys. This script never prints,
    stores or returns them: endpoint_address() in src/hubdemo/fabric_api.py
    takes the two address fields and drops the rest. The replay script signs in
    with ``az login`` and needs no key at all. See rule 6.

Permissions
    The connection call needs write permission on the eventstream, not just
    read. A workspace admin or member has it. See docs/manual-steps.md.

Idempotency
    Nothing is written. Running the script twice prints the same two lines.
    --dry-run makes no network call and needs no filled configuration.

Documentation
    https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
    https://learn.microsoft.com/rest/api/fabric/core/items/list-items
    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology
    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-source-connection
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

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
    EVENTSTREAM_ITEM,
    FabricApiError,
    custom_endpoint_source,
    endpoint_address,
    eventstream_source_connection,
    eventstream_topology,
    find_by_display_name,
    get_token,
    list_items,
    list_workspaces,
)

WORKSPACE_KEY = "fabric.workspace_name"

# The two configuration keys this script fills in. scripts/replay_events.py
# reads the same two keys.
NAMESPACE_KEY = "eventstream.namespace"
EVENT_HUB_KEY = "eventstream.event_hub"

# The item type of an eventstream in the List Items answer.
EVENTSTREAM_TYPE = "Eventstream"


def _print(message: str) -> None:
    print(message)


def _credential():
    """Return a DefaultAzureCredential.

    Imported inside the function so --dry-run works without azure-identity.
    https://learn.microsoft.com/python/api/overview/azure/identity-readme
    """
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def resolve_eventstream(token: str, workspace_name: str) -> tuple[str, str]:
    """Return the workspace id and the eventstream id."""
    workspace = find_by_display_name(list_workspaces(token), workspace_name)
    if workspace is None:
        raise FabricApiError(f"no workspace named {workspace_name!r}")
    workspace_id = str(workspace.get("id", ""))
    if not workspace_id:
        raise FabricApiError(f"workspace {workspace_name!r} came back without an id")

    items = list_items(token, workspace_id, item_type=EVENTSTREAM_TYPE)
    eventstream = find_by_display_name(items, EVENTSTREAM_ITEM)
    if eventstream is None:
        raise FabricApiError(
            f"no eventstream named {EVENTSTREAM_ITEM!r} in {workspace_name!r}. "
            "Run: python fabric/deploy.py --env <name>"
        )
    eventstream_id = str(eventstream.get("id", ""))
    if not eventstream_id:
        raise FabricApiError(f"eventstream {EVENTSTREAM_ITEM!r} came back without an id")
    return workspace_id, eventstream_id


def read_endpoint(token: str, workspace_id: str, eventstream_id: str) -> tuple[str, str]:
    """Return the namespace and the event hub name of the custom endpoint."""
    topology = eventstream_topology(token, workspace_id, eventstream_id)
    source = custom_endpoint_source(topology)
    source_id = str(source.get("id", ""))
    if not source_id:
        raise FabricApiError("the custom endpoint source came back without an id")
    connection = eventstream_source_connection(token, workspace_id, eventstream_id, source_id)
    return endpoint_address(connection)


def config_lines(namespace: str, event_hub: str) -> list[str]:
    """Return the block to paste into config/env.<name>.yaml."""
    return [
        "eventstream:",
        f"  namespace: {namespace}",
        f"  event_hub: {event_hub}",
    ]


def plan(workspace_name: str) -> list[str]:
    """Return the steps this script would take, as plain lines."""
    return [
        f"1. sign in with DefaultAzureCredential and look up workspace {workspace_name}",
        f"2. find the eventstream {EVENTSTREAM_ITEM} by name",
        "3. read its topology and pick the single custom endpoint source",
        "4. read the connection of that source and print its address only",
        f"   fills: {NAMESPACE_KEY}, {EVENT_HUB_KEY}",
        "   the access keys in the same answer are dropped, never printed",
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    if args.dry_run:
        try:
            values = read_config(args.env)
        except ConfigError:
            values = {}
            workspace_name = "<fabric.workspace_name>"
        else:
            workspace_name = str(get_optional(values, WORKSPACE_KEY, "<fabric.workspace_name>"))
        for line in plan(workspace_name):
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

    try:
        token = get_token(_credential())
        workspace_id, eventstream_id = resolve_eventstream(token, workspace_name)
        namespace, event_hub = read_endpoint(token, workspace_id, eventstream_id)
    except FabricApiError as error:
        _print(f"Fabric API problem: {error}")
        return 1

    _print(f"eventstream {EVENTSTREAM_ITEM}: {eventstream_id}")
    _print("")
    _print(f"paste this into config/env.{args.env}.yaml:")
    for line in config_lines(namespace, event_hub):
        _print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
