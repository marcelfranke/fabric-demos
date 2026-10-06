"""Thin helpers over the Fabric REST API and the OneLake storage endpoint.

Every call in this module is backed by a documentation page. The URL sits in a
comment directly above the call, as required by rule 2 in
.github/copilot-instructions.md.

The module is deliberately split into two halves:

* pure functions that take data and return data (pagination handling, lookup by
  display name, path building) - these are covered by the offline tests in
  tests/test_fabric_assets.py;
* functions that talk to the network - these are only exercised by the live
  tests in tests/live/, which are skipped unless HUBDEMO_LIVE=1.

No secrets live here. Callers pass a credential, normally
azure.identity.DefaultAzureCredential, which picks up an existing ``az login``
session. See rule 6.
"""

from __future__ import annotations

import time
from collections.abc import Iterator, Mapping, Sequence
from typing import Any

# Fabric REST API, version 1.
# https://learn.microsoft.com/rest/api/fabric/articles/using-fabric-apis
FABRIC_API_ROOT = "https://api.fabric.microsoft.com/v1"

# Scope to request when asking Microsoft Entra ID for a Fabric token.
# https://learn.microsoft.com/rest/api/fabric/articles/identity-support
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"

# OneLake speaks the Azure Data Lake Storage Gen2 API. The account name is
# always "onelake" and the container name is the workspace name.
# https://learn.microsoft.com/fabric/onelake/onelake-access-api
ONELAKE_ACCOUNT_URL = "https://onelake.dfs.fabric.microsoft.com"

# The item type suffix used in a OneLake path, as shown in the URI syntax
# section of the page above ("/mylakehouse.lakehouse/Files/").
ONELAKE_LAKEHOUSE_SUFFIX = "Lakehouse"

# The lakehouse item of this demo, as named in docs/demo-spec.md section 2.1.
LAKEHOUSE_ITEM = "lh_hub"

# Folder inside the lakehouse that nb_load_reference reads from.
LANDING_PATH = "Files/landing"

# A request that has not answered within this many seconds is treated as failed.
REQUEST_TIMEOUT_SECONDS = 60

# How often a throttled request is retried before giving up.
MAX_THROTTLE_RETRIES = 3

# Fallback wait when a 429 response carries no Retry-After header.
DEFAULT_RETRY_AFTER_SECONDS = 20


class FabricApiError(RuntimeError):
    """Raised when the Fabric API answers with something unusable."""


def get_token(credential: Any) -> str:
    """Return a bearer token for the Fabric API.

    The credential is anything with ``get_token(*scopes)``, which is the shape
    of every azure.identity credential.
    """
    # https://learn.microsoft.com/python/api/overview/azure/identity-readme
    return credential.get_token(FABRIC_SCOPE).token


def auth_headers(token: str) -> dict[str, str]:
    """Return the headers every Fabric API call needs."""
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def retry_after_seconds(headers: Mapping[str, str]) -> int:
    """Read the Retry-After header of a 429 response.

    The Fabric API documents Retry-After as a whole number of seconds. Anything
    unreadable falls back to a fixed wait rather than hammering the service.
    https://learn.microsoft.com/rest/api/fabric/articles/throttling
    """
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw is None:
        return DEFAULT_RETRY_AFTER_SECONDS
    try:
        value = int(str(raw).strip())
    except ValueError:
        return DEFAULT_RETRY_AFTER_SECONDS
    if value <= 0:
        return DEFAULT_RETRY_AFTER_SECONDS
    return value


