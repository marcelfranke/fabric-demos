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
 *     never pull 420k rows to count them client-side),
 *   - the IPC-section rollup for the dashboard chart,
 *   - a bounded, most-recent slice of Publication rows with their Applicant /
 *     Inventor / Classification children for the list + detail views,
 *   - a Top-N applicant leaderboard.
 *
 * MODEL NOTE (2026 rewire): the semantic model was rebuilt from the old
 * publication-grain `Patent[...]` star to an application-grain Kimball star
 * (fact `Facts`, dims `Publication`/`Application`/`Applicant`/`Inventor`/`IPC`/
 * `Country`/`Tech Area`, link bridges `bridge_application_*`, `Date` import).
 * The app's notion of a "patent" maps to a *publication*, so `totalPatents` is
 * sourced from `[Total Publications]`. Applicant links exist only for granted
 * applications, so the most-recent publication slice (mostly ungranted 2011
 * filings) usually has no applicant children — this is a source characteristic,
 * not a bug. See meta.json `notes` for the full mapping decisions.
 *
 * Cross-platform: pure Node (ESM), no shell scripts. Auth token comes from
 * `FABRIC_PBI_TOKEN` when set (CI), otherwise from the Azure CLI (`az`).
 *
 * Usage:
 *   node scripts/sync-fabric.mjs
 * Env overrides:
 *   LIVE_ROW_LIMIT (bounded patent slice, default 1500; alias
 *   FABRIC_PATENT_SLICE), FABRIC_DATASET_ID, FABRIC_WORKSPACE_ID,
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
const PATENT_SLICE = Number(
  process.env.LIVE_ROW_LIMIT ?? process.env.FABRIC_PATENT_SLICE ?? 1500
);
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

const toNum = (v) => (v == null ? null : Number(v));
const toStr = (v) => (v == null ? null : String(v));
// Normalise DAX dateTime (ISO) to a plain YYYY-MM-DD date string.
const toDate = (v) => (v == null ? null : String(v).slice(0, 10));

