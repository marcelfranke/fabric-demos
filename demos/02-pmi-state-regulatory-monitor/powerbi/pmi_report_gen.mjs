// Deterministic PBIR generator for the "PMI Dynamic Pricing" report.
// Emits a .Report folder bound (byConnection) to the deployed Direct Lake
// semantic model. Re-run with: node pmi_report_gen.mjs
//
// Design: a LIGHT, premium corporate identity matching Philip Morris
// International's real brand — PMI blue #0074C2 dominant + blue tints, navy
// headlines, Lato (display) + Roboto (body), white cards on a light canvas.
// Four pages, each with a light hero header band. Page 4 (Regulatory Timeline)
// showcases the Date dimension added in PR #18. Sample-inspired KPI hero cards.
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

// ---- corporate identity (PMI real brand — light theme) ----
const CANVAS = '#F4F6FA'; // page canvas / wallpaper (very light cool gray)
const CARD = '#FFFFFF';   // cards / panels (white)
const HAIR = '#E6EBF2';   // hairline borders / gridlines / dividers
const INK = '#14213D';    // primary text (near-navy ink)
const MUTED = '#6B7A90';  // secondary / muted text
const BRAND = '#0074C2';  // PMI signature brand blue (KPI heroes, key series, accents)
const NAVY = '#00335C';   // deep navy (headlines, hero band text, dark bars)
const BAND = '#FFFFFF';   // hero header band surface (light)
// supporting blue tints
const SKY = '#4BA3DB';
const SKY2 = '#7FC4E8';
const SKY3 = '#D6E8F5';

// pricing_action palette in ALPHABETICAL category order, so Power BI assigns the
// theme dataColors palette to a category sorted ascending and each action gets
// its intended colour: adjust_for_tax, delist_banned, price_freely,
// restricted_assortment, watch_pending. Resaturated to read on white cards.
const ACTION_COLORS = ['#E8A23D', '#E0523E', '#2E9E6B', '#3D7DD8', '#7A5CD0'];
const ACTION_COLOR_MAP = {
  adjust_for_tax: '#E8A23D',       // amber
  delist_banned: '#E0523E',        // red / rose
  price_freely: '#2E9E6B',         // green
  restricted_assortment: '#3D7DD8',// blue
  watch_pending: '#7A5CD0',        // purple
};
const AMBER = '#E8A23D';           // excise-tax emphasis (single-fill tax bars)
const PROGRAM_COLOR_MAP = { VEEV: '#0074C2', ZYN: '#4BA3DB', IQOS: '#7FC4E8' };

