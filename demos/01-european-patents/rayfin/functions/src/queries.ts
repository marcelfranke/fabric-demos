/**
 * Pure, dependency-free SQL builders + row mappers for the patents functions.
 *
 * No Node or Fabric-SDK imports live here on purpose: this module is unit-tested
 * in isolation (see `queries.test.mjs`) and `function_app.ts` only wires these
 * builders to the injected SQL connection. Every builder returns parameterized
 * T-SQL — user values are bound as `@parameters`, never string-concatenated — and
 * every statement is read-only (`SELECT` only), guarded by {@link assertReadOnly}.
 */

import {
  COLUMNS as C,
  LIMITS,
  TABLES as T,
  qid,
  qtable,
} from './schema.js';
import type {
  ApplicationRow,
  KpiSummary,
  ListApplicationsInput,
  ListApplicationsResult,
  TopApplicantRow,
  TopInput,
  TopInventorRow,
} from './types.js';

export interface SqlParam {
  name: string;
  value: string | number | boolean | null;
}

export interface BuiltQuery {
  text: string;
  params: SqlParam[];
}

// ── input clamps ────────────────────────────────────────────────────────────
export function clampPage(page: number | undefined): number {
  const n = Math.floor(Number(page));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function clampPageSize(pageSize: number | undefined): number {
  const n = Math.floor(Number(pageSize));
  if (!Number.isFinite(n) || n < 1) return LIMITS.applicationsDefaultPageSize;
  return Math.min(n, LIMITS.applicationsMaxPageSize);
}

export function clampLimit(limit: number | undefined): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return LIMITS.topDefaultLimit;
  return Math.min(n, LIMITS.topMaxLimit);
}

/**
 * Defense-in-depth read-only guard. The builders only ever emit SELECT, but this
 * throws if a mutating/DDL keyword ever slips into generated SQL before it is run.
 */
const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute)\b/i;
export function assertReadOnly(sql: string): void {
  if (FORBIDDEN.test(sql)) {
    throw new Error('Refusing to run non read-only SQL against the lakehouse.');
  }
}

// ── kpiSummary ────────────────────────────────────────────────────────────
export function buildKpiSummary(): BuiltQuery {
  const f = C.factApplication;
  const text =
    `SELECT COUNT(*) AS totalApplications, ` +
    `SUM(CAST(${qid(f.isGranted)} AS int)) AS granted, ` +
    `SUM(CAST(${qid(f.publicationCount)} AS bigint)) AS totalPublications ` +
    `FROM ${qtable(T.factApplication)};`;
  assertReadOnly(text);
  return { text, params: [] };
}

export function mapKpiSummary(row: Record<string, unknown>): KpiSummary {
  const totalApplications = num(row['totalApplications']);
  const granted = num(row['granted']);
  const totalPublications = num(row['totalPublications']);
  const grantRatePct =
    totalApplications > 0
      ? Math.round((granted / totalApplications) * 1000) / 10
      : 0;
  return { totalApplications, granted, grantRatePct, totalPublications };
}

