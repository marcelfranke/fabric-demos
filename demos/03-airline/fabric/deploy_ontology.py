#!/usr/bin/env python
"""Publish the hub ontology to the Fabric workspace.

Why this script exists
    The ontology is the shared context every agent in this demo reads: what a
    flight is, what a connection is, which flight a bag is transferring to, and
    the rules the hub works by. It is kept in the repository as an item
    definition so it can be reviewed, changed and published again without
    anybody clicking through the portal.

What it does
    Reads the definition files under fabric/workspace/HubOntology.Ontology/,
    generates the business rules from scenario/qr004.yaml so the minutes are
    written down in one place only, fills in the lakehouse address, then creates
    or updates the ontology item and reads the definition back to compare it
    with what was sent.

Usage
    python fabric/deploy_ontology.py --env demo --dry-run
    python fabric/deploy_ontology.py --env demo

Secrets
    None. The script signs in with DefaultAzureCredential, which picks up an
    existing ``az login`` session. The lakehouse address and the item ids are
    read from the workspace at run time, so none of them is written down.

Permissions
    Contributor on the workspace, which is what publishing an item definition
    needs. The tenant also has to allow ontology items; see docs/manual-steps.md.

Idempotency
    Running it twice leaves the same ontology behind. The second run finds the
    item by display name and replaces its definition instead of creating a
    second one.

Documentation
    https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/ontology-definition
    https://learn.microsoft.com/rest/api/fabric/core/items/create-item
    https://learn.microsoft.com/rest/api/fabric/core/items/update-item-definition
    https://learn.microsoft.com/rest/api/fabric/core/items/get-item-definition
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from hubdemo.config import get, get_optional, missing_keys, read_config  # noqa: E402
from hubdemo.fabric_api import (  # noqa: E402
    LAKEHOUSE_ITEM,
    ONTOLOGY_ITEM,
    ONTOLOGY_TYPE,
    PLATFORM_PART,
    FabricApiError,
    create_item_definition,
    encode_part,
    find_by_display_name,
    get_item_definition,
    get_lakehouse,
    get_token,
    lakehouse_sql_endpoint,
    list_items,
    list_workspaces,
    update_item_definition,
)
from hubdemo.models import Scenario  # noqa: E402
from hubdemo.scenario import load_scenario  # noqa: E402

#: Configuration key holding the name of the workspace to publish into.
WORKSPACE_KEY = "fabric.workspace_name"

# PREVIEW: Fabric ontology item (item type "Ontology"). The item type, its definition
# format and the data bindings are all in preview, so the shapes written here can change
# without notice. The tenant setting "Users can create ontology (preview) items" has to be
# on before any of this works. See docs/verify-list.md entry V90.
# https://learn.microsoft.com/en-us/fabric/real-time-intelligence/digital-twin-builder/ontology-definition

#: Where the definition files live, relative to the project root.
ONTOLOGY_DIR = REPO_ROOT / "fabric" / "workspace" / "HubOntology.Ontology"

#: Placeholder for the SQL analytics endpoint of the lakehouse.
SQL_ENDPOINT_PLACEHOLDER = "__SQL_ENDPOINT__"

#: Placeholder for the item id of the lakehouse.
LAKEHOUSE_ID_PLACEHOLDER = "__LAKEHOUSE_ID__"

#: The part that carries the ref statements. Rules are added to it at deploy time.
MODEL_PART = "model.tmdl"

#: First six groups of the lineage tags given to the generated rules.
RULE_TAG_PREFIX = "9c2e1b43-5d4e-4b1f-8a30-1b2c3d4e05"


def _print(message: str) -> None:
    """Write one line to standard output."""
    print(message)


def _credential() -> Any:
    """Return a credential that reuses the signed in Azure CLI session."""
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def read_parts(directory: Path) -> dict[str, str]:
    """Read every definition file under a folder, keyed by its path in the item.

    Paths inside an item definition always use forward slashes, whatever the
    operating system writes on disk.
    https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/ontology-definition
    """
    if not directory.is_dir():
        raise FabricApiError(f"the ontology folder is missing: {directory}")
    parts: dict[str, str] = {}
    for path in sorted(directory.rglob("*")):
        if path.is_file():
            parts[path.relative_to(directory).as_posix()] = path.read_text(encoding="utf-8")
    if MODEL_PART not in parts:
        raise FabricApiError(f"the ontology folder has no {MODEL_PART}")
    return parts


def _when_any_value(stage: Any, key: str, fallback: Any) -> Any:
    """Return one condition value from an approval stage, by its key."""
    for condition in getattr(stage, "when_any", None) or []:
        if key in condition:
            return condition[key]
    return fallback


def _role_words(role: str) -> str:
    """Turn a role key such as hub_duty_manager into plain words."""
    return role.replace("_", " ").strip()


def rule_statements(scenario: Scenario) -> dict[str, str]:
    """Return the business rules as sentences, with every minute read from the scenario.

    The rules in docs/demo-spec.md sections 3 and 4 are the source. Nothing here
    is typed twice: every number comes from scenario/qr004.yaml, as rule 5 asks.
    """
    rules = scenario.rules
    policy = scenario.approval_policy
    stage_two = policy.stage_2
    hold_gate = _when_any_value(stage_two, "total_hold_min_greater_than", rules.max_hold_min)
    platinum_gate = _when_any_value(stage_two, "platinum_members_rebooked_at_least", 1)
    stage_one_role = _role_words(policy.stage_1.role)
    stage_two_role = _role_words(stage_two.role) if stage_two is not None else stage_one_role
    return {
        "ConnectionWindow": (
            "The connection window is the time between the estimated arrival of the inbound "
            "flight and the scheduled departure of the onward flight. When an option holds the "
            "onward flight, the hold minutes are added to the window."
        ),
        "FastTrackOption": (
            "The fast option sends the passengers through a fast track transfer and does not "
            f"hold the onward flight. A fast track transfer needs {rules.pax_fasttrack_min} "
            "minutes."
        ),
        "HoldOption": (
            "The hold option holds the onward flight by at most "
            f"{rules.max_hold_min} minutes and sends the passengers through a fast track "
            "transfer as well."
        ),
        "RebookOption": (
            "The rebook option takes the passengers off the onward flight and puts them on the "
            "next flight to the same city."
        ),
        "OptionResult": (
            "For the fast option and for the hold option, the spare time is the connection "
            f"window minus the {rules.pax_fasttrack_min} minutes a fast track transfer needs. "
            f"The option is ok when the spare time is {rules.margin_min} minutes or more, risky "
            f"when the spare time is between zero and {rules.margin_min} minutes, and it fails "
            "when the spare time is below zero."
        ),
        "BagsMakeIt": (
            "A transfer bag makes the connection when the connection window is "
            f"{rules.bag_priority_min} minutes or more with priority handling, and "
            f"{rules.bag_standard_min} minutes or more with standard handling."
        ),
        "CargoMakesIt": (
            "A cargo shipment makes the connection when the connection window is "
            f"{rules.cargo_min} minutes or more. Temperature controlled shipments are handled "
            "first."
        ),
        "ConnectionAtRisk": (
            "A connection is at risk when the connection window is below "
            f"{rules.pax_standard_min} minutes, which is the time a standard transfer needs."
        ),
        "ProposalChoice": (
            "The proposal for a connection is the first of the fast option and the hold option "
            "whose result is ok. When neither is ok, the proposal is to rebook."
        ),
        "TierService": (
            "The loyalty tier of a passenger never changes which option is proposed. It only "
            "adds service actions, such as lounge access, priority standby and a meet and "
            "assist escort."
        ),
        "ApprovalStageOne": (
            f"Every plan needs the approval of the {stage_one_role} before anything is sent."
        ),
        "ApprovalStageTwo": (
            f"A plan also needs the approval of the {stage_two_role} when the total hold is more "
            f"than {hold_gate} minutes, or when a chosen option is risky or fails, or when at "
            f"least {platinum_gate} Platinum member is rebooked."
        ),
        "ApprovalTimeout": (
            f"When a plan is not approved within {policy.timeout_min} minutes, nothing is sent "
            "and the plan is dropped."
        ),
    }


#: Which entity types and relationships each rule talks about. The property list
#: is what an agent should look at when it applies the rule.
RULE_REFERENCES: dict[str, dict[str, Any]] = {
    "ConnectionWindow": {
        "entities": [
            ("Connection", ["InboundFlightId", "OnwardFlightId"]),
            ("Flight", ["ScheduledTimeLocal", "EtaUpdates"]),
        ],
        "relationships": ["Connection Arrives On Flight", "Connection Departs On Flight"],
    },
    "FastTrackOption": {
        "entities": [("Connection", [])],
        "relationships": ["Connection Departs On Flight"],
    },
    "HoldOption": {
        "entities": [("Flight", ["FlightNumber", "ScheduledTimeLocal"])],
        "relationships": [],
    },
    "RebookOption": {
        "entities": [("Connection", ["OnwardFlightId"]), ("Flight", ["City"])],
        "relationships": ["Connection Departs On Flight"],
    },
    "OptionResult": {"entities": [("Connection", [])], "relationships": []},
    "BagsMakeIt": {
        "entities": [("Bag", ["BagTag", "BagOnwardFlightId"])],
        "relationships": ["Bag Transfers To Flight"],
    },
    "CargoMakesIt": {
        "entities": [
            ("CargoShipment", ["ShipmentId", "TemperatureControlled", "MinimumTransferMinutes"])
        ],
        "relationships": ["Cargo Shipment Transfers To Flight"],
    },
    "ConnectionAtRisk": {
        "entities": [("Connection", ["BookingId", "OnwardFlightId"])],
        "relationships": ["Connection Departs On Flight"],
    },
    "ProposalChoice": {"entities": [("Connection", [])], "relationships": []},
    "TierService": {
        "entities": [("Member", ["Tier", "LoungeAccess", "PriorityStandby", "MeetAssist"])],
        "relationships": ["Passenger Is Member"],
    },
    "ApprovalStageOne": {"entities": [("Connection", [])], "relationships": []},
    "ApprovalStageTwo": {"entities": [("Member", ["Tier"])], "relationships": []},
    "ApprovalTimeout": {"entities": [("Connection", [])], "relationships": []},
}


def rule_tmdl(name: str, statement: str, index: int) -> str:
    """Render one rule as a TMDL part.

    Indentation carries meaning: propertyScope and ruleReferencedProperty sit one
    level below the entity they belong to, while ruleReferencedRelationship is a
    sibling of ruleReferencedEntity.
    https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/ontology-definition
    """
    references = RULE_REFERENCES[name]
    lines = [
        f"rule {name}",
        f"\tlineageTag: {RULE_TAG_PREFIX}{index:02d}",
        f"\tstatement: {statement}",
    ]
    for entity, properties in references["entities"]:
        lines.append(f"\truleReferencedEntity {entity}")
        if properties:
            lines.append("\t\tpropertyScope: specific")
            lines.extend(f"\t\truleReferencedProperty {item}" for item in properties)
        else:
            lines.append("\t\tpropertyScope: none")
    lines.extend(f"\truleReferencedRelationship '{item}'" for item in references["relationships"])
    return "\n".join(lines) + "\n"


def rule_parts(scenario: Scenario) -> dict[str, str]:
    """Return the generated rule parts, keyed by their path in the item."""
    statements = rule_statements(scenario)
    missing = sorted(set(statements) - set(RULE_REFERENCES))
    if missing:
        raise FabricApiError(f"these rules have no references: {', '.join(missing)}")
    return {
        f"rules/{name}.tmdl": rule_tmdl(name, statement, index)
        for index, (name, statement) in enumerate(statements.items(), start=1)
    }


def model_with_rules(model_text: str, rule_names: list[str]) -> str:
    """Add a ref statement for every generated rule to the model part.

    The ref statements are what getDefinition reports back, so the rules that
    are generated here are listed alongside the tables and entity types that are
    kept in the repository.
    """
    body = model_text.rstrip("\n")
    refs = "\n".join(f"ref rule {name}" for name in rule_names)
    return f"{body}\n\n{refs}\n"


def build_parts(scenario: Scenario, directory: Path = ONTOLOGY_DIR) -> dict[str, str]:
    """Return the full definition: the files on disk plus the generated rules."""
    parts = read_parts(directory)
    generated = rule_parts(scenario)
    names = [path.removeprefix("rules/").removesuffix(".tmdl") for path in generated]
    parts[MODEL_PART] = model_with_rules(parts[MODEL_PART], names)
    parts.update(generated)
    return parts


def fill_placeholders(
    parts: dict[str, str], sql_endpoint: str, lakehouse_id: str
) -> dict[str, str]:
    """Replace the lakehouse placeholders with the addresses read from the workspace."""
    if not sql_endpoint.strip() or not lakehouse_id.strip():
        raise FabricApiError("the lakehouse address is empty, cannot fill the placeholders")
    return {
        path: text.replace(SQL_ENDPOINT_PLACEHOLDER, sql_endpoint).replace(
            LAKEHOUSE_ID_PLACEHOLDER, lakehouse_id
        )
        for path, text in parts.items()
    }


def unresolved_placeholders(parts: dict[str, str]) -> list[str]:
    """Return the part paths that still carry a placeholder."""
    markers = (SQL_ENDPOINT_PLACEHOLDER, LAKEHOUSE_ID_PLACEHOLDER)
    return sorted(path for path, text in parts.items() if any(mark in text for mark in markers))


def normalise(text: str) -> list[str]:
    """Return the meaningful lines of a TMDL part.

    Blank lines and trailing spaces carry no meaning in TMDL, and the service is
    free to lay a part out differently when it writes it back. Leading tabs are
    kept, because indentation does carry meaning.
    """
    return [line.rstrip() for line in text.replace("\r\n", "\n").split("\n") if line.strip()]


def differences(sent: dict[str, str], read_back: dict[str, str]) -> list[str]:
    """Compare what was sent with what came back, ignoring the platform owned part.

    The .platform part is rewritten by the service, so it is never compared.
    Parts the service added on its own are reported, because they say something
    about what the service inferred.
    """
    report: list[str] = []
    for path in sorted(set(sent) | set(read_back)):
        if path == PLATFORM_PART:
            continue
        if path not in read_back:
            report.append(f"{path}: sent but not read back")
            continue
        if path not in sent:
            report.append(f"{path}: added by the service")
            continue
        mine, theirs = normalise(sent[path]), normalise(read_back[path])
        if mine == theirs:
            continue
        removed = [line for line in mine if line not in theirs]
        added = [line for line in theirs if line not in mine]
        detail = f"{path}: {len(removed)} line(s) missing, {len(added)} line(s) added"
        for line in (removed + added)[:4]:
            detail = f"{detail}\n      {line.strip()}"
        report.append(detail)
    return report


def plan(workspace_name: str, parts: dict[str, str]) -> list[str]:
    """Describe what a live run would do, without calling anything."""
    rules = sorted(path for path in parts if path.startswith("rules/"))
    waiting = unresolved_placeholders(parts)
    lines = [
        f"workspace: {workspace_name}",
        f"item: {ONTOLOGY_ITEM} ({ONTOLOGY_TYPE})",
        f"definition parts: {len(parts)}",
        f"generated rules: {len(rules)}",
    ]
    lines.extend(f"  rule {path.removeprefix('rules/').removesuffix('.tmdl')}" for path in rules)
    lines.append(f"parts still holding a placeholder: {len(waiting)}")
    lines.extend(f"  {path}" for path in waiting)
    lines.append("a live run would create or update the item and read the definition back")
    return lines


def resolve_workspace(token: str, workspace_name: str) -> str:
    """Return the id of the workspace with this display name."""
    workspace = find_by_display_name(list_workspaces(token), workspace_name)
    if workspace is None:
        raise FabricApiError(f"no workspace named {workspace_name}")
    return str(workspace["id"])


def resolve_lakehouse(token: str, workspace_id: str) -> tuple[str, str]:
    """Return the item id and the SQL endpoint address of the lakehouse."""
    lakehouse = find_by_display_name(list_items(token, workspace_id), LAKEHOUSE_ITEM)
    if lakehouse is None:
        raise FabricApiError(f"no lakehouse named {LAKEHOUSE_ITEM} in the workspace")
    lakehouse_id = str(lakehouse["id"])
    detail = get_lakehouse(token, workspace_id, lakehouse_id)
    return lakehouse_id, lakehouse_sql_endpoint(detail)


def find_ontology(token: str, workspace_id: str) -> dict[str, Any] | None:
    """Return the ontology item of this workspace, or None when it is not there yet."""
    for item in list_items(token, workspace_id):
        if str(item.get("displayName", "")) == ONTOLOGY_ITEM:
            return item
    return None


def publish(token: str, workspace_id: str, parts: dict[str, str]) -> str:
    """Create or replace the ontology and return its item id."""
    payload = [encode_part(path, text) for path, text in sorted(parts.items())]
    existing = find_ontology(token, workspace_id)
    if existing is None:
        _print(f"creating {ONTOLOGY_ITEM}")
        created = create_item_definition(
            token, workspace_id, ONTOLOGY_ITEM, ONTOLOGY_TYPE, payload
        )
        return str(created["id"])
    item_id = str(existing["id"])
    _print(f"updating {ONTOLOGY_ITEM} ({item_id})")
    update_item_definition(token, workspace_id, item_id, payload)
    return item_id


def main(argv: list[str] | None = None) -> int:
    """Run the deployment and return a process exit code."""
    parser = argparse.ArgumentParser(description="Publish the hub ontology to Fabric.")
    parser.add_argument("--env", default="demo", help="configuration name under config/")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, call nothing")
    args = parser.parse_args(argv)

    values = read_config(args.env)
    scenario = load_scenario()
    parts = build_parts(scenario)

    if args.dry_run:
        workspace_name = str(get_optional(values, WORKSPACE_KEY, f"<{WORKSPACE_KEY}>"))
        for line in plan(workspace_name, parts):
            _print(line)
        if WORKSPACE_KEY in missing_keys(values):
            _print(f"still empty in the configuration: {WORKSPACE_KEY}")
        _print("dry run, no network call was made")
        return 0

    if WORKSPACE_KEY in missing_keys(values):
        _print(f"fill this key before running: {WORKSPACE_KEY}")
        return 1

    workspace_name = str(get(values, WORKSPACE_KEY))
    token = get_token(_credential())
    workspace_id = resolve_workspace(token, workspace_name)
    lakehouse_id, sql_endpoint = resolve_lakehouse(token, workspace_id)
    _print(f"lakehouse {LAKEHOUSE_ITEM} ({lakehouse_id})")
    parts = fill_placeholders(parts, sql_endpoint, lakehouse_id)

    item_id = publish(token, workspace_id, parts)
    _print(f"published {len(parts)} definition part(s)")

    read_back = get_item_definition(token, workspace_id, item_id)
    _print(f"read back {len(read_back)} definition part(s)")
    report = differences(parts, read_back)
    if not report:
        _print("the definition read back matches what was sent")
        return 0
    _print(f"{len(report)} difference(s) outside the platform part:")
    for line in report:
        _print(f"  {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
