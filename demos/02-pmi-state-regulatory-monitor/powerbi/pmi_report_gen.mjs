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

// ---- corporate identity (PMI real brand — Value Report 2025 light + deep-blue two-tone) ----
const CANVAS = '#F7F9FC'; // page canvas / wallpaper (near-white, very slightly cool)
const CARD = '#FFFFFF';   // white cards / panels
const TINT = '#EAF3FB';   // light-blue tint card fill (secondary / notes / decision panel)
const BORDER = '#CFE0F2'; // thin blue card border
const HAIR = '#E6EBF2';   // hairline gridlines / dividers
const ALT = '#F4F6FA';    // table alternate-row banding
const INK = '#14213D';    // primary / headline text (near-black navy — headlines look almost black)
const MUTED = '#6B7A90';  // secondary / muted text
const BRAND = '#0074C2';  // PMI signature brand blue (key series, accents, active nav underline)
const NAVY = '#00335C';   // deep navy (secondary headings)
const HERO = '#0A5AB5';   // solid deep-blue KPI-hero card fill (white text) — the PMI "pop"
const BAND = '#FFFFFF';   // nav-pill surface (light)
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
      border: [{ color: { solid: { color: BORDER } }, show: true, radius: 14 }],
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
// PMI Value Report 2025 card: white fill, thin blue #CFE0F2 border, ~14px rounded
// corners, soft shadow. Variants: bg (deep-blue HERO / tint), borderless, radius.
function cardVCO({ bg = CARD, border = true, borderColor = BORDER, radius = 14, shadow = false, title = false } = {}) {
  const vco = {
    background: [{ properties: { show: L('true'), color: solid(bg), transparency: L('0D') } }],
    border: [{ properties: { show: L(border ? 'true' : 'false'), color: solid(borderColor), radius: L(`${radius}D`) } }],
    dropShadow: [{ properties: {
      show: L(shadow ? 'true' : 'false'), color: solid('#102A43'), position: L("'Outer'"),
      preset: L("'Custom'"), shadowSpread: L('1D'), shadowBlur: L('12D'),
      angle: L('90D'), shadowDistance: L('2D'), transparency: L('86D'),
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

// textbox — align: 'left' | 'right' | 'center'; fill: optional solid bg colour;
// radius/border: optional rounded pill / bordered surface (nav strip)
function textbox(pos, runs, { align = 'left', fill = null, radius = 0, border = null } = {}) {
  const hasEdge = radius || border;
  const vco = {
    background: [{ properties: { show: L(fill ? 'true' : 'false'), ...(fill ? { color: solid(fill), transparency: L('0D') } : {}) } }],
    border: [{ properties: hasEdge
      ? { show: L('true'), color: solid(border || HAIR), radius: L(`${radius}D`) }
      : { show: L('false') } }],
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

// KPI hero tiles — PMI Value Report 2025 signature "pop": a solid DEEP-BLUE
// rounded card (#0A5AB5) with a big bold WHITE Lato number and a small uppercase
// WHITE caption (classic single-value `card` visual; honors the per-visual white
// callout colour in BOTH the interactive service and the ExportTo render). Each
// measure entry is [entity, property, caption]. Returns a flat ARRAY of visuals
// (card + caption per tile) laid out evenly across `pos`.
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
          color: solid('#FFFFFF'), fontSize: L('36D'),
          fontFamily: L("'Lato, sans-serif'"), labelDisplayUnits: L('0D'),
        } }],
        categoryLabels: [{ properties: { show: L('false') } }],
        wordWrap: [{ properties: { show: L('true') } }],
      },
    }, cardVCO({ bg: HERO, border: false, radius: 16 })));
    if (caption) out.push(textbox({ x: x + 18, y: pos.y + 16, width: w - 36, height: 16 }, [
      { value: caption.toUpperCase(), textStyle: { fontFamily: 'Roboto', fontSize: '10px', color: '#CFE0F2', letterSpacing: '1px', fontWeight: 'bold' } },
    ]));
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
  }, cardVCO({ bg: TINT, border: false, shadow: false }));
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

