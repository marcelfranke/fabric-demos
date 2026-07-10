// Deterministic PBIR generator for the "European Patents" report.
// Emits a .Report folder bound (byConnection) to the deployed semantic model.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || join(process.cwd(), 'European Patents.Report');
const MODEL_ID = '4ff3efcc-8540-4349-9d2e-0dcf149e3332';

const SCHEMA = {
  vc: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  pages: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/2.0.0/schema.json',
  report: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.0.0/schema.json',
  version: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/version/1.0.0/schema.json',
  pbir: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json',
};

// clean slate
try { rmSync(OUT, { recursive: true, force: true }); } catch {}
mkdirSync(OUT, { recursive: true });

const vid = () => crypto.randomBytes(10).toString('hex');
const pid = () => crypto.randomBytes(10).toString('hex');
const fid = () => 'Filter' + crypto.randomBytes(12).toString('hex');

// ---- expression helpers ----
const col = (e, p) => ({ Column: { Expression: { SourceRef: { Entity: e } }, Property: p } });
const meas = (e, p) => ({ Measure: { Expression: { SourceRef: { Entity: e } }, Property: p } });
const projCol = (e, p) => ({ field: col(e, p), queryRef: `${e}.${p}`, nativeQueryRef: p });
const projMeas = (e, p) => ({ field: meas(e, p), queryRef: `${e}.${p}`, nativeQueryRef: p });

// TopN visual-level filter: keep top N of `catEntity[catCol]` by CountNonNull(orderEntity[orderCol])
function topNFilter(catEntity, catCol, orderEntity, orderCol, n) {
  const alias = catEntity.toLowerCase().slice(0, 3);
  return {
    name: fid(),
    field: col(catEntity, catCol),
    type: 'TopN',
    filter: {
      Version: 2,
      From: [
        {
          Name: 'subquery',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [{ Name: alias, Entity: catEntity, Type: 0 }],
                Select: [
                  { Column: { Expression: { SourceRef: { Source: alias } }, Property: catCol }, Name: 'field' },
                ],
                OrderBy: [
                  {
                    Direction: 2,
                    Expression: {
                      Aggregation: {
                        Expression: { Column: { Expression: { SourceRef: { Source: alias } }, Property: orderCol } },
                        Function: 5,
                      },
                    },
                  },
                ],
                Top: n,
              },
            },
          },
          Type: 2,
        },
        { Name: alias, Entity: catEntity, Type: 0 },
      ],
      Where: [
        {
          Condition: {
            In: {
              Expressions: [{ Column: { Expression: { SourceRef: { Source: alias } }, Property: catCol } }],
              Table: { SourceRef: { Source: 'subquery' } },
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

function sortByMeasureDesc(e, p) {
  return { sort: [{ field: meas(e, p), direction: 'Descending' }], isDefaultSort: false };
}

// ---- visual builders ----
function baseVisual(name, pos, visual) {
  return { $schema: SCHEMA.vc, name, position: { z: 1000, tabOrder: 1000, ...pos }, visual };
}

function textbox(pos, runs) {
  return baseVisual(vid(), pos, {
    visualType: 'textbox',
    objects: {
      general: [{ properties: { paragraphs: [{ textRuns: runs, horizontalTextAlignment: 'left' }] } }],
    },
    visualContainerObjects: {
      background: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }],
      border: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }],
      padding: [{ properties: {
        top: { expr: { Literal: { Value: '0D' } } }, bottom: { expr: { Literal: { Value: '0D' } } },
        left: { expr: { Literal: { Value: '0D' } } }, right: { expr: { Literal: { Value: '0D' } } },
      } }],
    },
  });
}

function card(pos, measures) {
  return baseVisual(vid(), pos, {
    visualType: 'cardVisual',
    query: { queryState: { Data: { projections: measures.map(([e, p]) => projMeas(e, p)) } } },
  });
}

