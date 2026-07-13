#!/usr/bin/env node
// @ts-check
/**
 * Sync REAL European Patents data out of Microsoft Fabric into static JSON
 * assets the Angular app loads in `live` mode (see AppConfig.setup_mode).
 *
 * Why this shape (and not a Fabric User Data Function): the target Fabric
 * capacity only accepts PYTHON UDF runtime, while the Rayfin functions
 * toolchain emits TypeScript — so the idiomatic UDF path is unavailable here.
 * Local T-SQL/TDS to the lakehouse SQL endpoint is also blocked from this
 * environment. The one read path that works is the semantic model's DAX
 * `executeQueries` REST endpoint over HTTPS — which is inherently read-only
 * (SELECT), so the "no writes to gold/silver" guarantee holds by construction.
 *
 * The script pulls:
 *   - KPI totals from the model's own measures (server-side aggregation, so we
 *     never pull 23k rows to count them client-side),
 *   - the IPC-section rollup for the dashboard chart,
 *   - a bounded, most-recent slice of Patent rows with their Applicant /
 *     Inventor / Classification children for the list + detail views,
 *   - a Top-N applicant leaderboard.
 *
 * Cross-platform: pure Node (ESM), no shell scripts. Auth token comes from
 * `FABRIC_PBI_TOKEN` when set (CI), otherwise from the Azure CLI (`az`).
 *
 * Usage:
 *   node scripts/sync-fabric.mjs
 * Env overrides:
 *   FABRIC_DATASET_ID, FABRIC_WORKSPACE_ID, FABRIC_PATENT_SLICE (default 400),
 *   FABRIC_APPLICANT_TOP (default 100), FABRIC_PBI_TOKEN, FABRIC_OUT_DIR
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const DATASET_ID =
  process.env.FABRIC_DATASET_ID ?? '4ff3efcc-8540-4349-9d2e-0dcf149e3332';
const WORKSPACE_ID =
  process.env.FABRIC_WORKSPACE_ID ?? '5e0747bf-be6c-449b-b0cc-1911bd54577f';
const PATENT_SLICE = Number(process.env.FABRIC_PATENT_SLICE ?? 400);
const APPLICANT_TOP = Number(process.env.FABRIC_APPLICANT_TOP ?? 100);
const OUT_DIR =
  process.env.FABRIC_OUT_DIR ?? join(projectRoot, 'src', 'assets', 'live');

const PBI_RESOURCE = 'https://analysis.windows.net/powerbi/api';
const QUERY_URL = `https://api.powerbi.com/v1.0/myorg/datasets/${DATASET_ID}/executeQueries`;

/** Acquire a Power BI / Analysis Services access token. */
function getToken() {
  if (process.env.FABRIC_PBI_TOKEN) return process.env.FABRIC_PBI_TOKEN.trim();
  try {
    const out = execFileSync(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        PBI_RESOURCE,
        '--query',
        'accessToken',
        '-o',
        'tsv',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      }
    );
    return out.trim();
  } catch (err) {
    throw new Error(
      'Could not acquire a Power BI access token. Either set FABRIC_PBI_TOKEN, ' +
        'or run `az login` so the Azure CLI can mint one. Original error: ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/** Escape a value for use inside a DAX double-quoted string literal. */
function daxStr(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Run a DAX query via the executeQueries REST endpoint and return plain row
 * objects with the surrounding `[Column]` brackets stripped from the keys.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dax(token, query, attempt = 0) {
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [{ query }],
      serializerSettings: { includeNulls: true },
    }),
  });
  const text = await res.text();
  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get('retry-after')) || 60;
    console.log(`  · rate-limited (429); waiting ${retryAfter}s then retrying…`);
    await sleep((retryAfter + 1) * 1000);
    return dax(token, query, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`executeQueries failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (json.error) {
    throw new Error(`DAX error: ${JSON.stringify(json.error)}`);
  }
  const rows = json.results?.[0]?.tables?.[0]?.rows ?? [];
  return rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k.replace(/^\[|\]$/g, '')] = v;
    }
    return clean;
  });
}

/** Chunk an array into batches of at most `size`. */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const toNum = (v) => (v == null ? null : Number(v));
const toStr = (v) => (v == null ? null : String(v));
// Normalise DAX dateTime (ISO) to a plain YYYY-MM-DD date string.
const toDate = (v) => (v == null ? null : String(v).slice(0, 10));

async function main() {
  console.log('▶ Syncing European Patents live data from Fabric…');
  console.log(`  dataset ${DATASET_ID}`);
  const token = getToken();

  // ── KPI totals (from the model's own measures) ──────────────────────────
  const [kpi] = await dax(
    token,
    'EVALUATE ROW(' +
      '"total", [Total Patents], ' +
      '"applicants", [Distinct Applicants], ' +
      '"inventors", [Distinct Inventors], ' +
      '"avg", [Avg Inventors per Patent])'
  );
  const stats = {
    totalPatents: toNum(kpi?.total) ?? 0,
    distinctApplicants: toNum(kpi?.applicants) ?? 0,
    distinctInventors: toNum(kpi?.inventors) ?? 0,
    avgInventors: Number((toNum(kpi?.avg) ?? 0).toFixed(1)),
    /** @type {Record<string, number>} */
    sectionCounts: {},
  };

  // ── IPC-section rollup (server-side aggregation for the chart) ──────────
  const sectionRows = await dax(
    token,
    'EVALUATE SELECTCOLUMNS(' +
      'SUMMARIZECOLUMNS(Patent[IPC Section], "c", [Total Patents]), ' +
      '"section", Patent[IPC Section], "count", [c])'
  );
  for (const r of sectionRows) {
    const s = toStr(r.section)?.trim().charAt(0).toUpperCase();
    if (s) stats.sectionCounts[s] = toNum(r.count) ?? 0;
  }

  // ── Bounded, most-recent slice of patents ───────────────────────────────
  const patentRows = await dax(
    token,
    `EVALUATE SELECTCOLUMNS(TOPN(${PATENT_SLICE}, Patent, Patent[Publication Date], DESC, Patent[Patent Number], DESC), ` +
      '"patent_number", Patent[Patent Number], ' +
      '"kind_code", Patent[Kind Code], ' +
      '"publication_country", Patent[Publication Country], ' +
      '"publication_date", Patent[Publication Date], ' +
      '"application_number", Patent[Application Number], ' +
      '"filing_date", Patent[Filing Date], ' +
      '"language", Patent[Language], ' +
      '"title_en", Patent[Title (English)], ' +
      '"main_ipc", Patent[Main IPC], ' +
      '"ipc_section", Patent[IPC Section], ' +
      '"first_applicant", Patent[First Applicant], ' +
      '"applicant_country", Patent[Applicant Country], ' +
      '"inventor_count", Patent[Inventor Count])'
  );

  const patentNumbers = patentRows
    .map((p) => toStr(p.patent_number))
    .filter((n) => n);

  // ── Children for exactly the sliced patents (batched IN filters) ────────
  /** @type {Record<string, {name: string|null; country: string|null; sequence: number|null}[]>} */
  const applicantsByPatent = {};
  /** @type {Record<string, {name: string|null; country: string|null; sequence: number|null}[]>} */
  const inventorsByPatent = {};
  /** @type {Record<string, {symbol: string|null; scheme: string|null; section: string|null}[]>} */
  const classificationsByPatent = {};

  // DAX IN-lists can get long; batch to keep each query comfortably sized.
  const batches = chunk(patentNumbers, 150);
  for (const batch of batches) {
    const list = batch.map(daxStr).join(', ');
    const [apps, invs, cls] = await Promise.all([
      dax(
        token,
        `EVALUATE SELECTCOLUMNS(FILTER(Applicant, Applicant[Patent Number] IN {${list}}), ` +
          '"patent_number", Applicant[Patent Number], ' +
          '"name", Applicant[Applicant Name], ' +
          '"country", Applicant[Applicant Country], ' +
          '"sequence", Applicant[Applicant Sequence])'
      ),
      dax(
        token,
        `EVALUATE SELECTCOLUMNS(FILTER(Inventor, Inventor[Patent Number] IN {${list}}), ` +
          '"patent_number", Inventor[Patent Number], ' +
          '"name", Inventor[Inventor Name], ' +
          '"country", Inventor[Inventor Country], ' +
          '"sequence", Inventor[Inventor Sequence])'
      ),
      dax(
        token,
        `EVALUATE SELECTCOLUMNS(FILTER(Classification, Classification[Patent Number] IN {${list}}), ` +
          '"patent_number", Classification[Patent Number], ' +
          '"symbol", Classification[Symbol], ' +
          '"scheme", Classification[Scheme], ' +
          '"section", Classification[Section])'
      ),
    ]);
    for (const a of apps) {
      const pn = toStr(a.patent_number);
      if (!pn) continue;
      (applicantsByPatent[pn] ??= []).push({
        name: toStr(a.name),
        country: toStr(a.country),
        sequence: toNum(a.sequence),
      });
    }
    for (const i of invs) {
      const pn = toStr(i.patent_number);
      if (!pn) continue;
      (inventorsByPatent[pn] ??= []).push({
        name: toStr(i.name),
        country: toStr(i.country),
        sequence: toNum(i.sequence),
      });
    }
    for (const c of cls) {
      const pn = toStr(c.patent_number);
      if (!pn) continue;
      (classificationsByPatent[pn] ??= []).push({
        symbol: toStr(c.symbol),
        scheme: toStr(c.scheme),
        section: toStr(c.section),
      });
    }
  }

  const bySeq = (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0);
  const patents = patentRows.map((p, idx) => {
    const pn = toStr(p.patent_number) ?? `row-${idx}`;
    return {
      id: pn, // stable client id = business key
      patent_number: pn,
      kind_code: toStr(p.kind_code),
      publication_country: toStr(p.publication_country),
      publication_date: toDate(p.publication_date),
      application_number: toStr(p.application_number),
      filing_date: toDate(p.filing_date),
      language: toStr(p.language),
      title_en: toStr(p.title_en),
      main_ipc: toStr(p.main_ipc),
      ipc_section: toStr(p.ipc_section),
      first_applicant: toStr(p.first_applicant),
      applicant_country: toStr(p.applicant_country),
      inventor_count: toNum(p.inventor_count),
      applicants: (applicantsByPatent[pn] ?? []).slice().sort(bySeq),
      inventors: (inventorsByPatent[pn] ?? []).slice().sort(bySeq),
      classifications: classificationsByPatent[pn] ?? [],
    };
  });

  // ── Applicant leaderboard (Top-N by distinct patents) ───────────────────
  const leaderRows = await dax(
    token,
    `EVALUATE TOPN(${APPLICANT_TOP}, SELECTCOLUMNS(` +
      'SUMMARIZECOLUMNS(Applicant[Applicant Name], Applicant[Applicant Country], ' +
      '"p", [Patents per Applicant]), ' +
      '"name", Applicant[Applicant Name], ' +
      '"country", Applicant[Applicant Country], ' +
      '"patents", [p]), [patents], DESC, [name], ASC)'
  );
  const leaderboard = leaderRows
    .map((r) => ({
      name: toStr(r.name),
      country: toStr(r.country),
      patents: toNum(r.patents) ?? 0,
    }))
    .filter((r) => r.name)
    .sort((a, b) => b.patents - a.patents || a.name.localeCompare(b.name));

  // ── Trends: applications / publications over time ───────────────────────
  const generatedAt = new Date().toISOString();
  // The Date dimension joins Patent on Publication Date, so publication-basis
  // buckets come straight from Date[Year Month]. Filing Date has no
  // relationship, so we group by the raw day and roll up to month in-script.
  const monthOf = (v) => {
    const s = toStr(v);
    if (!s) return null;
    // "YYYY-MM" already, or an ISO dateTime we truncate to month.
    return /^\d{4}-\d{2}$/.test(s) ? s : s.slice(0, 7);
  };

  const factsPublication = (
    await dax(
      token,
      'EVALUATE SELECTCOLUMNS(SUMMARIZECOLUMNS(' +
        '\'Date\'[Year Month], Patent[IPC Section], ' +
        'Patent[Publication Country], Patent[Applicant Country], ' +
        '"c", [Total Patents]), ' +
        '"period", \'Date\'[Year Month], ' +
        '"section", Patent[IPC Section], ' +
        '"pub_country", Patent[Publication Country], ' +
        '"app_country", Patent[Applicant Country], ' +
        '"count", [c])'
    )
  )
    .map((r) => ({
      period: monthOf(r.period),
      section: toStr(r.section),
      pubCountry: toStr(r.pub_country),
      appCountry: toStr(r.app_country),
      count: toNum(r.count) ?? 0,
    }))
    .filter((r) => r.period && r.count > 0);

  const factsFiling = rollupByMonth(
    (
      await dax(
        token,
        'EVALUATE SELECTCOLUMNS(SUMMARIZECOLUMNS(' +
          'Patent[Filing Date], Patent[IPC Section], ' +
          'Patent[Publication Country], Patent[Applicant Country], ' +
          '"c", [Total Patents]), ' +
          '"period", Patent[Filing Date], ' +
          '"section", Patent[IPC Section], ' +
          '"pub_country", Patent[Publication Country], ' +
          '"app_country", Patent[Applicant Country], ' +
          '"count", [c])'
      )
    )
      .map((r) => ({
        period: monthOf(r.period),
        section: toStr(r.section),
        pubCountry: toStr(r.pub_country),
        appCountry: toStr(r.app_country),
        count: toNum(r.count) ?? 0,
      }))
      .filter((r) => r.period && r.count > 0)
  );

  const schemePublication = (
    await dax(
      token,
      'EVALUATE SELECTCOLUMNS(SUMMARIZECOLUMNS(' +
        '\'Date\'[Year Month], Classification[Scheme], ' +
        'Classification[Section], "c", [Total Patents]), ' +
        '"period", \'Date\'[Year Month], ' +
        '"scheme", Classification[Scheme], ' +
        '"section", Classification[Section], ' +
        '"count", [c])'
    )
  )
    .map((r) => ({
      period: monthOf(r.period),
      scheme: toStr(r.scheme),
      section: toStr(r.section),
      count: toNum(r.count) ?? 0,
    }))
    .filter((r) => r.period && r.scheme && r.count > 0);

  const schemeFiling = rollupScheme(
    (
      await dax(
        token,
        'EVALUATE SELECTCOLUMNS(SUMMARIZECOLUMNS(' +
          'Patent[Filing Date], Classification[Scheme], ' +
          'Classification[Section], "c", [Total Patents]), ' +
          '"period", Patent[Filing Date], ' +
          '"scheme", Classification[Scheme], ' +
          '"section", Classification[Section], ' +
          '"count", [c])'
      )
    )
      .map((r) => ({
        period: monthOf(r.period),
        scheme: toStr(r.scheme),
        section: toStr(r.section),
        count: toNum(r.count) ?? 0,
      }))
      .filter((r) => r.period && r.scheme && r.count > 0)
  );

  const periods = [
    ...new Set(
      [...factsPublication, ...factsFiling].map((r) => r.period)
    ),
  ].sort();

  const trends = {
    generatedAt,
    periods,
    publication: { facts: factsPublication, scheme: schemePublication },
    filing: { facts: factsFiling, scheme: schemeFiling },
  };

  // ── Write assets ────────────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const meta = {
    generatedAt,
    datasetId: DATASET_ID,
    workspaceId: WORKSPACE_ID,
    source: 'semantic-model:executeQueries',
    readOnly: true,
    patentSlice: patents.length,
    applicantTop: leaderboard.length,
    trendPeriods: periods.length,
  };
  const write = (name, data) =>
    writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + '\n', 'utf8');

  write('meta.json', meta);
  write('stats.json', stats);
  write('patents.json', { generatedAt, patents });
  write('applicants.json', { generatedAt, leaderboard });
  write('trends.json', trends);

  console.log('✓ Live data written to', OUT_DIR);
  console.log(
    `  totals: ${stats.totalPatents} patents · ${stats.distinctApplicants} applicants · ` +
      `${stats.distinctInventors} inventors · avg ${stats.avgInventors}/patent`
  );
  console.log(
    `  slice: ${patents.length} patents · leaderboard: ${leaderboard.length} applicants`
  );
  console.log(
    `  trends: ${periods.length} periods · ${factsPublication.length}+${factsFiling.length} facts · ` +
      `${schemePublication.length}+${schemeFiling.length} scheme rows`
  );
}

/** Roll day-grain patent facts up to month, summing counts per dim combo. */
function rollupByMonth(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.period}|${r.section ?? ''}|${r.pubCountry ?? ''}|${r.appCountry ?? ''}`;
    const existing = map.get(key);
    if (existing) existing.count += r.count;
    else map.set(key, { ...r });
  }
  return [...map.values()];
}

/** Roll day-grain scheme facts up to month. */
function rollupScheme(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.period}|${r.scheme ?? ''}|${r.section ?? ''}`;
    const existing = map.get(key);
    if (existing) existing.count += r.count;
    else map.set(key, { ...r });
  }
  return [...map.values()];
}

main().catch((err) => {
  console.error('✗ Sync failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