// per-visual LIGHT styling for tableEx / pivotTable — PMI Value Report 2025 p16
// table template: a bold near-black header on a light-blue #EAF3FB tint with a
// thin bottom rule, navy-ink values on white with a subtle #F4F6FA alternate
// band, and hairline #E6EBF2 gridlines. For pivotTables the left category
// (row-header) column is a solid brand-blue cell with bold white text, exactly
// like the p16 "Category" column. On a light theme the ExportTo-PDF renderer's
// opaque light cell fill is a non-issue — clean in both service and PDF export.
function tableLightObjects({ pivot = false } = {}) {
  const hdr = { fontColor: solid(INK), backColor: solid(TINT), fontFamily: L("'Lato, sans-serif'"), bold: L('true') };
  const vals = {
    fontColor: solid(INK), backColor: solid(CARD),
    backColorSecondary: solid(ALT), fontColorSecondary: solid(INK),
    fontFamily: L("'Roboto'"),
  };
  const grid = {
    gridVertical: L('true'), gridVerticalColor: solid(HAIR),
    gridHorizontal: L('true'), gridHorizontalColor: solid(HAIR),
    outlineColor: solid(HAIR), outline: L("'BottomOnly'"), rowPadding: L('7D'),
  };
  const o = {
    stylePreset: [{ properties: { name: L("'None'") } }],
    columnHeaders: [{ properties: hdr }],
    values: [{ properties: vals }],
    grid: [{ properties: grid }],
    total: [{ properties: { fontColor: solid(NAVY), backColor: solid(TINT), bold: L('true') } }],
  };
  if (pivot) {
    // p16 left category column = solid brand-blue cell with bold white text
    o.rowHeaders = [{ properties: { fontColor: solid('#FFFFFF'), backColor: solid(BRAND), fontFamily: L("'Lato, sans-serif'"), bold: L('true') } }];
    o.subTotals = [{ properties: { fontColor: solid(NAVY), backColor: solid(TINT) } }];
    o.grandTotal = [{ properties: { fontColor: solid(NAVY), backColor: solid(TINT), bold: L('true') } }];
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


const titleRun = (t) => [{ value: t, textStyle: { fontFamily: 'Lato', fontSize: '26px', color: INK, fontWeight: 'bold' } }];
const wordmarkRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '11px', color: MUTED, letterSpacing: '2px' } }];
const sectionRun = (t) => [{ value: t, textStyle: { fontFamily: 'Lato', fontSize: '14px', color: NAVY, fontWeight: 'bold' } }];
const noteRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '12px', color: MUTED } }];
const accentRun = (t) => [{ value: t, textStyle: { fontFamily: 'Roboto', fontSize: '12px', color: BRAND } }];

// PMI Value Report 2025 header (p2/p6): a slim WHITE rounded nav PILL across the
// top holding the four page tabs (the active one underlined in brand blue) and a
// right-aligned "Philip Morris International · State Regulatory Monitor" wordmark
// + page indicator; below it a big near-black Lato page title. The underline sits
// on the small active TAB (which is exactly what PMI does) — never under the page
// title itself. Total height stays within 0..88 so page bodies are unchanged.
const NAV_TABS = ['Command Center', 'Tax & Margin', 'Compliance', 'Timeline', 'Demand', 'Forecast'];
const NAV_TABX = [44, 194, 312, 424, 508, 586];
const NAV_TABW = [108, 84, 90, 62, 60, 66];
function header(title, active = 0) {
  const out = [
    // nav pill surface
    textbox({ x: 24, y: 12, width: 1232, height: 30 }, [], { fill: BAND, radius: 16, border: BORDER }),
  ];
  NAV_TABS.forEach((t, i) => {
    const on = i === active;
    out.push(textbox({ x: NAV_TABX[i], y: 19, width: NAV_TABW[i] + 8, height: 16 }, [
      { value: t, textStyle: { fontFamily: 'Lato, sans-serif', fontSize: '12px', color: on ? INK : MUTED, fontWeight: on ? 'bold' : 'normal' } },
    ]));
    if (on) out.push(textbox({ x: NAV_TABX[i], y: 36, width: NAV_TABW[i], height: 2 }, [], { fill: BRAND }));
  });
  out.push(textbox({ x: 700, y: 19, width: 496, height: 16 }, [
    { value: 'Philip Morris International', textStyle: { fontFamily: 'Lato, sans-serif', fontSize: '12px', color: INK, fontWeight: 'bold' } },
    { value: '   ·   State Regulatory Monitor', textStyle: { fontFamily: 'Roboto', fontSize: '12px', color: MUTED } },
  ], { align: 'right' }));
  out.push(textbox({ x: 1208, y: 19, width: 48, height: 16 }, [
    { value: `0${active + 1} / 06`, textStyle: { fontFamily: 'Lato, sans-serif', fontSize: '11px', color: BRAND, fontWeight: 'bold' } },
  ], { align: 'right' }));
  // page title (big, near-black navy) — whitespace under it, no accent rule
  out.push(textbox({ x: 24, y: 48, width: 1000, height: 40 }, titleRun(title)));
  return out;
}