function slicer(pos, e, p, header) {
  return baseVisual(vid(), pos, {
    visualType: 'slicer',
    query: { queryState: { Values: { projections: [projCol(e, p)] } } },
    objects: {
      data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }],
      header: [{ properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        text: { expr: { Literal: { Value: `'${header}'` } } },
      } }],
    },
    visualContainerObjects: {
      padding: [{ properties: {
        top: { expr: { Literal: { Value: '8D' } } }, bottom: { expr: { Literal: { Value: '8D' } } },
        left: { expr: { Literal: { Value: '8D' } } }, right: { expr: { Literal: { Value: '8D' } } },
      } }],
    },
  });
}

function cartesian(type, pos, catE, catP, yE, yP, sort) {
  const v = {
    visualType: type,
    query: {
      queryState: {
        Category: { projections: [projCol(catE, catP)] },
        Y: { projections: [projMeas(yE, yP)] },
      },
    },
  };
  if (sort) v.query.sortDefinition = sortByMeasureDesc(yE, yP);
  return baseVisual(vid(), pos, v);
}

function donut(pos, catE, catP, yE, yP) {
  return baseVisual(vid(), pos, {
    visualType: 'donutChart',
    query: { queryState: { Category: { projections: [projCol(catE, catP)] }, Y: { projections: [projMeas(yE, yP)] } } },
  });
}

function treemap(pos, gE, gP, vE, vP) {
  return baseVisual(vid(), pos, {
    visualType: 'treemap',
    query: {
      queryState: { Group: { projections: [projCol(gE, gP)] }, Values: { projections: [projMeas(vE, vP)] } },
      sortDefinition: sortByMeasureDesc(vE, vP),
    },
  });
}

function pivot(pos, rows, values) {
  return baseVisual(vid(), pos, {
    visualType: 'pivotTable',
    query: {
      queryState: {
        Rows: { projections: rows.map(([e, p]) => projCol(e, p)) },
        Values: { projections: values.map(([e, p]) => projMeas(e, p)) },
      },
    },
  });
}

function azureMap(pos, catE, catP, sizeE, sizeP) {
  return baseVisual(vid(), pos, {
    visualType: 'azureMap',
    query: { queryState: { Category: { projections: [projCol(catE, catP)] }, Size: { projections: [projMeas(sizeE, sizeP)] } } },
  });
}

// ---- text run styles ----
const titleRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '24px', color: '#1B3A6B' } }];
const subRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI', fontSize: '12px', color: '#605E5C' } }];

// ================= PAGES =================
const pages = [];

// ---------- Page 1: Overview ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 900, height: 40 }, titleRun('European Patents — Overview')));
  visuals.push(textbox({ x: 24, y: 58, width: 900, height: 20 }, subRun('EP publications, January 2026 · Source: EPO Publication Server')));
  visuals.push(card({ x: 24, y: 80, width: 1232, height: 118 }, [
    ['Patent', 'Total Patents'],
    ['Applicant', 'Distinct Applicants'],
    ['Inventor', 'Distinct Inventors'],
    ['Patent', 'Avg Inventors per Patent'],
  ]));
  visuals.push(slicer({ x: 24, y: 210, width: 280, height: 80 }, 'Date', 'Year Month', 'Year-Month'));
  visuals.push(slicer({ x: 24, y: 298, width: 280, height: 80 }, 'Patent', 'IPC Section', 'IPC Section'));
  visuals.push(slicer({ x: 24, y: 386, width: 280, height: 80 }, 'Patent', 'Kind Code', 'Kind Code'));
  visuals.push(slicer({ x: 24, y: 474, width: 280, height: 80 }, 'Patent', 'Language', 'Language'));
  visuals.push(cartesian('columnChart', { x: 320, y: 210, width: 936, height: 250 }, 'Date', 'Year Week', 'Patent', 'Total Patents', false));
  visuals.push(cartesian('barChart', { x: 320, y: 476, width: 456, height: 224 }, 'Patent', 'IPC Section', 'Patent', 'Total Patents', true));
  visuals.push(donut({ x: 792, y: 476, width: 464, height: 224 }, 'Patent', 'Kind Code', 'Patent', 'Total Patents'));
  pages.push({ name, displayName: 'Overview', visuals });
}

