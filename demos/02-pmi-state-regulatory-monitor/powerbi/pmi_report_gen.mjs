// Deterministic PBIR generator for the "PMI Dynamic Pricing" report.
// Emits a .Report folder bound (byConnection) to the deployed Direct Lake
// semantic model. Re-run with: node pmi_report_gen.mjs
//
// Design: a dark, premium "midnight ink + chartreuse" corporate identity that
// matches the PMI deck. Four pages, each with a hero header band. Page 4
// (Regulatory Timeline) showcases the Date dimension added in PR #18.
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

// ---- corporate identity (extracted from the PMI deck) ----
const INK = '#0A0911';    // canvas / wallpaper (midnight ink)
const PANEL = '#141221';  // cards / panels
const HAIR = '#2A2733';   // hairline borders / gridlines
const CREAM = '#F4ECDF';  // primary text
const MUTED = '#9A93A6';  // secondary text
const ACCENT = '#D4FF3A'; // signature chartreuse (KPI heroes, rules, emphasis)

// pricing_action palette in ALPHABETICAL category order, so Power BI assigns the
// theme dataColors palette to a category sorted ascending and each action gets
// its intended colour: adjust_for_tax, delist_banned, price_freely,
// restricted_assortment, watch_pending
const ACTION_COLORS = ['#FFB020', '#FF5C6A', '#5FD08B', '#5AA9FF', '#8A7CFF'];
const ACTION_COLOR_MAP = {
  adjust_for_tax: '#FFB020',
  delist_banned: '#FF5C6A',
  price_freely: '#5FD08B',
  restricted_assortment: '#5AA9FF',
  watch_pending: '#8A7CFF',
};
const PROGRAM_COLOR_MAP = { VEEV: '#5AA9FF', ZYN: '#8A7CFF', IQOS: '#D4FF3A' };

// Lean, canonical visualStyles for the custom theme. Kept minimal because this
// ring silently drops the ENTIRE custom theme (dataColors included) if the
// visualStyles block contains any unsupported property. Toggled via env so the
// theme can be deployed with top-level fields only when bisecting.
const LEAN_VISUAL_STYLES = {
  '*': {
    '*': {
      background: [{ color: { solid: { color: PANEL } }, show: true, transparency: 0 }],
      border: [{ color: { solid: { color: HAIR } }, show: true, radius: 6 }],
      dropShadow: [{ show: false }],
    },
  },
  page: {
    '*': {
      background: [{ color: { solid: { color: INK } }, transparency: 0 }],
      outspace: [{ color: { solid: { color: INK } }, transparency: 0 }],
    },
  },
};
const VISUAL_STYLES = process.env.PMI_NO_VISUAL_STYLES ? undefined : LEAN_VISUAL_STYLES;

// clean slate
try { rmSync(OUT, { recursive: true, force: true }); } catch {}
mkdirSync(OUT, { recursive: true });

const vid = () => crypto.randomBytes(10).toString('hex');
const pid = () => crypto.randomBytes(10).toString('hex');
const fid = () => 'Filter' + crypto.randomBytes(12).toString('hex');

// ---- expression helpers ----
const L = (v) => ({ expr: { Literal: { Value: v } } });
const solid = (c) => ({ solid: { color: L(`'${c}'`) } });
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

// ---- dark surface styling applied to (almost) every visual ----
function darkVCO({ bg = PANEL, border = true, title = false } = {}) {
  const vco = {
    background: [{ properties: { show: L('true'), color: solid(bg), transparency: L('0D') } }],
    border: [{ properties: { show: L(border ? 'true' : 'false'), color: solid(HAIR) } }],
    title: [{ properties: { show: L(title ? 'true' : 'false') } }],
  };
  return vco;
}

// ---- visual builders ----
function baseVisual(name, pos, visual, vco) {
  if (vco) visual.visualContainerObjects = vco;
  return { $schema: SCHEMA.vc, name, position: { z: 1000, tabOrder: 1000, ...pos }, visual };
}

