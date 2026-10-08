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

# The eventhouse and the KQL database inside it, as named in section 2.2 of the
# same document. The eventhouse carries the query address, the database name is
# what every Kusto request below puts in its "db" field.
EVENTHOUSE_ITEM = "eh_hub"
KQL_DATABASE = "hubdb"

# The eventstream that carries the live flight events, from the phase 5 prompt.
EVENTSTREAM_ITEM = "es_flight_events"

# The source type the replay script sends to, as spelled by the topology API.
# https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology
CUSTOM_ENDPOINT_TYPE = "CustomEndpoint"

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


def list_items(
    token: str,
    workspace_id: str,
    *,
    item_type: str = "",
    fetch: Any = None,
) -> list[dict[str, Any]]:
    """Return the items of one workspace, optionally of one type only.

    https://learn.microsoft.com/rest/api/fabric/core/items/list-items
    """
    if not workspace_id.strip():
        raise FabricApiError("workspace id is empty")
    url = f"{FABRIC_API_ROOT}/workspaces/{workspace_id}/items"
    if item_type.strip():
        url = f"{url}?type={item_type.strip()}"
    return list(iter_pages(url, token, fetch=fetch))


def get_eventhouse(
    token: str,
    workspace_id: str,
    eventhouse_id: str,
    *,
    fetch: Any = None,
) -> dict[str, Any]:
    """Return one eventhouse with its properties.

    https://learn.microsoft.com/rest/api/fabric/eventhouse/items/get-eventhouse
    """
    if not workspace_id.strip():
        raise FabricApiError("workspace id is empty")
    if not eventhouse_id.strip():
        raise FabricApiError("eventhouse id is empty")
    call = fetch if fetch is not None else request_json
    return call(
        "GET",
        f"{FABRIC_API_ROOT}/workspaces/{workspace_id}/eventhouses/{eventhouse_id}",
        token,
    )


def eventhouse_query_uri(eventhouse: Mapping[str, Any]) -> str:
    """Return the query service address of an eventhouse.

    The address is the host the Kusto calls below talk to. It is generated when
    the eventhouse is created, so it is read at run time and never written down.
    https://learn.microsoft.com/rest/api/fabric/eventhouse/items/get-eventhouse
    """
    properties = eventhouse.get("properties")
    if not isinstance(properties, Mapping):
        raise FabricApiError("eventhouse came back without properties")
    uri = str(properties.get("queryServiceUri", "")).strip()
    if not uri:
        raise FabricApiError("eventhouse came back without a queryServiceUri")
    return uri


def eventstream_topology(
    token: str,
    workspace_id: str,
    eventstream_id: str,
    *,
    fetch: Any = None,
) -> dict[str, Any]:
    """Return the sources, streams and destinations of one eventstream.

    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology
    """
    if not workspace_id.strip():
        raise FabricApiError("workspace id is empty")
    if not eventstream_id.strip():
        raise FabricApiError("eventstream id is empty")
    call = fetch if fetch is not None else request_json
    return call(
        "GET",
        f"{FABRIC_API_ROOT}/workspaces/{workspace_id}/eventstreams/{eventstream_id}/topology",
        token,
    )


def custom_endpoint_source(topology: Mapping[str, Any]) -> dict[str, Any]:
    """Return the single custom endpoint source of an eventstream topology.

    The replay script sends to a custom endpoint, so that is the only source
    type this demo looks for.
    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-topology
    """
    sources = topology.get("sources")
    if not isinstance(sources, list):
        raise FabricApiError("topology came back without sources")
    found = [
        source
        for source in sources
        if isinstance(source, Mapping)
        and str(source.get("type", "")).strip() == CUSTOM_ENDPOINT_TYPE
    ]
    if not found:
        raise FabricApiError("the eventstream has no custom endpoint source")
    if len(found) > 1:
        raise FabricApiError("the eventstream has more than one custom endpoint source")
    return dict(found[0])


def eventstream_source_connection(
    token: str,
    workspace_id: str,
    eventstream_id: str,
    source_id: str,
    *,
    fetch: Any = None,
) -> dict[str, Any]:
    """Return the connection details of one eventstream source.

    The answer also carries access keys. Nothing in this demo reads them: the
    replay script signs in with az login, so only the two address fields below
    are ever taken out of the answer.
    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-source-connection
    """
    if not workspace_id.strip():
        raise FabricApiError("workspace id is empty")
    if not eventstream_id.strip():
        raise FabricApiError("eventstream id is empty")
    if not source_id.strip():
        raise FabricApiError("source id is empty")
    call = fetch if fetch is not None else request_json
    return call(
        "GET",
        (
            f"{FABRIC_API_ROOT}/workspaces/{workspace_id}"
            f"/eventstreams/{eventstream_id}/sources/{source_id}/connection"
        ),
        token,
    )