// Lean, canonical visualStyles for the custom theme. Kept minimal because this
// ring silently drops the ENTIRE custom theme (dataColors included) if the
// visualStyles block contains any unsupported property. Toggled via env so the
// theme can be deployed with top-level fields only when bisecting.
const LEAN_VISUAL_STYLES = {
  '*': {
    '*': {
      background: [{ color: { solid: { color: CARD } }, show: true, transparency: 0 }],
      border: [{ color: { solid: { color: HAIR } }, show: true, radius: 10 }],
      dropShadow: [{ show: false }],
    },
  },
  page: {
    '*': {
      background: [{ color: { solid: { color: CANVAS } }, transparency: 0 }],
      outspace: [{ color: { solid: { color: CANVAS } }, transparency: 0 }],
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

// ---- light card surface styling applied to (almost) every visual ----
function cardVCO({ bg = CARD, border = true, title = false } = {}) {
  const vco = {
    background: [{ properties: { show: L('true'), color: solid(bg), transparency: L('0D') } }],
    border: [{ properties: { show: L(border ? 'true' : 'false'), color: solid(HAIR), radius: L('10D') } }],
    dropShadow: [{ properties: {
      show: L(border ? 'true' : 'false'), color: solid('#102A43'), position: L("'Outer'"),
      preset: L("'Custom'"), shadowSpread: L('2D'), shadowBlur: L('10D'),
      angle: L('90D'), shadowDistance: L('2D'), transparency: L('88D'),
    } }],
    title: [{ properties: { show: L(title ? 'true' : 'false') } }],
    visualHeader: [{ properties: { show: L('false') } }],
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

// KPI hero tiles — sample-inspired: a white rounded card with an uppercase
// muted caption at the top, a small brand-blue mark, and a big bold PMI-blue
// Lato number (classic single-value `card` visual; honors per-visual colour in
// BOTH the interactive service and the ExportTo render). Each measure entry is
// [entity, property, caption]. Returns a flat ARRAY of visuals (card + caption
// + mark per tile) laid out evenly across `pos`.
function card(pos, measures) {
  const n = measures.length;
  const gap = n > 1 ? 16 : 0;
  const w = n > 1 ? Math.floor((pos.width - gap * (n - 1)) / n) : pos.width;
  const out = [];
  measures.forEach(([e, p, caption], i) => {
    const x = pos.x + i * (w + gap);
    out.push(baseVisual(vid(), { x, y: pos.y, width: w, height: pos.height }, {
      visualType: 'card',
      query: { queryState: { Values: { projections: [projMeas(e, p)] } } },
      objects: {
        labels: [{ properties: {
          color: solid(BRAND), fontSize: L('34D'),
          fontFamily: L("'Lato, sans-serif'"), labelDisplayUnits: L('0D'),
        } }],
        categoryLabels: [{ properties: { show: L('false') } }],
        wordWrap: [{ properties: { show: L('true') } }],
      },
    }, cardVCO()));
    if (caption) out.push(textbox({ x: x + 18, y: pos.y + 14, width: w - 54, height: 16 }, [
      { value: caption.toUpperCase(), textStyle: { fontFamily: 'Roboto', fontSize: '10px', color: MUTED, letterSpacing: '1px', fontWeight: 'bold' } },
    ]));
    out.push(textbox({ x: x + w - 28, y: pos.y + 16, width: 12, height: 12 }, [], { fill: BRAND }));
  });
  return out;
}

// single-measure value card with custom colour/size/font — used by the Pricing
// Decision panel. Text measures (Selected State/Action/Recommendation) render as
// their string value. `colorMeasure` binds the callout colour to a measure that
// returns a hex string (field-value conditional formatting), so the action shows
// in its status colour. bg transparent so the decision panel reads as one card.
function valueCard(pos, e, p, { color = BRAND, size = 24, font = 'Lato, sans-serif', category = false, colorMeasure = null, align = 'left' } = {}) {
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
  }, cardVCO({ bg: '#EEF4FB', border: false }));
}

// one "rule type" mini-block for the Page-1 framing strip: white card + a
// status-coloured dot + a Lato label and its pricing consequence. Static text.
function ruleBlock(x, y, w, h, dot, title, sub) {
  return [
    textbox({ x, y, width: w, height: h }, [], { fill: CARD }),
    textbox({ x: x + 14, y: y + Math.round(h / 2) - 7, width: 14, height: 14 }, [], { fill: dot }),
    textbox({ x: x + 38, y: y + 10, width: w - 50, height: h - 18 }, [
      { value: title, textStyle: { fontFamily: 'Lato', fontSize: '13px', color: NAVY, fontWeight: 'bold' } },
      { value: '   ' + sub, textStyle: { fontFamily: 'Roboto', fontSize: '11px', color: MUTED } },
    ]),
  ];
}

function slicer(pos, e, p, header) {
  const vco = {
    ...cardVCO(),
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
        fontColor: solid(NAVY),
      } }],
      items: [{ properties: { fontColor: solid(INK) } }],
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
  return baseVisual(vid(), pos, v, cardVCO());
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
  return baseVisual(vid(), pos, v, cardVCO());
}

// per-visual LIGHT styling for tableEx / pivotTable: white rows on a light
// #F4F6FA alternate band, navy ink text, a brand-blue column-header row, and
// subtle #E6EBF2 gridlines. On a light theme the ExportTo-PDF renderer's opaque
// light cell fill (which fought the previous dark design) is a non-issue — the
// tables render clean and consistent in both the service and the PDF export.
function tableLightObjects({ pivot = false } = {}) {
  const hdr = { fontColor: solid('#FFFFFF'), backColor: solid(BRAND), fontFamily: L("'Roboto'"), bold: L('true') };
  const vals = {
    fontColor: solid(INK), backColor: solid(CARD),
    backColorSecondary: solid(CANVAS), fontColorSecondary: solid(INK),
    fontFamily: L("'Roboto'"),
  };
  const grid = {
    gridVertical: L('true'), gridVerticalColor: solid(HAIR),
    gridHorizontal: L('true'), gridHorizontalColor: solid(HAIR),
    outlineColor: solid(HAIR), rowPadding: L('5D'),
  };
  const o = {
    stylePreset: [{ properties: { name: L("'None'") } }],
    columnHeaders: [{ properties: hdr }],
    values: [{ properties: vals }],
    grid: [{ properties: grid }],
    total: [{ properties: { fontColor: solid(NAVY), backColor: solid('#EEF4FB'), bold: L('true') } }],
  };
  if (pivot) {
    o.rowHeaders = [{ properties: hdr }];
    o.subTotals = [{ properties: { fontColor: solid(NAVY), backColor: solid('#EEF4FB') } }];
    o.grandTotal = [{ properties: { fontColor: solid(NAVY), backColor: solid('#EEF4FB'), bold: L('true') } }];
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
    objects: tableLightObjects(),
  }, cardVCO());
}