// textbox — align: 'left' | 'right' | 'center'; fill: optional solid bg colour
function textbox(pos, runs, { align = 'left', fill = null } = {}) {
  const vco = {
    background: [{ properties: { show: L(fill ? 'true' : 'false'), ...(fill ? { color: solid(fill), transparency: L('0D') } : {}) } }],
    border: [{ properties: { show: L('false') } }],
    padding: [{ properties: {
      top: L('0D'), bottom: L('0D'), left: L('0D'), right: L('0D'),
    } }],
  };
  return baseVisual(vid(), pos, {
    visualType: 'textbox',
    objects: {
      general: [{ properties: { paragraphs: [{ textRuns: runs, horizontalTextAlignment: align }] } }],
    },
    visualContainerObjects: vco,
  });
}

// solid rectangle (used for the header band + accent rule)
function rect(pos, colr) {
  return baseVisual(vid(), pos, {
    visualType: 'shape',
    objects: {
      shape: [{ properties: { tileShape: { expr: { Literal: { Value: "'rectangle'" } } } } }],
      fill: [{ properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        fillColor: { solid: { color: L(`'${colr}'`) } },
        transparency: { expr: { Literal: { Value: '0D' } } },
      } }],
      outline: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }],
    },
  }, {
    background: [{ properties: { show: L('false') } }],
    border: [{ properties: { show: L('false') } }],
  });
}

// KPI tiles — classic single-value `card` visuals (honor per-visual colour
// objects in BOTH the interactive service and the ExportTo render, unlike the
// modern `cardVisual` whose face/callout ignore per-visual styling here).
// Returns an ARRAY (one tile per measure) laid out evenly across `pos`.
function card(pos, measures) {
  const n = measures.length;
  const gap = n > 1 ? 16 : 0;
  const w = n > 1 ? Math.floor((pos.width - gap * (n - 1)) / n) : pos.width;
  return measures.map(([e, p], i) => baseVisual(vid(), {
    x: pos.x + i * (w + gap), y: pos.y, width: w, height: pos.height,
  }, {
    visualType: 'card',
    query: { queryState: { Values: { projections: [projMeas(e, p)] } } },
    objects: {
      labels: [{ properties: {
        color: solid(ACCENT), fontSize: L('34D'),
        fontFamily: L("'Georgia, serif'"), labelDisplayUnits: L('0D'),
      } }],
      categoryLabels: [{ properties: {
        show: L('true'), color: solid(MUTED), fontSize: L('11D'),
        fontFamily: L("'Segoe UI'"),
      } }],
      wordWrap: [{ properties: { show: L('true') } }],
    },
  }, darkVCO()));
}

// single-measure value card with custom colour/size/font — used by the Pricing
// Decision panel. Text measures (Selected State/Action/Recommendation) render as
// their string value. `colorMeasure` binds the callout colour to a measure that
// returns a hex string (field-value conditional formatting), so the action shows
// in its status colour. bg transparent so the decision panel reads as one card.
function valueCard(pos, e, p, { color = ACCENT, size = 24, font = 'Georgia, serif', category = false, colorMeasure = null, align = 'left' } = {}) {
  const labelColor = colorMeasure
    ? { solid: { color: { expr: { Measure: { Expression: { SourceRef: { Entity: e } }, Property: colorMeasure } } } } }
    : solid(color);
  return baseVisual(vid(), pos, {
    visualType: 'card',
    query: { queryState: { Values: { projections: [projMeas(e, p)] } } },
    objects: {
      labels: [{ properties: { color: labelColor, fontSize: L(`${size}D`), fontFamily: L(`'${font}'`), labelDisplayUnits: L('0D'), horizontalAlignment: L(`'${align}'`) } }],
      categoryLabels: [{ properties: { show: L(category ? 'true' : 'false') } }],
      wordWrap: [{ properties: { show: L('true') } }],
    },
  }, darkVCO({ bg: '#17142A', border: false }));
}

