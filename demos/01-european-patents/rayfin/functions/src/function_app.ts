/**
 * European Patents — live, read-only patents data functions.
 *
 * Each function runs parameterized, read-only T-SQL against the `eps_lakehouse`
 * SQL analytics endpoint (which is inherently read-only) and returns JSON. The
 * browser invokes them via `client.functions.<name>.invoke(input)`.
 *
 * Connection model: a **managed Fabric connection**. Create it once in the
 * portal (this UDF item → *Manage connections* → the `eps_lakehouse` SQL
 * analytics endpoint); Fabric mints an alias. We reference the alias only —
 * there is NO connection string or credential in code. The alias is read from
 * the `EPS_LAKEHOUSE_SQL_ALIAS` function app setting so it is never hard-coded.
 *
 * The injected connection object follows the `mssql` (node-mssql) shape used by
 * the Fabric UDF SQL sample: `conn.request().input(name, value).query(text)`
 * returning `{ recordset }`. All SQL and row-mapping lives in the pure,
 * unit-tested `queries.ts`.
 */

import { UserDataFunctions } from '@microsoft/fabric-user-data-functions';

import {
  assertReadOnly,
  buildKpiSummary,
  buildListApplications,
  buildTopApplicants,
  buildTopInventors,
  mapKpiSummary,
  mapListApplications,
  mapTopApplicants,
  mapTopInventors,
  type BuiltQuery,
} from './queries.js';
import type {
  KpiSummary,
  ListApplicationsInput,
  ListApplicationsResult,
  TopApplicantRow,
  TopInput,
  TopInventorRow,
} from './types.js';

/**
 * Managed-connection alias for the lakehouse SQL analytics endpoint. Sourced
 * from the function app setting so it stays out of source. The default matches
 * the suggested alias in the README's *Manage connections* step.
 */
const SQL_ALIAS = process.env['EPS_LAKEHOUSE_SQL_ALIAS'] ?? 'eps_lakehouse_sql';

/** The single arg name Fabric injects the SQL connection under. */
const CONN_ARG = 'sqlDB';

/** Minimal shape of the injected `mssql`-style connection we rely on. */
interface SqlRequest {
  input(name: string, value: unknown): SqlRequest;
  query(text: string): Promise<{ recordset: Record<string, unknown>[] }>;
}
interface SqlConnection {
  request(): SqlRequest;
}

/** Bind params and execute a built read-only query; returns the recordset. */
async function run(conn: SqlConnection, built: BuiltQuery): Promise<Record<string, unknown>[]> {
  assertReadOnly(built.text);
  let request = conn.request();
  for (const p of built.params) {
    request = request.input(p.name, p.value);
  }
  const result = await request.query(built.text);
  return result.recordset ?? [];
}

const udf = new UserDataFunctions();

udf.func(
  'kpiSummary',
  async (sqlDB: SqlConnection): Promise<KpiSummary> => {
    const rows = await run(sqlDB, buildKpiSummary());
    return mapKpiSummary(rows[0] ?? {});
  },
  [udf.connection({ alias: SQL_ALIAS, argName: CONN_ARG })]
);

udf.func(
  'listApplications',
  async (
    input: ListApplicationsInput,
    sqlDB: SqlConnection
  ): Promise<ListApplicationsResult> => {
    const rows = await run(sqlDB, buildListApplications(input ?? {}));
    return mapListApplications(rows, input ?? {});
  },
  [udf.connection({ alias: SQL_ALIAS, argName: CONN_ARG })]
);

udf.func(
  'topApplicants',
  async (input: TopInput, sqlDB: SqlConnection): Promise<TopApplicantRow[]> => {
    const rows = await run(sqlDB, buildTopApplicants(input ?? {}));
    return mapTopApplicants(rows);
  },
  [udf.connection({ alias: SQL_ALIAS, argName: CONN_ARG })]
);

udf.func(
  'topInventors',
  async (input: TopInput, sqlDB: SqlConnection): Promise<TopInventorRow[]> => {
    const rows = await run(sqlDB, buildTopInventors(input ?? {}));
    return mapTopInventors(rows);
  },
  [udf.connection({ alias: SQL_ALIAS, argName: CONN_ARG })]
);

export { udf };