// ---- extra helpers for the sales/forecast/simulation pages (Phase 3) ----
function sortByColumnDesc(e, p) {
  return { sort: [{ field: col(e, p), direction: 'Descending' }], isDefaultSort: false };
}
// per-series colours for a MULTI-MEASURE chart: the dataPoint selector is keyed
// by the measure's queryRef metadata (not a category literal), so each measure
// series gets its colour in BOTH the service and the ExportTo render.
function dpByMeasure(list) {
  return list.map(({ e, p, color }) => ({
    properties: { fill: solid(color) },
    selector: { metadata: `${e}.${p}` },
  }));
}
// cartesian chart with SEVERAL measures on Y (e.g. actual+forecast+band, or
// baseline vs simulated). measures: [{ e, p, color }]. type as in cartesian().
function cartesianMulti(type, pos, catE, catP, measures, sort, opts = {}) {
  const qs = {
    Category: { projections: [projCol(catE, catP)] },
    Y: { projections: measures.map((m) => projMeas(m.e, m.p)) },
  };
  const v = { visualType: type, query: { queryState: qs } };
  if (sort === 'catAsc') v.query.sortDefinition = sortByColumnAsc(catE, catP);
  const objs = { dataPoint: dpByMeasure(measures) };
  if (type === 'lineChart' || type === 'areaChart') {
    objs.lineStyles = [{ properties: { strokeWidth: L(`${opts.lineWidth || 3}D`), showMarker: L(opts.marker === false ? 'false' : 'true') } }];
  }
  v.objects = objs;
  return baseVisual(vid(), pos, v, cardVCO());
}
// categorical "= true/false" boolean filter on a column
function boolFilter(e, p, val) {
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
            Comparison: {
              ComparisonKind: 0,
              Left: { Column: { Expression: { SourceRef: { Source: 'p' } }, Property: p } },
              Right: { Literal: { Value: val ? 'true' : 'false' } },
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

// single-select numeric slicer for a what-if parameter (SELECTEDVALUE-friendly).
// Radio-style single selection, but rests UNSELECTED so the model uses the
// parameter default (Δprice 0 / elasticity -0.8) → simulated == baseline until
// the presenter dials a value.
function paramSlicer(pos, e, p, header) {
  const vco = {
    ...cardVCO(),
    padding: [{ properties: { top: L('8D'), bottom: L('8D'), left: L('8D'), right: L('8D') } }],
  };
  return baseVisual(vid(), pos, {
    visualType: 'slicer',
    query: { queryState: { Values: { projections: [projCol(e, p)] } } },
    objects: {
      data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }],
      selection: [{ properties: { singleSelect: L('true') } }],
      header: [{ properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        text: { expr: { Literal: { Value: `'${header}'` } } },
        fontColor: solid(NAVY),
      } }],
      items: [{ properties: { fontColor: solid(INK) } }],
    },
  }, vco);
}

// ================= PAGES =================
const pages = [];

// ---------- Page 1: Command Center ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Command Center — State Pricing Signals', 0));

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
  visuals.push(textbox({ x: 24, y: 362, width: 280, height: 342 }, [], { fill: TINT }));
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
  visuals.push(...header('Tax & Margin — Excise Burden by State', 1));
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
  visuals.push(...header('Compliance & Assortment — Where SKUs Are Gated', 2));
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
  visuals.push(...header('Regulatory Timeline — CDC Activity Over Time', 3));

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