// one "rule type" mini-block for the Page-1 framing strip: dark panel + a
// status-coloured dot + a Georgia label and its pricing consequence. Static text.
function ruleBlock(x, y, w, h, dot, title, sub) {
  return [
    textbox({ x, y, width: w, height: h }, [], { fill: PANEL }),
    textbox({ x: x + 14, y: y + Math.round(h / 2) - 7, width: 14, height: 14 }, [], { fill: dot }),
    textbox({ x: x + 38, y: y + 10, width: w - 50, height: h - 18 }, [
      { value: title, textStyle: { fontFamily: 'Georgia', fontSize: '13px', color: CREAM, fontWeight: 'bold' } },
      { value: '   ' + sub, textStyle: { fontFamily: 'Segoe UI', fontSize: '11px', color: MUTED } },
    ]),
  ];
}

function slicer(pos, e, p, header) {
  const vco = {
    ...darkVCO(),
    padding: [{ properties: { top: L('8D'), bottom: L('8D'), left: L('8D'), right: L('8D') } }],
  };
  return baseVisual(vid(), pos, {
    visualType: 'slicer',
    query: { queryState: { Values: { projections: [projCol(e, p)] } } },
    objects: {
      data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }],
      header: [{ properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        text: { expr: { Literal: { Value: `'${header}'` } } },
        fontColor: solid(CREAM),
      } }],
      items: [{ properties: { fontColor: solid(CREAM) } }],
    },
  }, vco);
}

// cartesian chart. type: 'barChart' | 'columnChart' | 'lineChart' | 'areaChart'
//                        | 'clusteredBarChart' | 'clusteredColumnChart'
// sort: 'measureDesc' | 'catAsc' | null
function cartesian(type, pos, catE, catP, yE, yP, sort, legend, opts = {}) {
  const qs = {
    Category: { projections: [projCol(catE, catP)] },
    Y: { projections: [projMeas(yE, yP)] },
  };
  if (legend) qs.Series = { projections: [projCol(legend[0], legend[1])] };
  const v = { visualType: type, query: { queryState: qs } };
  if (sort === 'measureDesc') v.query.sortDefinition = sortByMeasureDesc(yE, yP);
  else if (sort === 'catAsc') v.query.sortDefinition = sortByColumnAsc(catE, catP);
  // per-visual data colours (theme dataColors don't survive ExportTo)
  const objs = {};
  if (opts.byCategory) objs.dataPoint = dpByCategory(opts.byCategory.e, opts.byCategory.p, opts.byCategory.map);
  else if (opts.fill) objs.dataPoint = dpFill(opts.fill);
  if ((type === 'lineChart' || type === 'areaChart') && (opts.fill || opts.lineWidth)) {
    objs.lineStyles = [{ properties: {
      strokeWidth: L(`${opts.lineWidth || 3}D`), showMarker: L('true'),
      ...(opts.fill ? { lineColor: solid(opts.fill) } : {}),
    } }];
  }
  if (Object.keys(objs).length) v.objects = objs;
  return baseVisual(vid(), pos, v, darkVCO());
}

// filled US map coloured by a legend category (pricing_action)
function filledMap(pos, locE, locP, legendE, legendP, opts = {}) {
  const v = {
    visualType: 'filledMap',
    query: {
      queryState: {
        Category: { projections: [projCol(locE, locP)] },
        Series: { projections: [projCol(legendE, legendP)] },
      },
    },
  };
  if (opts.byCategory) v.objects = { dataPoint: dpByCategory(opts.byCategory.e, opts.byCategory.p, opts.byCategory.map) };
  return baseVisual(vid(), pos, v, darkVCO());
}