async function main() {
  console.log('▶ Syncing European Patents live data from Fabric…');
  console.log(`  dataset ${DATASET_ID}`);
  const token = getToken();

  // ── KPI totals (from the model's own measures + inline distincts) ───────
  // Old→new: [Total Patents]→[Total Publications] (app "patent" = publication).
  // No Distinct Applicants/Inventors or Avg measures exist in the rebuilt
  // model, so distinct entity counts come from the dim tables and the average
  // is derived inline as inventor-links ÷ applications.
  const [kpi] = await dax(
    token,
    'EVALUATE ROW(' +
      '"total", [Total Publications], ' +
      '"applicants", COUNTROWS(Applicant), ' +
      '"inventors", COUNTROWS(Inventor), ' +
      '"avg", DIVIDE([Total Inventor Links], [Total Applications]))'
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
      'SUMMARIZECOLUMNS(IPC[IPC Section], "c", [Total Publications]), ' +
      '"section", IPC[IPC Section], "count", [c])'
  );
  for (const r of sectionRows) {
    const s = toStr(r.section)?.trim().charAt(0).toUpperCase();
    if (s) stats.sectionCounts[s] = toNum(r.count) ?? 0;
  }

  // ── Bounded, most-recent slice of publications ──────────────────────────
  // Publication grain, most-recent by publication date. Primary applicant /
  // main IPC come from the fact's Primary *SK columns via LOOKUPVALUE (no
  // relationship exists for those SKs); application_number / filing_date /
  // inventor_count via RELATED. `app_sk` is the join key to the child bridges
  // and is emitted as a STRING because the surrogate keys are 19-digit hashes
  // that exceed JS's safe-integer range (they must never round-trip as Number).
  const patentRows = await dax(
    token,
    `EVALUATE SELECTCOLUMNS(TOPN(${PATENT_SLICE}, Publication, Publication[Publication Date], DESC, Publication[Patent Number], DESC), ` +
      '"app_sk", Publication[Application SK] & "", ' +
      '"patent_number", Publication[Patent Number], ' +
      '"kind_code", Publication[Kind Code], ' +
      '"publication_country", Publication[Publication Country], ' +
      '"publication_date", Publication[Publication Date], ' +
      "\"application_number\", RELATED('Application'[Application Number]), " +
      "\"filing_date\", RELATED('Application'[Filing Date]), " +
      '"language", Publication[Language], ' +
      '"title_en", Publication[Title (English)], ' +
      '"main_ipc", LOOKUPVALUE(IPC[IPC Symbol], IPC[IPC SK], RELATED(Facts[Primary IPC SK])), ' +
      '"ipc_section", LOOKUPVALUE(IPC[IPC Section], IPC[IPC SK], RELATED(Facts[Primary IPC SK])), ' +
      '"first_applicant", LOOKUPVALUE(Applicant[Applicant Name], Applicant[Applicant SK], RELATED(Facts[Primary Applicant SK])), ' +
      '"applicant_country", LOOKUPVALUE(Applicant[Applicant Country], Applicant[Applicant SK], RELATED(Facts[Primary Applicant SK])), ' +
      '"inventor_count", RELATED(Facts[Inventor Count]))'
  );

  // ── Children for exactly the sliced publications ────────────────────────
  // Keyed by Application SK (a publication belongs to one application; several
  // publications can share an application). The TOPN set is recomputed inside
  // each child query as a DAX table variable and matched with CONTAINSROW, so
  // the hash surrogate keys stay server-side (never marshalled through JS).
  const TOP_APPS_DEF =
    `DEFINE VAR TopApps = SELECTCOLUMNS(TOPN(${PATENT_SLICE}, Publication, ` +
    'Publication[Publication Date], DESC, Publication[Patent Number], DESC), ' +
    '"ask", Publication[Application SK])';

  /** @type {Record<string, {name: string|null; country: string|null; sequence: number|null}[]>} */
  const applicantsByApp = {};
  /** @type {Record<string, {name: string|null; country: string|null; sequence: number|null}[]>} */
  const inventorsByApp = {};
  /** @type {Record<string, {symbol: string|null; scheme: string|null; section: string|null}[]>} */
  const classificationsByApp = {};

  const [apps, invs, cls] = await Promise.all([
    dax(
      token,
      `${TOP_APPS_DEF}\nEVALUATE SELECTCOLUMNS(` +
        'FILTER(bridge_application_applicant, CONTAINSROW(TopApps, bridge_application_applicant[Application SK])), ' +
        '"app_sk", bridge_application_applicant[Application SK] & "", ' +
        '"name", RELATED(Applicant[Applicant Name]), ' +
        '"country", RELATED(Applicant[Applicant Country]))'
    ),
    dax(
      token,
      `${TOP_APPS_DEF}\nEVALUATE SELECTCOLUMNS(` +
        'FILTER(bridge_application_inventor, CONTAINSROW(TopApps, bridge_application_inventor[Application SK])), ' +
        '"app_sk", bridge_application_inventor[Application SK] & "", ' +
        '"name", RELATED(Inventor[Inventor Name]), ' +
        '"country", RELATED(Inventor[Inventor Country]), ' +
        '"sequence", bridge_application_inventor[Inventor Sequence])'
    ),
    dax(
      token,
      `${TOP_APPS_DEF}\nEVALUATE SELECTCOLUMNS(` +
        'FILTER(bridge_application_ipc, CONTAINSROW(TopApps, bridge_application_ipc[Application SK])), ' +
        '"app_sk", bridge_application_ipc[Application SK] & "", ' +
        '"symbol", RELATED(IPC[IPC Symbol]), ' +
        '"section", RELATED(IPC[IPC Section]))'
    ),
  ]);
  for (const a of apps) {
    const sk = toStr(a.app_sk);
    if (!sk) continue;
    // The applicant bridge has no sequence column in the rebuilt model.
    (applicantsByApp[sk] ??= []).push({
      name: toStr(a.name),
      country: toStr(a.country),
      sequence: null,
    });
  }
  for (const i of invs) {
    const sk = toStr(i.app_sk);
    if (!sk) continue;
    (inventorsByApp[sk] ??= []).push({
      name: toStr(i.name),
      country: toStr(i.country),
      sequence: toNum(i.sequence),
    });
  }
  for (const c of cls) {
    const sk = toStr(c.app_sk);
    if (!sk) continue;
    // Only IPC is present in the rebuilt model; scheme is a constant label.
    (classificationsByApp[sk] ??= []).push({
      symbol: toStr(c.symbol),
      scheme: 'IPC',
      section: toStr(c.section),
    });
  }

  const bySeq = (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0);
  const patents = patentRows.map((p, idx) => {
    const pn = toStr(p.patent_number) ?? `row-${idx}`;
    const sk = toStr(p.app_sk) ?? '';
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
      applicants: (applicantsByApp[sk] ?? []).slice().sort(bySeq),
      inventors: (inventorsByApp[sk] ?? []).slice().sort(bySeq),
      classifications: classificationsByApp[sk] ?? [],
    };
  });

  // ── Applicant leaderboard (Top-N by publications) ───────────────────────
  // Old [Patents per Applicant] → [Total Publications] evaluated per applicant
  // (via the applicant link bridge). Consistent with totalPatents=publications.
  const leaderRows = await dax(
    token,
    `EVALUATE TOPN(${APPLICANT_TOP}, SELECTCOLUMNS(` +
      'SUMMARIZECOLUMNS(Applicant[Applicant Name], Applicant[Applicant Country], ' +
      '"p", [Total Publications]), ' +
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

  // ── Trends: publications over time (single-valued, fan-out-free) ────────
  // The old star exposed one denormalised IPC section + applicant country per
  // Patent row. The rebuilt star reaches those via multi-valued link bridges,
  // so grouping on them directly would multiply (fan out) the counts. To keep
  // each publication contributing exactly one fact row — and totals summing to
  // publication counts, as the app's aggregation logic assumes — we resolve a
  // single PRIMARY IPC section and PRIMARY applicant country per publication
  // from the fact's Primary *SK columns (LOOKUPVALUE), while publication
  // country is naturally single-valued. Counts come from COUNTX over the group.
  // Primary applicant SK is populated only for granted applications, so
  // app_country is null for ungranted publications (the page skips those).
  const generatedAt = new Date().toISOString();
  const monthOf = (v) => {
    const s = toStr(v);
    if (!s) return null;
    return /^\d{4}-\d{2}$/.test(s) ? s : s.slice(0, 7);
  };

  /**
   * Build a fan-out-free trends fact query keyed on a per-publication month
   * expression (publication month vs. filing month).
   */
  const trendFactsQuery = (periodExpr) =>
    'EVALUATE SELECTCOLUMNS(GROUPBY(ADDCOLUMNS(Publication, ' +
    `"period", ${periodExpr}, ` +
    '"pubC", Publication[Publication Country], ' +
    '"sec", LOOKUPVALUE(IPC[IPC Section], IPC[IPC SK], RELATED(Facts[Primary IPC SK])), ' +
    '"appC", LOOKUPVALUE(Applicant[Applicant Country], Applicant[Applicant SK], RELATED(Facts[Primary Applicant SK]))), ' +
    '[period], [pubC], [sec], [appC], "c", COUNTX(CURRENTGROUP(), 1)), ' +
    '"period", [period], "section", [sec], "pub_country", [pubC], ' +
    '"app_country", [appC], "count", [c])';

  const mapFacts = (rows) =>
    rows
      .map((r) => ({
        period: monthOf(r.period),
        section: toStr(r.section),
        pubCountry: toStr(r.pub_country),
        appCountry: toStr(r.app_country),
        count: toNum(r.count) ?? 0,
      }))
      .filter((r) => r.period && r.count > 0);

  const factsPublication = mapFacts(
    await dax(token, trendFactsQuery("RELATED('Date'[Year Month])"))
  );
  const factsFiling = mapFacts(
    await dax(
      token,
      trendFactsQuery("FORMAT(RELATED('Application'[Filing Date]), \"YYYY-MM\")")
    )
  );

  // Scheme facts: the rebuilt model has only IPC (no CPC), so the scheme
  // dimension is degenerate. Derive the section-over-time breakdown from the
  // primary-section facts above (scheme = constant "IPC"), preserving the
  // {period, scheme, section, count} shape the trends page consumes.
  const deriveScheme = (facts) => {
    const map = new Map();
    for (const r of facts) {
      if (!r.section) continue;
      const key = `${r.period}|${r.section}`;
      const existing = map.get(key);
      if (existing) existing.count += r.count;
      else
        map.set(key, {
          period: r.period,
          scheme: 'IPC',
          section: r.section,
          count: r.count,
        });
    }
    return [...map.values()];
  };
  const schemePublication = deriveScheme(factsPublication);
  const schemeFiling = deriveScheme(factsFiling);

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
    model: 'application-grain-kimball-2010-2011',
    notes: [
      'totalPatents is sourced from the [Total Publications] measure — the ' +
        "app's notion of a \"patent\" is a published EP document (publication).",
      'distinctApplicants / distinctInventors are dim-table row counts ' +
        '(COUNTROWS(Applicant) / COUNTROWS(Inventor)).',
      'avgInventors = [Total Inventor Links] / [Total Applications] ' +
        '(inventor links are recorded at application grain).',
      `The per-row patents slice is bounded to ${patents.length} most-recent ` +
        'publications by publication date; baking all ~420k publications as a ' +
        'static asset is impractical. KPIs, IPC rollup, leaderboard and trends ' +
        'are full server-side aggregates over all 2010–2011 data.',
      'Applicant links exist only for granted applications, so the recent ' +
        'publication slice (mostly ungranted 2011 filings) generally has no ' +
        'applicant children and null first_applicant / applicant_country.',
      'The applicant bridge has no sequence column, so applicant.sequence is null.',
      'The rebuilt model carries only IPC classifications (no CPC); ' +
        'classification.scheme and trend scheme facts are the constant "IPC".',
      'Trend facts use a single PRIMARY IPC section and PRIMARY applicant ' +
        'country per publication to avoid multi-valued bridge fan-out; ' +
        'app_country is null for ungranted publications.',
    ],
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

main().catch((err) => {
  console.error('✗ Sync failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
