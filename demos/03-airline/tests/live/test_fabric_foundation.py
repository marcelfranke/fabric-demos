"""Live checks for the fabric foundation built in phase 4.

These tests reach a real Fabric tenant. They are skipped unless you set
HUBDEMO_LIVE=1 and HUBDEMO_SQL_ENDPOINT, and unless pyodbc is installed.
A plain "pytest -q" run therefore stays offline and green.

What it proves
    Every parquet file written by "hubdemo generate" has the same number of
    rows in the matching delta table in the lakehouse. That is the phase 4
    goal: the reference data really landed.

How it connects
    The lakehouse has a SQL analytics endpoint. It is a TDS endpoint on TCP
    port 1433, reached with the server name shown as "SQL connection string"
    in the item settings, and it accepts Microsoft Entra ID sign in.
    https://learn.microsoft.com/fabric/data-warehouse/connectivity
    The item name must be passed as the database, otherwise you land in the
    master database and the tables are not visible. ODBC is supported with
    Microsoft Entra ID authentication, driver 18 or higher only.
    https://learn.microsoft.com/fabric/data-warehouse/how-to-connect

How it signs in
    By default it hands the driver an access token that it fetches with the
    Azure CLI sign in you already have, so nothing secret lives here and no
    browser window opens. The documented values of the ODBC "Authentication"
    keyword are SqlPassword, ActiveDirectoryIntegrated,
    ActiveDirectoryInteractive, ActiveDirectoryMsi,
    ActiveDirectoryServicePrincipal and the deprecated
    ActiveDirectoryPassword. There is no "ActiveDirectoryDefault" value.
    https://learn.microsoft.com/sql/connect/odbc/using-azure-active-directory
    Two of those were tried against the demo tenant and neither works there:
    ActiveDirectoryInteractive fails because the embedded browser the driver
    opens is refused by Microsoft Entra ID, and ActiveDirectoryIntegrated
    only works for federated accounts. See docs/verify-list.md. Set
    HUBDEMO_SQL_AUTH to a documented keyword value if your own tenant takes
    one, otherwise leave it alone and the access token route is used.

Before the first run
    See docs/manual-steps.md. You need ODBC Driver 18 for SQL Server, the
    pyodbc package, a current "az login", and the SQL connection string of
    lh_hub.
"""

from __future__ import annotations

import os
import struct

import pytest

# pyodbc is deliberately not a project dependency. The offline suite must not
# need a database driver, so skip the whole module when it is absent.
pyodbc = pytest.importorskip("pyodbc", reason="pyodbc is only needed for live tests")

from hubdemo.generate import PARQUET_TABLES, data_dir, read_dataset  # noqa: E402

LIVE_ENV = "HUBDEMO_LIVE"
ENDPOINT_ENV = "HUBDEMO_SQL_ENDPOINT"
AUTH_ENV = "HUBDEMO_SQL_AUTH"
DATABASE_ENV = "HUBDEMO_SQL_DATABASE"

# The lakehouse item name. The SQL analytics endpoint uses the item name as
# the database name, see the how-to-connect link in the module docstring.
DEFAULT_DATABASE = "lh_hub"

# Not an ODBC keyword value. It is our own name for "do not put an
# Authentication keyword in the string, pass a token instead".
ACCESS_TOKEN_AUTH = "AccessToken"

# Needs no secret and no browser, see the module docstring.
DEFAULT_AUTHENTICATION = ACCESS_TOKEN_AUTH

# Driver 18 is the lowest version Fabric supports.
ODBC_DRIVER = "ODBC Driver 18 for SQL Server"

# SQL_COPT_SS_ACCESS_TOKEN, the pre-connect attribute that carries the token.
# The attribute and the layout of its value are documented on Microsoft Learn,
# see access_token_struct below. The number itself is not in that page, it
# comes from the driver header msodbcsql.h, so it is recorded in
# docs/verify-list.md rather than claimed as documented.
SQL_COPT_SS_ACCESS_TOKEN = 1256

# Audience of the token the SQL analytics endpoint accepts. Taken from the
# sample Microsoft publishes for exactly this endpoint.
# https://github.com/microsoft/fabric-toolbox/blob/main/data-warehousing/dw-connectivity/odbc/pyodbc-dw-connectivity.py
SQL_TOKEN_SCOPE = "https://database.windows.net/.default"

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.environ.get(LIVE_ENV) != "1",
        reason=f"set {LIVE_ENV}=1 to run the live fabric checks",
    ),
]