// per-visual dark styling for tableEx / pivotTable. IMPORTANT export limitation on
// this capacity: the ExportTo-PDF renderer paints table/matrix DATA cells with an
// opaque light fill that NO per-visual property overrides — we empirically tested
// static backColor, a measure-bound conditional-format fill, stylePreset:'None',
// backColor transparency, a rows-only "flat matrix", and a crosstab matrix; only
// `backColorSecondary` (the alternate band) and the visual container background
// survive. So in the PDF export these lists render dark headers + dark surround +
// dark ALTERNATE rows, with light PRIMARY rows. In the live interactive service the
// per-visual `values` styling applies and every row renders dark. We keep the fully
// specified dark styling here so the service render is correct; the export's light
// primary rows are a documented residual (see powerbi/README.md).
function tableDarkObjects({ pivot = false } = {}) {
  const hdr = { fontColor: solid(CREAM), backColor: solid('#1C1930'), fontFamily: L("'Segoe UI Semibold'"), bold: L('true') };
  const vals = {
    fontColor: solid(CREAM), backColor: solid(INK),
    backColorSecondary: solid(PANEL), fontColorSecondary: solid(CREAM),
    fontFamily: L("'Segoe UI'"),
  };
  const grid = {
    gridVertical: L('true'), gridVerticalColor: solid(HAIR),
    gridHorizontal: L('true'), gridHorizontalColor: solid(HAIR),
    outlineColor: solid(HAIR), rowPadding: L('4D'),
  };
  const o = {
    stylePreset: [{ properties: { name: L("'None'") } }],
    columnHeaders: [{ properties: hdr }],
    values: [{ properties: vals }],
    grid: [{ properties: grid }],
    total: [{ properties: { fontColor: solid(ACCENT), backColor: solid('#1C1930'), bold: L('true') } }],
  };
  if (pivot) {
    o.rowHeaders = [{ properties: hdr }];
    o.subTotals = [{ properties: { fontColor: solid(CREAM), backColor: solid('#1C1930') } }];
    o.grandTotal = [{ properties: { fontColor: solid(ACCENT), backColor: solid('#1C1930') } }];
  }
  return o;
}

// ---- per-visual data-series colours (theme dataColors don't survive ExportTo) ----
// single fill for every data point in the visual
function dpFill(color) {
  return [{ properties: { defaultColor: solid(color) } }];
}
// per-category fills: one dataPoint rule per category value, scoped by a literal
// comparison so each bar/segment/legend member gets its status colour.
function dpByCategory(e, p, mapping) {
  return Object.entries(mapping).map(([val, color]) => ({
    properties: { fill: solid(color) },
    selector: {
      data: [{
        scopeId: {
          Comparison: {
            ComparisonKind: 0,
            Left: { Column: { Expression: { SourceRef: { Entity: e } }, Property: p } },
            Right: { Literal: { Value: `'${val}'` } },
          },
        },
      }],
    },
  }));
}

function table(pos, cols) {
  return baseVisual(vid(), pos, {
    visualType: 'tableEx',
    query: { queryState: { Values: { projections: cols.map((c) => (c[2] === 'm' ? projMeas(c[0], c[1]) : projCol(c[0], c[1]))) } } },
    objects: tableDarkObjects(),
  }, darkVCO());
}

function matrix(pos, rows, columns, values) {
  const qs = {
    Rows: { projections: rows.map(([e, p]) => projCol(e, p)) },
    Values: { projections: values.map((c) => (c[2] === 'm' ? projMeas(c[0], c[1]) : projCol(c[0], c[1]))) },
  };
  if (columns && columns.length) qs.Columns = { projections: columns.map(([e, p]) => projCol(e, p)) };
  return baseVisual(vid(), pos, { visualType: 'pivotTable', query: { queryState: qs }, objects: tableDarkObjects({ pivot: true }) }, darkVCO());
}

// Rows-only "flat matrix" was evaluated as a way to get fully-dark rows in the
// ExportTo PDF, but this ring collapses a rows-only pivotTable to its first field
// (ignoring steppedLayout:false) and still renders it light — so it is unused.
// See tableDarkObjects() note for the full export-limitation write-up.


const titleRun = (t) => [{ value: t, textStyle: { fontFamily: 'Georgia', fontSize: '26px', color: CREAM, fontWeight: 'bold' } }];
const wordmarkRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI', fontSize: '11px', color: MUTED, letterSpacing: '2px' } }];
const sectionRun = (t) => [{ value: t, textStyle: { fontFamily: 'Georgia', fontSize: '14px', color: CREAM } }];
const noteRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI', fontSize: '12px', color: MUTED } }];
const accentRun = (t) => [{ value: t, textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '12px', color: ACCENT } }];

