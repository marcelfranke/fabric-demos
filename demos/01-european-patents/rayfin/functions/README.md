# eps-patents-functions — live read-only lakehouse access

Fabric **User Data Functions (UDF)** that serve the `eps_lakehouse` `gold_` Kimball star
**live and read-only** to the Angular + Rayfin app. The browser cannot query a Fabric SQL
endpoint directly (AAD token audience, CORS, no SQL driver), so these functions run the
read **server-side** and return JSON; the frontend calls them via
`client.functions.<name>.invoke(...)`.

## Functions

| Name | Input | Output | Query |
|---|---|---|---|
| `kpiSummary` | *(none)* | `{ totalApplications, granted, grantRatePct, totalPublications }` | Aggregate over `gold_fact_application`. |
| `listApplications` | `{ page?, pageSize?, country?, techArea?, granted? }` | `{ rows, page, pageSize, total }` | Fact joined to application / publication / country / tech-area dims, server-side `OFFSET … FETCH NEXT`. |
| `topApplicants` | `{ limit? }` | `[{ applicant, applicationCount }]` | `gold_bridge_application_applicant` → `silver_applicant_dim`, grouped. |
| `topInventors` | `{ limit? }` | `[{ inventor, applicationCount }]` | `gold_bridge_application_inventor` → `gold_dim_inventor`, grouped. |

**Guarantees baked in** (see `src/queries.ts`):

- **Read-only** — `assertReadOnly()` rejects any `INSERT/UPDATE/DELETE/MERGE/DDL`. The
  lakehouse SQL analytics endpoint is itself read-only.
- **Parameterized** — every user input is bound via `request.input(name, value)`; nothing
  is concatenated into SQL, so there is no injection surface.
- **Bounded** — `pageSize` is clamped to `LIMITS.applicationsMaxPageSize` (100) and `limit`
  to `LIMITS.topMaxLimit` (50); queries use explicit column lists and a stable `ORDER BY`.
  Never `SELECT *` unbounded.

## Connection (managed alias — no creds in code)

The functions bind to a **managed Fabric connection**, created once in the portal:

1. Deploy the UDF item.
2. Open it → **Manage connections** → add the `eps_lakehouse` **SQL analytics endpoint**.
3. Fabric generates a connection **alias**; set it as the `EPS_LAKEHOUSE_SQL_ALIAS`
   function app setting (defaults to `eps_lakehouse_sql`). Auth flows through the UDF item
   identity — **no connection string or credentials appear in code**.

`function_app.ts` reads the alias from `process.env.EPS_LAKEHOUSE_SQL_ALIAS` and binds it
with `udf.connection({ alias, argName: 'sqlDB' })`; the injected `sqlDB` is an mssql-style
connection (`sqlDB.request().input(name, value).query(text)` → `{ recordset }`).

## ⚠️ Column names must be reconciled against the live endpoint

The application-grain `gold_fact_application` star is produced by a notebook whose DDL is
**not in this branch** (the committed notebook builds the older publication-grain star).
So the physical table/column names in **`src/schema.ts`** are best-effort, following the
repo's naming convention (bigint surrogate keys `<entity>_key`, natural key
`application_number`, measures like `is_granted` / `publication_count`).

**Before first deploy, reconcile them.** `src/schema.ts` is the *single* place to edit —
all SQL references its constants. Run this against the endpoint and fix any mismatches:

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE 'gold\_%' ESCAPE '\'
   OR TABLE_NAME = 'silver_applicant_dim'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

## Build & test

```bash
npm install        # installs the Fabric UDF SDK + tsc
npm run build      # tsc --build → dist/
npm test           # node --test (unit tests, no live endpoint needed)
```

`queries.test.mjs` runs against the pure SQL builders/mappers in `dist/queries.js` with a
**mocked** connection — it proves the queries are read-only, parameterized, clamped, and
that the mappers shape rows correctly (e.g. grant rate = 122653 / 390751 = 31.4%). It does
**not** hit the lakehouse.

## Deploy

Deploy UPSERT-style keyed on the stable item name (never rename — it churns Git sync).
Wire the managed connection (above), set `EPS_LAKEHOUSE_SQL_ALIAS`, then the app's
`client.functions.<name>.invoke(...)` calls resolve to `/functions/<name>/invoke`. For
local dev, set `VITE_RAYFIN_FUNCTIONS_URL` in the app's `.env.local` so invocations route
to the locally running function host.

## Files

- `src/schema.ts` — physical table/column name map + clamps. **The one place to reconcile.**
- `src/types.ts` — wire contract (`PatentsFunctionsSchema` + I/O types). Imported by BOTH
  the app frontend and the functions; **keep it free of Node/SDK imports**.
- `src/queries.ts` — pure parameterized SQL builders, row mappers, clamps, `assertReadOnly`.
- `src/function_app.ts` — UDF entrypoint; registers the four functions with the managed
  connection.
- `queries.test.mjs` — mocked-connection unit tests.