function matrix(pos, rows, columns, values) {
  const qs = {
    Rows: { projections: rows.map(([e, p]) => projCol(e, p)) },
    Values: { projections: values.map((c) => (c[2] === 'm' ? projMeas(c[0], c[1]) : projCol(c[0], c[1]))) },
  };
  if (columns && columns.length) qs.Columns = { projections: columns.map(([e, p]) => projCol(e, p)) };
  return baseVisual(vid(), pos, { visualType: 'pivotTable', query: { queryState: qs }, objects: tableLightObjects({ pivot: true }) }, cardVCO());
}


const titleRun = (t) => [{ value: t, textStyle: { fontFamily: 'Lato', fontSize: '26px', color: NAVY, fontWeight: 'bold' } }];
const wordmarkRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '11px', color: MUTED, letterSpacing: '2px' } }];
const sectionRun = (t) => [{ value: t, textStyle: { fontFamily: 'Lato', fontSize: '14px', color: NAVY, fontWeight: 'bold' } }];
const noteRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '12px', color: MUTED } }];
const accentRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '12px', color: BRAND } }];

// hero header band: a slim WHITE band with a small PMI-blue mark, a navy Lato
// title, and a right-aligned muted wordmark. A thin #E6EBF2 divider separates it
// from the canvas — no accent line directly under the title (whitespace instead).
// Built from textboxes (their visualContainerObjects.background is reliably
// honoured by this ring; `shape` fills are not).
function header(title) {
  return [
    textbox({ x: 0, y: 0, width: 1280, height: 80 }, [], { fill: BAND }),
    textbox({ x: 0, y: 80, width: 1280, height: 1 }, [], { fill: HAIR }),
    textbox({ x: 24, y: 26, width: 8, height: 30 }, [], { fill: BRAND }),
    textbox({ x: 48, y: 22, width: 900, height: 40 }, titleRun(title)),
    textbox({ x: 760, y: 32, width: 496, height: 18 }, wordmarkRun('PMI · STATE REGULATORY MONITOR'), { align: 'right' }),
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
    ['PricingSignal', 'Total Signals', 'Total Signals'],
    ['PricingSignal', 'Restricted or Banned States', 'Restricted or Banned'],
    ['PricingSignal', 'Avg Tax Burden', 'Avg Tax Burden'],
    ['PricingSignal', 'Pending Risk States', 'Pending Risk States'],
    ['PricingSignal', 'Signals Needing Price Change', 'Needs Price Change'],
  ]));

  // left column — product slicer + reactive Pricing Decision card
  visuals.push(textbox({ x: 24, y: 268, width: 280, height: 18 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 290, width: 280, height: 60 }, 'Program', 'Name', 'Product line'));

  // T4: state-reactive Pricing Decision panel (cross-filtered by the map + product slicer)
  visuals.push(textbox({ x: 24, y: 362, width: 280, height: 342 }, [], { fill: '#EEF4FB' }));
  visuals.push(textbox({ x: 40, y: 376, width: 248, height: 14 }, [
    { value: 'PRICING DECISION', textStyle: { fontFamily: 'Roboto', fontSize: '11px', color: BRAND, letterSpacing: '2px', fontWeight: 'bold' } },
  ]));
  visuals.push(valueCard({ x: 34, y: 398, width: 262, height: 40 }, 'PricingSignal', 'Selected State', { color: NAVY, size: 22, font: 'Lato, sans-serif' }));
  visuals.push(textbox({ x: 40, y: 452, width: 110, height: 16 }, noteRun('Sellable?')));
  visuals.push(valueCard({ x: 150, y: 448, width: 130, height: 24 }, 'PricingSignal', 'Selected Sellable', { color: INK, size: 13, font: 'Roboto', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 482, width: 110, height: 16 }, noteRun('Tax burden %')));
  visuals.push(valueCard({ x: 150, y: 478, width: 130, height: 24 }, 'PricingSignal', 'Selected Tax Burden', { color: AMBER, size: 13, font: 'Roboto', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 512, width: 110, height: 16 }, noteRun('Pricing action')));
  visuals.push(valueCard({ x: 150, y: 508, width: 130, height: 24 }, 'PricingSignal', 'Selected Action', { size: 13, font: 'Roboto', colorMeasure: 'Selected Action Color', align: 'right' }));
  visuals.push(textbox({ x: 40, y: 544, width: 248, height: 16 }, noteRun('Recommendation')));
  visuals.push(valueCard({ x: 40, y: 562, width: 248, height: 134 }, 'PricingSignal', 'Selected Recommendation', { color: INK, size: 12, font: 'Roboto' }));

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
  visuals.push(...card({ x: 24, y: 96, width: 280, height: 120 }, [['PricingSignal', 'Avg Tax Burden', 'Avg Tax Burden']]));
  visuals.push(textbox({ x: 24, y: 232, width: 280, height: 20 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 256, width: 280, height: 76 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 344, width: 280, height: 20 }, sectionRun('Avg tax burden by program')));
  visuals.push(cartesian('columnChart', { x: 24, y: 368, width: 280, height: 160 }, 'Program', 'Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc', null,
    { fill: AMBER }));
  visuals.push(textbox({ x: 24, y: 540, width: 280, height: 164 }, noteRun(
    'State vapor excise tax burden (%). Above 20% → adjust price to protect margin. Colorado tops the list at 62%. VEEV vapor carries the excise load; ZYN pouches are not e-cigarettes.')));

  visuals.push(textbox({ x: 320, y: 96, width: 936, height: 20 }, sectionRun('States by excise tax burden (desc)')));
  const taxBar = cartesian('barChart', { x: 320, y: 120, width: 936, height: 288 }, 'State', 'State Name', 'PricingSignal', 'Avg Tax Burden', 'measureDesc', null,
    { fill: AMBER });
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

  visuals.push(...card({ x: 24, y: 96, width: 280, height: 120 }, [['PricingSignal', 'Signals with Effective Date', 'Signals with Effective Date']]));
  visuals.push(textbox({ x: 24, y: 232, width: 280, height: 20 }, sectionRun('Reporting year')));
  visuals.push(slicer({ x: 24, y: 256, width: 280, height: 120 }, 'Date', 'Year', 'Reporting year'));
  visuals.push(textbox({ x: 24, y: 396, width: 280, height: 308 }, noteRun(
    'CDC-dated regulatory activity over time. 34 of 60 signals carry a CDC effective date; the remaining 26 seed-driven flavor-ban / PMTA signals are undated by design — no fabricated dates.\n\nThe Date dimension connects to the fact only through PricingSignal[Effective Date], so only CDC-sourced signals are date-sliceable.')));

  visuals.push(textbox({ x: 320, y: 96, width: 936, height: 20 }, sectionRun('Signals by reporting year')));
  const line = cartesian('lineChart', { x: 320, y: 120, width: 936, height: 288 }, 'Date', 'Year', 'PricingSignal', 'Total Signals', 'catAsc', null,
    { fill: BRAND, lineWidth: 3 });
  line.filterConfig = { filters: [notBlankFilter('Date', 'Year')] };
  visuals.push(line);

  visuals.push(textbox({ x: 320, y: 420, width: 936, height: 20 }, sectionRun('Signals by reporting quarter')));
  const colq = cartesian('columnChart', { x: 320, y: 444, width: 936, height: 260 }, 'Date', 'Quarter Label', 'PricingSignal', 'Total Signals', 'catAsc', null,
    { fill: BRAND });
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