// ── listApplications ──────────────────────────────────────────────────────
export function buildListApplications(input: ListApplicationsInput): BuiltQuery {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const offset = (page - 1) * pageSize;

  const f = C.factApplication;
  const a = C.dimApplication;
  const co = C.dimCountry;
  const ta = C.dimTechArea;

  const params: SqlParam[] = [
    { name: 'offset', value: offset },
    { name: 'limit', value: pageSize },
  ];
  const where: string[] = [];

  if (typeof input.country === 'string' && input.country.length > 0) {
    where.push(`co.${qid(co.countryCode)} = @country`);
    params.push({ name: 'country', value: input.country });
  }
  if (typeof input.techArea === 'string' && input.techArea.length > 0) {
    where.push(`ta.${qid(ta.label)} = @techArea`);
    params.push({ name: 'techArea', value: input.techArea });
  }
  if (typeof input.granted === 'boolean') {
    where.push(`f.${qid(f.isGranted)} = @granted`);
    params.push({ name: 'granted', value: input.granted ? 1 : 0 });
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')} ` : '';

  const text =
    `SELECT ` +
    `f.${qid(f.applicationNumber)} AS applicationNumber, ` +
    `a.${qid(a.title)} AS title, ` +
    `a.${qid(a.filingDate)} AS filingDate, ` +
    `co.${qid(co.countryCode)} AS countryCode, ` +
    `co.${qid(co.countryName)} AS countryName, ` +
    `ta.${qid(ta.label)} AS techArea, ` +
    `f.${qid(f.isGranted)} AS granted, ` +
    `f.${qid(f.publicationCount)} AS publicationCount, ` +
    `COUNT(*) OVER() AS totalRows ` +
    `FROM ${qtable(T.factApplication)} AS f ` +
    `LEFT JOIN ${qtable(T.dimApplication)} AS a ON a.${qid(a.applicationKey)} = f.${qid(f.applicationKey)} ` +
    `LEFT JOIN ${qtable(T.dimCountry)} AS co ON co.${qid(co.countryKey)} = f.${qid(f.countryKey)} ` +
    `LEFT JOIN ${qtable(T.dimTechArea)} AS ta ON ta.${qid(ta.techAreaKey)} = f.${qid(f.techAreaKey)} ` +
    whereSql +
    `ORDER BY f.${qid(f.applicationNumber)} ` +
    `OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`;

  assertReadOnly(text);
  return { text, params };
}

export function mapListApplications(
  rows: Record<string, unknown>[],
  input: ListApplicationsInput
): ListApplicationsResult {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const total = rows.length > 0 ? num(rows[0]['totalRows']) : 0;
  const mapped: ApplicationRow[] = rows.map((r) => ({
    applicationNumber: str(r['applicationNumber']) ?? '',
    title: str(r['title']),
    filingDate: str(r['filingDate']),
    countryCode: str(r['countryCode']),
    countryName: str(r['countryName']),
    techArea: str(r['techArea']),
    granted: bool(r['granted']),
    publicationCount: num(r['publicationCount']),
  }));
  return { rows: mapped, page, pageSize, total };
}

// ── topApplicants ─────────────────────────────────────────────────────────
export function buildTopApplicants(input: TopInput): BuiltQuery {
  const limit = clampLimit(input.limit);
  const b = C.bridgeApplicant;
  const d = C.dimApplicant;
  const text =
    `SELECT d.${qid(d.name)} AS applicant, COUNT(*) AS applicationCount ` +
    `FROM ${qtable(T.bridgeApplicant)} AS b ` +
    `JOIN ${qtable(T.dimApplicant)} AS d ON d.${qid(d.applicantKey)} = b.${qid(b.applicantKey)} ` +
    `GROUP BY d.${qid(d.name)} ` +
    `ORDER BY applicationCount DESC, d.${qid(d.name)} ASC ` +
    `OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY;`;
  assertReadOnly(text);
  return { text, params: [{ name: 'limit', value: limit }] };
}

export function mapTopApplicants(rows: Record<string, unknown>[]): TopApplicantRow[] {
  return rows.map((r) => ({
    applicant: str(r['applicant']) ?? '',
    applicationCount: num(r['applicationCount']),
  }));
}

// ── topInventors ──────────────────────────────────────────────────────────
export function buildTopInventors(input: TopInput): BuiltQuery {
  const limit = clampLimit(input.limit);
  const b = C.bridgeInventor;
  const d = C.dimInventor;
  const text =
    `SELECT d.${qid(d.name)} AS inventor, COUNT(*) AS applicationCount ` +
    `FROM ${qtable(T.bridgeInventor)} AS b ` +
    `JOIN ${qtable(T.dimInventor)} AS d ON d.${qid(d.inventorKey)} = b.${qid(b.inventorKey)} ` +
    `GROUP BY d.${qid(d.name)} ` +
    `ORDER BY applicationCount DESC, d.${qid(d.name)} ASC ` +
    `OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY;`;
  assertReadOnly(text);
  return { text, params: [{ name: 'limit', value: limit }] };
}

export function mapTopInventors(rows: Record<string, unknown>[]): TopInventorRow[] {
  return rows.map((r) => ({
    inventor: str(r['inventor']) ?? '',
    applicationCount: num(r['applicationCount']),
  }));
}

// ── coercion helpers (SQL drivers hand back mixed types) ────────────────────
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}