def endpoint_address(connection: Mapping[str, Any]) -> tuple[str, str]:
    """Return the namespace and the event hub name of a custom endpoint.

    Only these two fields are read, so the access keys in the same answer are
    never carried any further.
    https://learn.microsoft.com/rest/api/fabric/eventstream/topology/get-eventstream-source-connection
    """
    namespace = str(connection.get("fullyQualifiedNamespace", "")).strip()
    event_hub = str(connection.get("eventHubName", "")).strip()
    if not namespace:
        raise FabricApiError("the connection came back without a namespace")
    if not event_hub:
        raise FabricApiError("the connection came back without an event hub name")
    return namespace, event_hub


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


# ---------------------------------------------------------------------------
# Kusto, the query engine behind the eventhouse eh_hub and the database hubdb.
#
# This is a different API from the Fabric REST API above: different host,
# different token audience, different request shape. It lives in this module so
# that the demo keeps exactly one place that talks to Microsoft services.
# ---------------------------------------------------------------------------

# A Kusto service over HTTPS authenticates with a Microsoft Entra token issued
# for this resource, in Fabric exactly as in Azure Data Explorer.
# https://learn.microsoft.com/kusto/api/rest/authentication?view=microsoft-fabric
KUSTO_SCOPE = "https://api.kusto.windows.net/.default"

# Queries and management commands are two resources on the same host. Both are
# POST with a JSON body holding "db" and "csl".
# https://learn.microsoft.com/kusto/api/rest/request?view=microsoft-fabric
KUSTO_QUERY_PATH = "/v1/rest/query"
KUSTO_MGMT_PATH = "/v1/rest/mgmt"

# The scalar types this module can write as literals, with the spelling of a
# typed null for each.
# https://learn.microsoft.com/kusto/query/scalar-data-types/null-values?view=microsoft-fabric
KUSTO_TYPES = ("string", "bool", "int", "long", "real", "datetime")


def get_kusto_token(credential: Any) -> str:
    """Return a bearer token for a Kusto query or management endpoint."""
    # https://learn.microsoft.com/python/api/overview/azure/identity-readme
    return credential.get_token(KUSTO_SCOPE).token


def kusto_url(service_uri: str, *, management: bool = False) -> str:
    """Build the query or management URL of one Kusto service."""
    cleaned = service_uri.strip().rstrip("/")
    if not cleaned:
        raise FabricApiError("kusto service uri is empty")
    return cleaned + (KUSTO_MGMT_PATH if management else KUSTO_QUERY_PATH)


def kusto_body(database: str, command: str) -> dict[str, str]:
    """Build the JSON body of a Kusto request."""
    if not database.strip():
        raise FabricApiError("kusto database name is empty")
    if not command.strip():
        raise FabricApiError("kusto command is empty")
    return {"db": database, "csl": command}


def kusto_headers(token: str) -> dict[str, str]:
    """Return the headers a Kusto request needs.

    Accept and Content-Type are both required by the request reference above.
    """
    headers = auth_headers(token)
    headers["Accept"] = "application/json"
    headers["Content-Type"] = "application/json; charset=utf-8"
    return headers