// hero header band: dark strip + Georgia title + chartreuse rule + right wordmark.
// Built from textboxes (their visualContainerObjects.background is reliably
// honoured by this ring; `shape` fills are not) so the band renders regardless
// of whether the custom theme is applied.
function header(title) {
  return [
    textbox({ x: 0, y: 0, width: 1280, height: 80 }, [], { fill: PANEL }),
    textbox({ x: 0, y: 80, width: 1280, height: 2 }, [], { fill: HAIR }),
    textbox({ x: 24, y: 16, width: 900, height: 36 }, titleRun(title), { fill: PANEL }),
    textbox({ x: 26, y: 58, width: 210, height: 3 }, [], { fill: ACCENT }),
    textbox({ x: 760, y: 30, width: 496, height: 18 }, wordmarkRun('PMI · STATE REGULATORY MONITOR'), { align: 'right', fill: PANEL }),
  ];
}

// ================= PAGES =================
const pages = [];

// ---------- Page 1: Command Center ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Command Center — State Pricing Signals'));

  // T3: three-rule-types framing strip — names the drivers and their pricing consequence.
  const sw = Math.floor((1232 - 32) / 3);
  visuals.push(...ruleBlock(24, 88, sw, 56, ACTION_COLOR_MAP.adjust_for_tax, 'EXCISE TAX', 'moves the margin floor'));
  visuals.push(...ruleBlock(24 + sw + 16, 88, sw, 56, ACTION_COLOR_MAP.delist_banned, 'FLAVOR BAN', 'SKU illegal → delist'));
  visuals.push(...ruleBlock(24 + 2 * (sw + 16), 88, 1256 - (24 + 2 * (sw + 16)), 56, ACTION_COLOR_MAP.restricted_assortment, 'PMTA REGISTRY LAW', 'gates the assortment'));

  // KPI hero row
  visuals.push(...card({ x: 24, y: 152, width: 1232, height: 100 }, [
    ['PricingSignal', 'Total Signals'],
    ['PricingSignal', 'Restricted or Banned States'],
    ['PricingSignal', 'Avg Tax Burden'],
    ['PricingSignal', 'Pending Risk States'],
    ['PricingSignal', 'Signals Needing Price Change'],
  ]));

  // left column — product slicer + reactive Pricing Decision card
  visuals.push(textbox({ x: 24, y: 268, width: 280, height: 18 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 290, width: 280, height: 60 }, 'Program', 'Name', 'Product line'));

  // T4: state-reactive Pricing Decision panel (cross-filtered by the map + product slicer)
  visuals.push(textbox({ x: 24, y: 362, width: 280, height: 342 }, [], { fill: '#17142A' }));
  visuals.push(textbox({ x: 40, y: 374, width: 248, height: 14 }, [
    { value: 'PRICING DECISION', textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '11px', color: ACCENT, letterSpacing: '2px' } },
  ]));
  visuals.push(valueCard({ x: 34, y: 390, width: 262, height: 42 }, 'PricingSignal', 'Selected State', { color: ACCENT, size: 22, font: 'Georgia, serif' }));
  visuals.push(textbox({ x: 40, y: 436, width: 80, height: 3 }, [], { fill: ACCENT }));
  visuals.push(textbox({ x: 40, y: 452, width: 110, height: 16 }, noteRun('Sellable?')));
  visuals.push(valueCard({ x: 150, y: 448, width: 130, height: 24 }, 'PricingSignal', 'Selected Sellable', { color: CREAM, size: 13, font: 'Segoe UI', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 482, width: 110, height: 16 }, noteRun('Tax burden %')));
  visuals.push(valueCard({ x: 150, y: 478, width: 130, height: 24 }, 'PricingSignal', 'Selected Tax Burden', { color: '#FFB020', size: 13, font: 'Segoe UI', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 512, width: 110, height: 16 }, noteRun('Pricing action')));
  visuals.push(valueCard({ x: 150, y: 508, width: 130, height: 24 }, 'PricingSignal', 'Selected Action', { size: 13, font: 'Segoe UI Semibold', colorMeasure: 'Selected Action Color', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 544, width: 248, height: 16 }, noteRun('Recommendation')));
  visuals.push(valueCard({ x: 40, y: 562, width: 248, height: 134 }, 'PricingSignal', 'Selected Recommendation', { color: CREAM, size: 12, font: 'Segoe UI' }));

  // centre — US map coloured by pricing action
  visuals.push(textbox({ x: 320, y: 268, width: 620, height: 18 }, sectionRun('Regulatory stringency by state')));
  visuals.push(filledMap({ x: 320, y: 290, width: 620, height: 414 }, 'State', 'State Name', 'PricingSignal', 'Pricing Action',
    { byCategory: { e: 'PricingSignal', p: 'Pricing Action', map: ACTION_COLOR_MAP } }));

  // right — signals-by-action bar (same action palette as the map)
  visuals.push(textbox({ x: 956, y: 268, width: 300, height: 18 }, sectionRun('Signals by action')));
  visuals.push(cartesian('barChart', { x: 956, y: 290, width: 300, height: 414 }, 'PricingSignal', 'Pricing Action', 'PricingSignal', 'Total Signals', 'catAsc', null,
    { byCategory: { e: 'PricingSignal', p: 'Pricing Action', map: ACTION_COLOR_MAP } }));

  pages.push({ name, displayName: 'Command Center', visuals });
}