// ---------- Page 5: Demand & Revenue (synthetic POS) ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Demand & Revenue — Synthetic POS Performance', 4));

  // KPI hero row
  visuals.push(...card({ x: 24, y: 96, width: 1232, height: 100 }, [
    ['SalesMonthly', 'Total Units', 'Total Units'],
    ['SalesMonthly', 'Total Revenue', 'Total Revenue'],
    ['SalesMonthly', 'Avg Price', 'Avg Price'],
    ['SalesMonthly', 'Revenue at Risk', 'Revenue at Risk'],
  ]));

  // left column — product slicer, units-by-product, synthetic-data note
  visuals.push(textbox({ x: 24, y: 212, width: 280, height: 18 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 234, width: 280, height: 60 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 308, width: 280, height: 18 }, sectionRun('Units by product')));
  visuals.push(cartesian('columnChart', { x: 24, y: 330, width: 280, height: 150 }, 'SalesMonthly', 'Program', 'SalesMonthly', 'Total Units', 'measureDesc', null,
    { byCategory: { e: 'SalesMonthly', p: 'Program', map: PROGRAM_COLOR_MAP } }));
  visuals.push(textbox({ x: 24, y: 492, width: 280, height: 200 }, noteRun(
    'SYNTHETIC DATA — no real PMI POS. Daily transaction-style sales are generated deterministically (fixed seed), then rolled up to a monthly shop×SKU grain. Volume tracks city population, seasonality and a mild uptrend; unit price scales with state excise tax and channel. Only ZYN + VEEV are modeled.')));

  // centre — revenue by product & channel + top shops (with city/state)
  visuals.push(textbox({ x: 320, y: 212, width: 560, height: 18 }, sectionRun('Revenue by product & channel')));
  visuals.push(cartesian('clusteredColumnChart', { x: 320, y: 234, width: 560, height: 208 }, 'SalesMonthly', 'Program', 'SalesMonthly', 'Total Revenue', 'measureDesc', ['SalesMonthly', 'Channel']));
  visuals.push(textbox({ x: 320, y: 458, width: 560, height: 18 }, sectionRun('Top shops & cities by revenue')));
  const shopTable = table({ x: 320, y: 480, width: 560, height: 214 }, [
    ['SalesMonthly', 'Shop Name', 'c'],
    ['SalesMonthly', 'City', 'c'],
    ['SalesMonthly', 'State', 'c'],
    ['SalesMonthly', 'Channel', 'c'],
    ['SalesMonthly', 'Total Revenue', 'm'],
    ['SalesMonthly', 'Total Units', 'm'],
  ]);
  shopTable.visual.query.sortDefinition = sortByMeasureDesc('SalesMonthly', 'Total Revenue');
  visuals.push(shopTable);

  // right — price by state/channel matrix + recent transactions (POS)
  visuals.push(textbox({ x: 896, y: 212, width: 360, height: 18 }, sectionRun('Avg price by state & channel')));
  visuals.push(matrix({ x: 896, y: 234, width: 360, height: 208 },
    [['SalesMonthly', 'State']], [['SalesMonthly', 'Channel']], [['SalesMonthly', 'Avg Price', 'm']]));
  visuals.push(textbox({ x: 896, y: 458, width: 360, height: 18 }, sectionRun('Recent transactions (POS)')));
  const txTable = table({ x: 896, y: 480, width: 360, height: 214 }, [
    ['SalesDaily', 'Date', 'c'],
    ['SalesDaily', 'Shop Name', 'c'],
    ['SalesDaily', 'Sku Code', 'c'],
    ['SalesDaily', 'Unit Price', 'c'],
  ]);
  txTable.visual.query.sortDefinition = sortByColumnDesc('SalesDaily', 'Date');
  visuals.push(txTable);

  pages.push({ name, displayName: 'Demand & Revenue', visuals });
}