def connection_string(endpoint: str, database: str, authentication: str) -> str:
    """Build the ODBC connection string for the SQL analytics endpoint.

    Kept as a plain function so the shape can be read and reviewed without a
    tenant. It holds no secret. In the default access token mode the string
    carries no Authentication keyword at all, because Learn states the string
    "must not contain UID, PWD, Authentication, or Trusted_Connection
    keywords" when a token is supplied.
    https://learn.microsoft.com/en-us/sql/connect/odbc/using-azure-active-directory#authenticating-with-an-access-token
    """
    parts = [
        f"Driver={{{ODBC_DRIVER}}}",
        f"Server={endpoint},1433",
        f"Database={database}",
    ]
    if authentication != ACCESS_TOKEN_AUTH:
        parts.append(f"Authentication={authentication}")
    parts.extend(["Encrypt=yes", "TrustServerCertificate=no"])
    return ";".join(parts) + ";"


def access_token_struct(token: str) -> bytes:
    """Pack a bearer token into the byte layout the ODBC driver expects.

    Learn describes the value as "a variable-length structure consisting of a
    4-byte length followed by length bytes of opaque data", and says a token
    from an OAuth 2.0 JSON response "must be expanded so that each byte is
    followed by a zero padding byte", with the length counting the expanded
    bytes and excluding any null terminator.
    https://learn.microsoft.com/en-us/sql/connect/odbc/using-azure-active-directory#authenticating-with-an-access-token
    """
    expanded = b"".join(bytes([byte, 0]) for byte in token.encode("utf-8"))
    return struct.pack("<I", len(expanded)) + expanded


def sql_access_token() -> str:
    """Read a SQL endpoint token from the signed in az session.

    Reuses the az login the rest of the build already needs, so the suite
    stores no secret of its own.
    https://learn.microsoft.com/en-us/python/api/azure-identity/azure.identity.azureclicredential
    """
    from azure.identity import AzureCliCredential

    return AzureCliCredential().get_token(SQL_TOKEN_SCOPE).token


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        pytest.skip(f"set {name} before running the live fabric checks")
    return value


@pytest.fixture(scope="module")
def expected_counts() -> dict[str, int]:
    """Row counts of the generated parquet files, read from disk."""
    directory = data_dir()
    if not directory.exists():
        pytest.skip("run: python -m hubdemo.cli generate --out data")
    dataset = read_dataset(directory)
    return dataset.counts()


@pytest.fixture(scope="module")
def cursor():
    endpoint = _require(ENDPOINT_ENV)
    database = os.environ.get(DATABASE_ENV, "").strip() or DEFAULT_DATABASE
    authentication = os.environ.get(AUTH_ENV, "").strip() or DEFAULT_AUTHENTICATION
    text = connection_string(endpoint, database, authentication)
    attrs: dict[int, bytes] = {}
    if authentication == ACCESS_TOKEN_AUTH:
        attrs[SQL_COPT_SS_ACCESS_TOKEN] = access_token_struct(sql_access_token())
    with pyodbc.connect(text, attrs_before=attrs, autocommit=True) as connection:
        with connection.cursor() as open_cursor:
            yield open_cursor


def table_names() -> list[str]:
    return [table.table for table in PARQUET_TABLES]


@pytest.mark.parametrize("table", table_names())
def test_lakehouse_table_row_count_matches_the_generated_file(cursor, expected_counts, table):
    """Each delta table holds exactly the rows the generator produced."""
    if table not in expected_counts:
        pytest.skip(f"no generated file for {table}")
    # The table name comes from PARQUET_TABLES in the repository, never from
    # user input, so a plain format string is safe here.
    cursor.execute(f"SELECT COUNT(*) FROM [dbo].[{table}]")
    actual = cursor.fetchone()[0]
    assert actual == expected_counts[table], (
        f"{table}: lakehouse has {actual} rows, generated file has {expected_counts[table]}"
    )


def test_every_generated_table_exists_in_the_lakehouse(cursor, expected_counts):
    """No generated table is missing from the lakehouse."""
    cursor.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo'"
    )
    present = {str(row[0]).casefold() for row in cursor.fetchall()}
    missing = sorted(name for name in expected_counts if name.casefold() not in present)
    assert not missing, f"missing from the lakehouse: {', '.join(missing)}"