// ---------- Page 2: Technology & Classification ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 900, height: 40 }, titleRun('Technology & Classification')));
  visuals.push(slicer({ x: 24, y: 72, width: 280, height: 80 }, 'Classification', 'Scheme', 'Scheme (IPC/CPC)'));
  visuals.push(slicer({ x: 24, y: 160, width: 280, height: 80 }, 'Classification', 'Section', 'Section (A–H)'));
  visuals.push(cartesian('barChart', { x: 320, y: 72, width: 936, height: 228 }, 'Classification', 'Section', 'Classification', 'Patents per Classification', true));
  visuals.push(treemap({ x: 24, y: 312, width: 604, height: 388 }, 'Classification', 'Symbol', 'Classification', 'Patents per Classification'));
  visuals.push(pivot({ x: 648, y: 312, width: 608, height: 388 },
    [['Classification', 'Section'], ['Classification', 'Symbol']],
    [['Classification', 'Total Classifications'], ['Classification', 'Patents per Classification']]));
  pages.push({ name, displayName: 'Technology & Classification', visuals });
}

// ---------- Page 3: Applicants & Inventors ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 900, height: 40 }, titleRun('Applicants & Inventors')));

  const appBar = cartesian('barChart', { x: 24, y: 72, width: 604, height: 360 }, 'Applicant', 'Applicant Name', 'Applicant', 'Patents per Applicant', true);
  appBar.filterConfig = { filters: [topNFilter('Applicant', 'Applicant Name', 'Applicant', 'Patent Number', 15)] };
  visuals.push(appBar);

  const invBar = cartesian('barChart', { x: 648, y: 72, width: 608, height: 360 }, 'Inventor', 'Inventor Name', 'Inventor', 'Patents per Inventor', true);
  invBar.filterConfig = { filters: [topNFilter('Inventor', 'Inventor Name', 'Inventor', 'Patent Number', 15)] };
  visuals.push(invBar);

  visuals.push(azureMap({ x: 24, y: 448, width: 604, height: 252 }, 'Applicant', 'Applicant Country', 'Applicant', 'Patents per Applicant'));
  visuals.push(pivot({ x: 648, y: 448, width: 608, height: 252 },
    [['Applicant', 'Applicant Name'], ['Applicant', 'Applicant Country']],
    [['Applicant', 'Patents per Applicant']]));
  pages.push({ name, displayName: 'Applicants & Inventors', visuals });
}

// ================= WRITE FILES =================
const defDir = join(OUT, 'definition');
const pagesDir = join(defDir, 'pages');
mkdirSync(pagesDir, { recursive: true });

const w = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');

// definition.pbir (root)
w(join(OUT, 'definition.pbir'), {
  $schema: SCHEMA.pbir,
  version: '4.0',
  datasetReference: { byConnection: { connectionString: `semanticmodelid=${MODEL_ID}` } },
});
// version.json
w(join(defDir, 'version.json'), { $schema: SCHEMA.version, version: '1.0' });
// report.json
w(join(defDir, 'report.json'), {
  $schema: SCHEMA.report,
  themeCollection: { baseTheme: { name: 'CY24SU10', reportVersionAtImport: '5.61', type: 'SharedResources' } },
});
// pages.json
w(join(pagesDir, 'pages.json'), { $schema: SCHEMA.pages, pageOrder: pages.map(p => p.name), activePageName: pages[0].name });

for (const pg of pages) {
  const pDir = join(pagesDir, pg.name);
  const vDir = join(pDir, 'visuals');
  mkdirSync(vDir, { recursive: true });
  w(join(pDir, 'page.json'), {
    $schema: SCHEMA.page,
    name: pg.name,
    displayName: pg.displayName,
    displayOption: 'FitToPage',
    height: 720,
    width: 1280,
  });
  for (const v of pg.visuals) {
    const dir = join(vDir, v.name);
    mkdirSync(dir, { recursive: true });
    w(join(dir, 'visual.json'), v);
  }
}

console.log('Generated report at:', OUT);
console.log('Pages:', pages.map(p => `${p.displayName} (${p.visuals.length} visuals)`).join(' | '));