def request_json(
    method: str,
    url: str,
    token: str,
    *,
    json_body: Mapping[str, Any] | None = None,
    expected: Sequence[int] = (200,),
    sleep: Any = time.sleep,
) -> dict[str, Any]:
    """Call the Fabric API once and return the decoded body.

    A 429 answer is retried up to MAX_THROTTLE_RETRIES times, honouring the
    Retry-After header. Any other unexpected status raises FabricApiError with
    the body attached, because the Fabric API puts the useful error code there.
    """
    import requests  # imported here so the module imports without the network stack

    headers = auth_headers(token)
    for attempt in range(MAX_THROTTLE_RETRIES + 1):
        response = requests.request(
            method,
            url,
            headers=headers,
            json=dict(json_body) if json_body is not None else None,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code == 429 and attempt < MAX_THROTTLE_RETRIES:
            sleep(retry_after_seconds(response.headers))
            continue
        if response.status_code not in expected:
            raise FabricApiError(
                f"{method} {url} answered {response.status_code}: {response.text[:500]}"
            )
        if not response.content:
            return {}
        return response.json()
    raise FabricApiError(f"{method} {url} stayed throttled after {MAX_THROTTLE_RETRIES} retries")


def page_items(page: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return the rows of one Fabric list response.

    Fabric list endpoints answer with {"value": [...]} and carry the cursor in
    "continuationToken".
    https://learn.microsoft.com/rest/api/fabric/articles/pagination
    """
    value = page.get("value", [])
    if not isinstance(value, list):
        raise FabricApiError(f"expected a list under 'value', found {type(value).__name__}")
    return [row for row in value if isinstance(row, dict)]


def next_token(page: Mapping[str, Any]) -> str | None:
    """Return the continuation token of a list response, or None at the end."""
    token = page.get("continuationToken")
    if token in (None, ""):
        return None
    return str(token)


def paged_url(base_url: str, token: str | None) -> str:
    """Add a continuation token to a list URL."""
    if token is None:
        return base_url
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}continuationToken={token}"


def iter_pages(
    base_url: str,
    token: str,
    *,
    fetch: Any = None,
    max_pages: int = 100,
) -> Iterator[dict[str, Any]]:
    """Walk every page of a Fabric list endpoint and yield the rows."""
    call = fetch if fetch is not None else request_json
    cursor: str | None = None
    for _ in range(max_pages):
        page = call("GET", paged_url(base_url, cursor), token)
        yield from page_items(page)
        cursor = next_token(page)
        if cursor is None:
            return
    raise FabricApiError(f"{base_url} returned more than {max_pages} pages")


def find_by_display_name(rows: Sequence[Mapping[str, Any]], name: str) -> dict[str, Any] | None:
    """Return the row whose displayName matches, comparing case insensitively.

    Fabric treats workspace and capacity names as case insensitive for display
    purposes, so a lookup that only matched exactly would create a duplicate
    workspace on the second run and break rule 9.
    """
    wanted = name.strip().casefold()
    for row in rows:
        candidate = str(row.get("displayName", "")).strip().casefold()
        if candidate == wanted:
            return dict(row)
    return None


def list_capacities(token: str, *, fetch: Any = None) -> list[dict[str, Any]]:
    """Return the capacities the caller can see.

    https://learn.microsoft.com/rest/api/fabric/core/capacities/list-capacities
    """
    return list(iter_pages(f"{FABRIC_API_ROOT}/capacities", token, fetch=fetch))


def list_workspaces(token: str, *, fetch: Any = None) -> list[dict[str, Any]]:
    """Return the workspaces the caller can access.

    https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces
    """
    return list(iter_pages(f"{FABRIC_API_ROOT}/workspaces", token, fetch=fetch))


def create_workspace_body(
    display_name: str,
    capacity_id: str,
    description: str | None = None,
) -> dict[str, Any]:
    """Build the request body for Create Workspace.

    https://learn.microsoft.com/rest/api/fabric/core/workspaces/create-workspace
    """
    if not display_name.strip():
        raise FabricApiError("workspace display name is empty")
    if not capacity_id.strip():
        raise FabricApiError("capacity id is empty")
    body: dict[str, Any] = {"displayName": display_name, "capacityId": capacity_id}
    if description:
        body["description"] = description
    return body


def create_workspace(
    token: str,
    display_name: str,
    capacity_id: str,
    description: str | None = None,
    *,
    fetch: Any = None,
) -> dict[str, Any]:
    """Create a workspace and return the created object.

    Create Workspace answers 201 Created.
    https://learn.microsoft.com/rest/api/fabric/core/workspaces/create-workspace
    """
    call = fetch if fetch is not None else request_json
    body = create_workspace_body(display_name, capacity_id, description)
    return call(
        "POST",
        f"{FABRIC_API_ROOT}/workspaces",
        token,
        json_body=body,
        expected=(200, 201),
    )


def onelake_path(item_name: str, *parts: str, item_type: str = ONELAKE_LAKEHOUSE_SUFFIX) -> str:
    """Build a OneLake path below one item, without the workspace container.

    The azure-storage-file-datalake client takes the workspace as the file
    system name, so the path handed to it starts at the item.
    https://learn.microsoft.com/fabric/onelake/onelake-access-api
    """
    if not item_name.strip():
        raise FabricApiError("item name is empty")
    cleaned = [part.strip("/") for part in parts if part.strip("/")]
    return "/".join([f"{item_name}.{item_type}", *cleaned])


def landing_path(item_name: str, file_name: str = "") -> str:
    """Build the OneLake path of the landing folder, or of one file inside it."""
    if file_name:
        return onelake_path(item_name, LANDING_PATH, file_name)
    return onelake_path(item_name, LANDING_PATH)