def _kusto_primary(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return the primary result table of a v1 Kusto response.

    A v1 response carries the results as a sequence of rectangular tables under
    "Tables"; the first one holds the rows of the query itself and the ones
    after it hold query properties and status.
    https://learn.microsoft.com/kusto/api/rest/response?view=microsoft-fabric
    """
    tables = payload.get("Tables")
    if not isinstance(tables, list) or not tables:
        raise FabricApiError("kusto answered without a result table")
    first = tables[0]
    if not isinstance(first, dict):
        raise FabricApiError("kusto result table is not an object")
    return first


def kusto_columns(payload: Mapping[str, Any]) -> list[str]:
    """Return the column names of the primary result."""
    columns = _kusto_primary(payload).get("Columns", [])
    if not isinstance(columns, list):
        raise FabricApiError("kusto result carries no column list")
    return [str(column.get("ColumnName", "")) for column in columns if isinstance(column, dict)]


def kusto_rows(payload: Mapping[str, Any]) -> list[list[Any]]:
    """Return the rows of the primary result."""
    rows = _kusto_primary(payload).get("Rows", [])
    if not isinstance(rows, list):
        raise FabricApiError("kusto result carries no row list")
    return [list(row) for row in rows if isinstance(row, list)]


def kusto_records(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return the primary result as one dictionary per row."""
    names = kusto_columns(payload)
    return [dict(zip(names, row, strict=False)) for row in kusto_rows(payload)]


def kusto_request(
    service_uri: str,
    database: str,
    command: str,
    token: str,
    *,
    management: bool = False,
    post: Any = None,
    sleep: Any = time.sleep,
) -> dict[str, Any]:
    """Run one query or management command and return the decoded response.

    A 429 answer is retried the same way the Fabric calls above are retried.
    https://learn.microsoft.com/kusto/api/rest/request?view=microsoft-fabric
    """
    url = kusto_url(service_uri, management=management)
    body = kusto_body(database, command)
    if post is None:
        import requests  # imported here so the module imports without the network stack

        post = requests.post
    for attempt in range(MAX_THROTTLE_RETRIES + 1):
        response = post(
            url,
            headers=kusto_headers(token),
            json=body,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code == 429 and attempt < MAX_THROTTLE_RETRIES:
            sleep(retry_after_seconds(response.headers))
            continue
        if response.status_code != 200:
            raise FabricApiError(
                f"kusto {'mgmt' if management else 'query'} answered "
                f"{response.status_code}: {response.text[:500]}"
            )
        return response.json()
    raise FabricApiError(f"{url} stayed throttled after {MAX_THROTTLE_RETRIES} retries")


def kusto_escape(text: str) -> str:
    """Escape one Python string for use inside a double quoted KQL literal.

    https://learn.microsoft.com/kusto/query/scalar-data-types/string?view=microsoft-fabric
    """
    out = text.replace("\\", "\\\\").replace('"', '\\"')
    return out.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")


def kusto_literal(value: Any, kind: str) -> str:
    """Render one Python value as a KQL literal of the given scalar type.

    A null is written with its type, because an untyped null in a datatable
    would leave the column type undecided. The string type is the exception:
    it has no null value at all, so a missing string becomes the empty string,
    which is what isempty and isnotempty are made to test.
    https://learn.microsoft.com/kusto/query/scalar-data-types/null-values?view=microsoft-fabric
    """
    name = kind.strip().lower()
    if name not in KUSTO_TYPES:
        raise FabricApiError(f"unsupported kusto type {kind!r}")
    if name == "string":
        text = "" if value is None else kusto_escape(str(value))
        return '"' + text + '"'
    if value is None:
        return f"{name}(null)"
    if name == "bool":
        return "true" if value else "false"
    if name == "datetime":
        moment = value.isoformat() if hasattr(value, "isoformat") else str(value)
        return f"datetime({moment})"
    if name == "real":
        return repr(float(value))
    return str(int(value))


def kusto_datatable(columns: Sequence[tuple[str, str]], rows: Sequence[Sequence[Any]]) -> str:
    """Render rows as a KQL datatable expression.

    columns is a sequence of (name, type) pairs in the order the values appear
    in each row.
    https://learn.microsoft.com/kusto/query/datatable-operator?view=microsoft-fabric
    """
    if not columns:
        raise FabricApiError("a datatable needs at least one column")
    header = ", ".join(f"{name}: {kind}" for name, kind in columns)
    if not rows:
        return f"datatable({header})\n[]"
    lines = []
    for row in rows:
        if len(row) != len(columns):
            raise FabricApiError(
                f"row has {len(row)} values but the datatable has {len(columns)} columns"
            )
        values = [kusto_literal(value, kind) for value, (_, kind) in zip(row, columns, strict=True)]
        lines.append("    " + ", ".join(values) + ",")
    if lines:
        lines[-1] = lines[-1].rstrip(",")
    body = "\n".join(lines)
    return f"datatable({header})\n[\n{body}\n]"


def kusto_set_or_replace(table: str, expression: str) -> str:
    """Build a .set-or-replace command that fills one table from an expression.

    .set-or-replace replaces whatever the table held, so running the loader
    twice leaves the same rows behind, which is what rule 9 asks for.
    https://learn.microsoft.com/kusto/management/data-ingestion/ingest-from-query?view=microsoft-fabric
    """
    if not table.strip():
        raise FabricApiError("table name is empty")
    if not expression.strip():
        raise FabricApiError("datatable expression is empty")
    return f".set-or-replace {table} <|\n{expression}"