// ---- custom light theme (PMI corporate identity) ----
// Plain-value theme JSON (no expr wrappers). dataColors map pricing_action ->
// status palette; visualStyles turn every surface into a light PMI card with
// navy-ink text, Lato/Roboto typography, and a brand-blue KPI callout.
const themeFile = 'PMIPricing.json';
w(join(resDir, themeFile), {
  name: 'PMIPricing',
  dataColors: ACTION_COLORS,
  foreground: INK,
  foregroundNeutralSecondary: MUTED,
  foregroundNeutralTertiary: '#9AA6B8',
  background: CARD,
  backgroundLight: CANVAS,
  backgroundNeutral: HAIR,
  tableAccent: BRAND,
  good: '#2E9E6B', neutral: '#E8A23D', bad: '#E0523E',
  maximum: '#E0523E', center: '#E8A23D', minimum: '#2E9E6B',
  textClasses: {
    title: { fontFace: 'Lato', color: NAVY, fontSize: 14 },
    header: { fontFace: 'Lato', color: NAVY, fontSize: 12 },
    label: { fontFace: 'Roboto', color: INK, fontSize: 10 },
    callout: { fontFace: 'Lato', color: BRAND, fontSize: 40 },
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
      background: [{ properties: { color: solid(CANVAS), transparency: L('0D') } }],
      outspace: [{ properties: { color: solid(CANVAS), transparency: L('0D') } }],
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
