// Deterministic PBIR generator for the "PMI Dynamic Pricing" report.
// Emits a .Report folder bound (byConnection) to the deployed Direct Lake
// semantic model. Re-run with: node pmi_report_gen.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || join(process.cwd(), 'PMI Dynamic Pricing.Report');
const MODEL_ID = process.env.PMI_MODEL_ID || '6be9e165-fc81-4990-a479-a0cab935201c';

const SCHEMA = {
  vc: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  pages: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json',
  report: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json',
  version: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json',
  pbir: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json',
};

// pricing_action palette (alphabetical order = how Power BI assigns the theme
// dataColors palette to a category sorted ascending, so each action gets its
// intended colour): adjust_for_tax, delist_banned, price_freely,
// restricted_assortment, watch_pending
const ACTION_COLORS = ['#E8A317', '#C6395F', '#2E8B57', '#E8703A', '#5B5FC7'];

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

function sortByMeasureDesc(e, p) {
  return { sort: [{ field: meas(e, p), direction: 'Descending' }], isDefaultSort: false };
}
function sortByColumnAsc(e, p) {
  return { sort: [{ field: col(e, p), direction: 'Ascending' }], isDefaultSort: false };
}

// "is not blank" advanced filter on a column
function notBlankFilter(e, p) {
  return {
    name: fid(),
    field: col(e, p),
    type: 'Advanced',
    filter: {
      Version: 2,
      From: [{ Name: 'p', Entity: e, Type: 0 }],
      Where: [
        {
          Condition: {
            Not: {
              Expression: {
                Comparison: {
                  ComparisonKind: 0,
                  Left: { Column: { Expression: { SourceRef: { Source: 'p' } }, Property: p } },
                  Right: { Literal: { Value: 'null' } },
                },
              },
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

// categorical "in [values]" filter on a column
function inFilter(e, p, values) {
  return {
    name: fid(),
    field: col(e, p),
    type: 'Categorical',
    filter: {
      Version: 2,
      From: [{ Name: 'p', Entity: e, Type: 0 }],
      Where: [
        {
          Condition: {
            In: {
              Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: p } }],
              Values: values.map((v) => [{ Literal: { Value: `'${v}'` } }]),
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
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

// cartesian chart. sort: 'measureDesc' | 'catAsc' | null
function cartesian(type, pos, catE, catP, yE, yP, sort, legend) {
  const qs = {
    Category: { projections: [projCol(catE, catP)] },
    Y: { projections: [projMeas(yE, yP)] },
  };
  if (legend) qs.Series = { projections: [projCol(legend[0], legend[1])] };
  const v = { visualType: type, query: { queryState: qs } };
  if (sort === 'measureDesc') v.query.sortDefinition = sortByMeasureDesc(yE, yP);
  else if (sort === 'catAsc') v.query.sortDefinition = sortByColumnAsc(catE, catP);
  return baseVisual(vid(), pos, v);
}

// filled US map coloured by a legend category (pricing_action)
function filledMap(pos, locE, locP, legendE, legendP) {
  return baseVisual(vid(), pos, {
    visualType: 'filledMap',
    query: {
      queryState: {
        Category: { projections: [projCol(locE, locP)] },
        Series: { projections: [projCol(legendE, legendP)] },
      },
    },
  });
}

function table(pos, cols) {
  return baseVisual(vid(), pos, {
    visualType: 'tableEx',
    query: { queryState: { Values: { projections: cols.map((c) => (c[2] === 'm' ? projMeas(c[0], c[1]) : projCol(c[0], c[1]))) } } },
  });
}

function matrix(pos, rows, columns, values) {
  const qs = {
    Rows: { projections: rows.map(([e, p]) => projCol(e, p)) },
    Values: { projections: values.map((c) => (c[2] === 'm' ? projMeas(c[0], c[1]) : projCol(c[0], c[1]))) },
  };
  if (columns && columns.length) qs.Columns = { projections: columns.map(([e, p]) => projCol(e, p)) };
  return baseVisual(vid(), pos, { visualType: 'pivotTable', query: { queryState: qs } });
}

// ---- text run styles ----
const titleRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '24px', color: '#1B3A6B' } }];
const subRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI', fontSize: '12px', color: '#605E5C' } }];

// ================= PAGES =================
const pages = [];

// ---------- Page 1: Pricing Overview ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 980, height: 40 }, titleRun('PMI Dynamic Pricing — State Pricing Overview')));
  visuals.push(textbox({ x: 24, y: 58, width: 980, height: 20 }, subRun('Every US state screened before the dynamic-pricing engine sets a shelf price · Source: CDC STATE System + curated FDA/flavor-ban/registry layer')));
  visuals.push(card({ x: 24, y: 80, width: 1232, height: 118 }, [
    ['PricingSignal', 'Total Signals'],
    ['PricingSignal', 'Restricted or Banned States'],
    ['PricingSignal', 'Avg Tax Burden'],
    ['PricingSignal', 'Pending Risk States'],
    ['PricingSignal', 'Signals Needing Price Change'],
  ]));
  visuals.push(slicer({ x: 24, y: 210, width: 280, height: 96 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 320, width: 280, height: 380 }, subRun(
    'Map & bar are coloured by pricing action:\n\n■ price_freely (green)\n■ adjust_for_tax (amber)\n■ delist_banned (rose)\n■ restricted_assortment (orange)\n■ watch_pending (blue)\n\nUse the product-line slicer to isolate ZYN or VEEV — the two pricing heroes hit by tax + flavor bans.')));
  visuals.push(filledMap({ x: 320, y: 210, width: 620, height: 490 }, 'State', 'State Name', 'PricingSignal', 'Pricing Action'));
  visuals.push(cartesian('barChart', { x: 956, y: 210, width: 300, height: 490 }, 'PricingSignal', 'Pricing Action', 'PricingSignal', 'Total Signals', 'catAsc'));
  pages.push({ name, displayName: 'Pricing Overview', visuals });
}

// ---------- Page 2: Tax & Margin ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 980, height: 40 }, titleRun('Tax & Margin — Excise Burden by State')));
  visuals.push(textbox({ x: 24, y: 58, width: 980, height: 20 }, subRun('State vapor excise tax burden (%). >20% → adjust price to protect margin. Colorado tops the list at 62%.')));
  visuals.push(slicer({ x: 24, y: 96, width: 280, height: 96 }, 'Program', 'Name', 'Product line'));
  visuals.push(card({ x: 24, y: 210, width: 280, height: 118 }, [['PricingSignal', 'Avg Tax Burden']]));

  // states by tax burden (only taxed states), sorted desc
  const taxBar = cartesian('barChart', { x: 320, y: 96, width: 936, height: 300 }, 'State', 'State Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc');
  taxBar.filterConfig = { filters: [notBlankFilter('PricingSignal', 'Tax Burden')] };
  visuals.push(taxBar);

  // avg tax burden by program
  visuals.push(cartesian('columnChart', { x: 24, y: 340, width: 280, height: 360 }, 'Program', 'Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc'));

  // table of the taxed states
  const taxTable = table({ x: 320, y: 408, width: 936, height: 292 }, [
    ['State', 'State Name', 'c'],
    ['PricingSignal', 'Product Code', 'c'],
    ['PricingSignal', 'Avg Tax Burden', 'm'],
    ['PricingSignal', 'Pricing Action', 'c'],
    ['PricingSignal', 'Recommendation', 'c'],
  ]);
  taxTable.filterConfig = { filters: [notBlankFilter('PricingSignal', 'Tax Burden')] };
  visuals.push(taxTable);
  pages.push({ name, displayName: 'Tax & Margin', visuals });
}

// ---------- Page 3: Compliance & Assortment ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(textbox({ x: 24, y: 16, width: 980, height: 40 }, titleRun('Compliance & Assortment — Where SKUs Are Gated')));
  visuals.push(textbox({ x: 24, y: 58, width: 980, height: 20 }, subRun('Flavor bans → delist; PMTA registry laws → restricted assortment (price only FDA-listed SKUs); pending bills → watch.')));
  visuals.push(slicer({ x: 24, y: 96, width: 280, height: 96 }, 'Program', 'Name', 'Product line'));

  // clustered bar: signals by pricing action per program
  visuals.push(cartesian('clusteredBarChart', { x: 320, y: 96, width: 936, height: 236 }, 'PricingSignal', 'Pricing Action', 'PricingSignal', 'Total Signals', 'catAsc', ['Program', 'Name']));

  // matrix State x Program of pricing action + sellable
  visuals.push(matrix({ x: 24, y: 344, width: 760, height: 356 },
    [['State', 'State Name']],
    [['Program', 'Name']],
    [['PricingSignal', 'Pricing Action', 'c']]));

  // watch_pending list
  const pendTable = table({ x: 800, y: 344, width: 456, height: 356 }, [
    ['State', 'State Name', 'c'],
    ['PricingSignal', 'Product Code', 'c'],
    ['PricingSignal', 'Recommendation', 'c'],
  ]);
  pendTable.filterConfig = { filters: [inFilter('PricingSignal', 'Pricing Action', ['watch_pending', 'delist_banned', 'restricted_assortment'])] };
  visuals.push(pendTable);
  pages.push({ name, displayName: 'Compliance & Assortment', visuals });
}

// ================= WRITE FILES =================
const defDir = join(OUT, 'definition');
const pagesDir = join(defDir, 'pages');
const resDir = join(OUT, 'StaticResources', 'RegisteredResources');
mkdirSync(pagesDir, { recursive: true });
mkdirSync(resDir, { recursive: true });

const w = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');

// .platform (Fabric git-integration item identity — stable logicalId)
w(join(OUT, '.platform'), {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
  metadata: { displayName: 'PMI Dynamic Pricing', type: 'Report' },
  config: { logicalId: 'f61ef637-3851-40b5-b1a1-059768c9a7b7', version: '2.0' },
});

// definition.pbir (root) — thin/live report bound to the published model
w(join(OUT, 'definition.pbir'), {
  $schema: SCHEMA.pbir,
  version: '4.0',
  datasetReference: { byConnection: { connectionString: `semanticmodelid=${MODEL_ID}` } },
});
// version.json
w(join(defDir, 'version.json'), { $schema: SCHEMA.version, version: '2.0.0' });

// custom theme mapping pricing_action -> colours
const themeFile = 'PMIPricing.json';
w(join(resDir, themeFile), {
  name: 'PMIPricing',
  dataColors: ACTION_COLORS,
  foreground: '#1B3A6B',
  background: '#FFFFFF',
  tableAccent: '#1B3A6B',
});

// report.json (base shared theme + registered custom theme)
const RVI = { visual: '1.8.97', report: '2.0.97', page: '1.3.97' };
w(join(defDir, 'report.json'), {
  $schema: SCHEMA.report,
  themeCollection: {
    baseTheme: { name: 'CY24SU10', reportVersionAtImport: RVI, type: 'SharedResources' },
    customTheme: { name: 'PMIPricing', reportVersionAtImport: RVI, type: 'RegisteredResources' },
  },
  resourcePackages: [
    {
      name: 'RegisteredResources',
      type: 'RegisteredResources',
      items: [{ name: themeFile, path: themeFile, type: 'CustomTheme' }],
    },
  ],
});
// pages.json
w(join(pagesDir, 'pages.json'), { $schema: SCHEMA.pages, pageOrder: pages.map((p) => p.name), activePageName: pages[0].name });

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
console.log('Model:', MODEL_ID);
console.log('Pages:', pages.map((p) => `${p.displayName} (${p.visuals.length} visuals)`).join(' | '));
