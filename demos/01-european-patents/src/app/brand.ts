/**
 * ─────────────────────────────────────────────────────────────────────
 * Microsoft / Fluent brand system — single source of truth.
 *
 * Every chart, series and categorical color in the app pulls from here so
 * the dashboards (KPIs, IPC-section chart, the over-time bar-race) stay
 * visually consistent with the Microsoft corporate identity. Surface /
 * text / chrome colors live as CSS custom properties in `styles.scss`;
 * this file owns the JS-side categorical palette + a couple of helpers to
 * keep Chart.js theme-aware.
 * ─────────────────────────────────────────────────────────────────────
 */

/** Core Fluent brand tokens. Mirrors the CSS custom properties. */
export const BRAND = {
  /** Primary Microsoft/Fluent blue — primary actions, active nav, links. */
  blue: '#0078D4',
  blueHover: '#106EBE',
  bluePressed: '#005A9E',

  /** Microsoft logo accent colors (categorical series order). */
  red: '#F25022',
  green: '#7FBA00',
  logoBlue: '#00A4EF',
  yellow: '#FFB900',

  /** Fluent neutral ramp. */
  bg: '#FAF9F8',
  surface: '#FFFFFF',
  border: '#EDEBE9',
  textSecondary: '#605E5C',
  textPrimary: '#201F1E',

  /** Semantic. */
  success: '#107C10',
  warning: '#FFB900',
  error: '#D13438',
} as const;

/**
 * Categorical series palette. Starts with the four Microsoft logo accents
 * (Red → Green → Blue → Yellow) as requested, then extends with additional
 * on-brand Fluent hues for charts that need more than four categories
 * (e.g. the 8 IPC sections A–H or the top-12 bar-race). All chosen to keep
 * reasonable contrast against both the light and dark surfaces.
 */
export const SERIES: readonly string[] = [
  BRAND.red, // #F25022
  BRAND.green, // #7FBA00
  BRAND.logoBlue, // #00A4EF
  BRAND.yellow, // #FFB900
  BRAND.blue, // #0078D4
  BRAND.textSecondary, // #605E5C — matches the Power BI theme dataColors[5]
  // Extensions beyond the shared 6 (for the 8 IPC sections / top-12 race).
  '#8661C5', // Fluent purple
  '#00B7C3', // Fluent teal
  '#E3008C', // Fluent magenta
  '#498205', // Fluent dark green
  '#005A9E', // Fluent dark blue
  '#CA5010', // Fluent burnt orange
];

/** Alias kept for readability where a generic categorical palette is used. */
export const PALETTE = SERIES;

/** Neutral gray for "other"/unknown categories. */
const NEUTRAL = '#8A8886';

const SECTION_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

/**
 * IPC section → brand color. Sections A–H map onto the first eight entries
 * of the shared SERIES palette so the section chart and the over-time
 * animation use identical colors for the same section.
 */
export function sectionColor(section: string | undefined): string {
  if (!section) return NEUTRAL;
  const letter = section.charAt(0).toUpperCase();
  const idx = SECTION_ORDER.indexOf(letter as (typeof SECTION_ORDER)[number]);
  return idx >= 0 ? SERIES[idx] : NEUTRAL;
}

/**
 * Read a CSS custom property from the document root so Chart.js chrome
 * (tooltip, grid, ticks) follows the active Fluent light/dark theme. Falls
 * back to the supplied default during SSR / before first paint.
 */
export function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Theme-aware colors for Chart.js chrome (tooltip / grid / ticks / labels). */
export function chartInk(): {
  surface: string;
  border: string;
  title: string;
  body: string;
  grid: string;
  mono: string;
} {
  return {
    surface: cssVar('--ink-elevated', '#ffffff'),
    border: cssVar('--ink-border', BRAND.border),
    title: cssVar('--cream', BRAND.textPrimary),
    body: cssVar('--cream-muted', BRAND.textSecondary),
    grid: cssVar('--ink-border-soft', 'rgba(0,0,0,0.06)'),
    mono: cssVar('--font-mono', "'Segoe UI', system-ui, sans-serif"),
  };
}