// ---------- Page 2: Tax & Margin ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Tax & Margin — Excise Burden by State'));
  visuals.push(...card({ x: 24, y: 96, width: 280, height: 120 }, [['PricingSignal', 'Avg Tax Burden']]));
  visuals.push(textbox({ x: 24, y: 232, width: 280, height: 20 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 256, width: 280, height: 76 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 344, width: 280, height: 20 }, sectionRun('Avg tax burden by program')));
  visuals.push(cartesian('columnChart', { x: 24, y: 368, width: 280, height: 160 }, 'Program', 'Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc', null,
    { fill: '#FFB020' }));
  visuals.push(textbox({ x: 24, y: 540, width: 280, height: 164 }, noteRun(
    'State vapor excise tax burden (%). Above 20% → adjust price to protect margin. Colorado tops the list at 62%. VEEV vapor carries the excise load; ZYN pouches are not e-cigarettes.')));

  visuals.push(textbox({ x: 320, y: 96, width: 936, height: 20 }, sectionRun('States by excise tax burden (desc)')));
  const taxBar = cartesian('barChart', { x: 320, y: 120, width: 936, height: 288 }, 'State', 'State Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc', null,
    { fill: '#FFB020' });
  taxBar.filterConfig = { filters: [notBlankFilter('PricingSignal', 'Tax Burden')] };
  visuals.push(taxBar);

  visuals.push(textbox({ x: 320, y: 420, width: 936, height: 20 }, sectionRun('Taxed states — burden · action · recommendation')));
  const taxTable = table({ x: 320, y: 444, width: 936, height: 260 }, [
    ['State', 'State Name', 'c'],
    ['PricingSignal', 'Product Code', 'c'],
    ['PricingSignal', 'Tax Burden', 'c'],
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
  visuals.push(...header('Compliance & Assortment — Where SKUs Are Gated'));
  visuals.push(textbox({ x: 24, y: 96, width: 280, height: 20 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 120, width: 280, height: 84 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 216, width: 280, height: 120 }, noteRun(
    'Flavor bans → delist; PMTA registry laws → restricted assortment (price only FDA-listed SKUs); pending bills → watch.')));

  visuals.push(textbox({ x: 320, y: 96, width: 936, height: 20 }, sectionRun('Signals by action, per program')));
  visuals.push(cartesian('clusteredBarChart', { x: 320, y: 120, width: 936, height: 216 }, 'Program', 'Name', 'PricingSignal', 'Total Signals', 'catAsc', ['PricingSignal', 'Pricing Action'],
    { byCategory: { e: 'PricingSignal', p: 'Pricing Action', map: ACTION_COLOR_MAP } }));

  visuals.push(textbox({ x: 24, y: 352, width: 760, height: 20 }, sectionRun('State × Program — pricing action')));
  visuals.push(table({ x: 24, y: 376, width: 760, height: 328 }, [
    ['State', 'State Name', 'c'],
    ['PricingSignal', 'Product Code', 'c'],
    ['PricingSignal', 'Pricing Action', 'c'],
  ]));

  visuals.push(textbox({ x: 800, y: 352, width: 456, height: 20 }, sectionRun('Gated states — delist · restricted · watch')));
  const pendTable = table({ x: 800, y: 376, width: 456, height: 328 }, [
    ['State', 'State Name', 'c'],
    ['PricingSignal', 'Product Code', 'c'],
    ['PricingSignal', 'Recommendation', 'c'],
  ]);
  pendTable.filterConfig = { filters: [inFilter('PricingSignal', 'Pricing Action', ['watch_pending', 'delist_banned', 'restricted_assortment'])] };
  visuals.push(pendTable);
  pages.push({ name, displayName: 'Compliance & Assortment', visuals });
}

// ---------- Page 4: Regulatory Timeline (Date dimension) ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Regulatory Timeline — CDC Activity Over Time'));

  visuals.push(...card({ x: 24, y: 96, width: 280, height: 120 }, [['PricingSignal', 'Signals with Effective Date']]));
  visuals.push(textbox({ x: 24, y: 232, width: 280, height: 20 }, sectionRun('Reporting year')));
  visuals.push(slicer({ x: 24, y: 256, width: 280, height: 120 }, 'Date', 'Year', 'Reporting year'));
  visuals.push(textbox({ x: 24, y: 396, width: 280, height: 308 }, noteRun(
    'CDC-dated regulatory activity over time. 34 of 60 signals carry a CDC effective date; the remaining 26 seed-driven flavor-ban / PMTA signals are undated by design — no fabricated dates.\n\nThe Date dimension connects to the fact only through PricingSignal[Effective Date], so only CDC-sourced signals are date-sliceable.')));

  visuals.push(textbox({ x: 320, y: 96, width: 936, height: 20 }, sectionRun('Signals by reporting year')));
  const line = cartesian('lineChart', { x: 320, y: 120, width: 936, height: 288 }, 'Date', 'Year', 'PricingSignal', 'Total Signals', 'catAsc', null,
    { fill: ACCENT, lineWidth: 3 });
  line.filterConfig = { filters: [notBlankFilter('Date', 'Year')] };
  visuals.push(line);

  visuals.push(textbox({ x: 320, y: 420, width: 936, height: 20 }, sectionRun('Signals by reporting quarter')));
  const colq = cartesian('columnChart', { x: 320, y: 444, width: 936, height: 260 }, 'Date', 'Quarter Label', 'PricingSignal', 'Total Signals', 'catAsc', null,
    { fill: ACCENT });
  colq.filterConfig = { filters: [notBlankFilter('Date', 'Year')] };
  visuals.push(colq);
  pages.push({ name, displayName: 'Regulatory Timeline', visuals });
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

// ---- custom dark theme ----
// Plain-value theme JSON (no expr wrappers). dataColors map pricing_action ->
// status palette; visualStyles turn every surface dark with cream text and a
// chartreuse KPI callout.
const themeFile = 'PMIPricing.json';
w(join(resDir, themeFile), {
  name: 'PMIPricing',
  dataColors: ACTION_COLORS,
  foreground: CREAM,
  foregroundNeutralSecondary: MUTED,
  foregroundNeutralTertiary: '#6E6880',
  background: INK,
  backgroundLight: PANEL,
  backgroundNeutral: HAIR,
  tableAccent: ACCENT,
  good: '#5FD08B', neutral: '#FFB020', bad: '#FF5C6A',
  maximum: '#FF5C6A', center: '#FFB020', minimum: '#5FD08B',
  textClasses: {
    title: { fontFace: 'Georgia', color: CREAM, fontSize: 14 },
    header: { fontFace: 'Georgia', color: CREAM, fontSize: 12 },
    label: { fontFace: 'Segoe UI', color: CREAM, fontSize: 10 },
    callout: { fontFace: 'Georgia', color: ACCENT, fontSize: 40 },
  },
  visualStyles: VISUAL_STYLES,
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
    objects: {
      background: [{ properties: { color: solid(INK), transparency: L('0D') } }],
      outspace: [{ properties: { color: solid(INK), transparency: L('0D') } }],
    },
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