// ---------- Page 6: Forecast & Simulation (what-if) ----------
{
  const name = pid();
  const visuals = [];
  visuals.push(...header('Forecast & Simulation — Demand Outlook & Price What-If', 5));

  // KPI hero row — the narrative numbers (respond to the what-if sliders)
  visuals.push(...card({ x: 24, y: 96, width: 1232, height: 100 }, [
    ['SalesMonthly', 'Baseline Revenue (Sellable)', 'Baseline Revenue'],
    ['SalesMonthly', 'Sim Revenue', 'Simulated Revenue'],
    ['SalesMonthly', 'Sim Revenue Delta', 'Revenue Delta'],
    ['SalesMonthly', 'Revenue at Risk', 'Revenue at Risk'],
  ]));

  // left column — product slicer + the two what-if parameter sliders + note
  visuals.push(textbox({ x: 24, y: 212, width: 280, height: 18 }, sectionRun('Product line')));
  visuals.push(slicer({ x: 24, y: 234, width: 280, height: 56 }, 'Program', 'Name', 'Product line'));
  visuals.push(textbox({ x: 24, y: 302, width: 280, height: 18 }, sectionRun('Price change %')));
  visuals.push(paramSlicer({ x: 24, y: 324, width: 280, height: 56 }, 'Price Change %', 'Price Change %', 'Price change %'));
  visuals.push(textbox({ x: 24, y: 392, width: 280, height: 18 }, sectionRun('Elasticity')));
  visuals.push(paramSlicer({ x: 24, y: 414, width: 280, height: 56 }, 'Elasticity', 'Elasticity', 'Elasticity'));
  visuals.push(textbox({ x: 24, y: 484, width: 280, height: 210 }, noteRun(
    'WHAT-IF: Sim Revenue = Σ baseline_units × (1 + elasticity×Δprice) × baseline_price × (1+Δprice), forced to 0 where a SKU is banned. Category defaults: ZYN ≈ -0.7, VEEV ≈ -0.9 (model default -0.8). Revenue at Risk is the forgone baseline revenue in ban states. Raise price in high-tax states → gain, minus the ban forgone.')));

  // centre — national demand forecast + 80% band, and the ban-cliff timeline
  visuals.push(textbox({ x: 320, y: 212, width: 560, height: 18 }, sectionRun('Demand forecast + 80% band (national, by product)')));
  const fcLine = cartesianMulti('lineChart', { x: 320, y: 234, width: 560, height: 230 }, 'Forecast', 'Month Start', [
    { e: 'Forecast', p: 'Actual Units', color: BRAND },
    { e: 'Forecast', p: 'Forecast Units', color: AMBER },
    { e: 'Forecast', p: 'Forecast Lower', color: SKY3 },
    { e: 'Forecast', p: 'Forecast Upper', color: SKY3 },
  ], 'catAsc', { lineWidth: 2, marker: false });
  fcLine.filterConfig = { filters: [inFilter('Forecast', 'State', ['ALL'])] };
  visuals.push(fcLine);
  visuals.push(textbox({ x: 320, y: 480, width: 560, height: 18 }, sectionRun('Ban cliff over time — units in ban states')));
  const cliff = cartesian('lineChart', { x: 320, y: 502, width: 560, height: 192 }, 'SalesMonthly', 'Month Start', 'SalesMonthly', 'Total Units', 'catAsc', ['SalesMonthly', 'Program'],
    { byCategory: { e: 'SalesMonthly', p: 'Program', map: PROGRAM_COLOR_MAP }, lineWidth: 3 });
  cliff.filterConfig = { filters: [boolFilter('SalesMonthly', 'Is Banned', true)] };
  visuals.push(cliff);

  // right — baseline vs simulated revenue + revenue-at-risk by program
  visuals.push(textbox({ x: 896, y: 212, width: 360, height: 18 }, sectionRun('Baseline vs simulated revenue')));
  const bvs = cartesianMulti('clusteredColumnChart', { x: 896, y: 234, width: 360, height: 230 }, 'SalesMonthly', 'Program', [
    { e: 'SalesMonthly', p: 'Baseline Revenue (Sellable)', color: NAVY },
    { e: 'SalesMonthly', p: 'Sim Revenue', color: BRAND },
  ], null);
  visuals.push(bvs);
  visuals.push(textbox({ x: 896, y: 480, width: 360, height: 18 }, sectionRun('Revenue at risk by product')));
  visuals.push(cartesian('columnChart', { x: 896, y: 502, width: 360, height: 192 }, 'SalesMonthly', 'Program', 'SalesMonthly', 'Revenue at Risk', 'measureDesc', null,
    { fill: ACTION_COLOR_MAP.delist_banned }));

  pages.push({ name, displayName: 'Forecast & Simulation', visuals });
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
