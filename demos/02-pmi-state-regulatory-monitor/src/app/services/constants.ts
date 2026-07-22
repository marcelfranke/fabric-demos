// Well-known UUIDs, CDC dataset descriptors, and domain lookups for the
// PMI State Regulatory Monitor app.

import type { Program, RegulatoryItem } from '../../../rayfin/data/schema';

export type ProductCode = Program['product_code'];
export type RegulatoryCategory = RegulatoryItem['category'];

// The single AppConfig row's primary key. There is only ever one config row;
// we look it up by this fixed id so the lookup is deterministic.
export const APP_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

// Namespace UUID for deterministic v5 ids of CDC-synced RegulatoryItem rows.
// id = uuidv5(`${datasetId}#${state}#${provisionid}#${year}Q${quarter}`, CDC_NAMESPACE_UUID)
// so re-runs are idempotent and concurrent syncs converge on the same id.
export const CDC_NAMESPACE_UUID = 'b8f1c2d3-4a5e-6f70-8192-a3b4c5d6e7f8';

// Namespace UUID for deterministic v5 ids of curated seed rows (seeded mode).
export const SEED_NAMESPACE_UUID = 'd1e2f3a4-b5c6-4d7e-8f90-1a2b3c4d5e6f';

// Namespace UUID for deterministic v5 ids of Gold PricingSignal rows.
// id = uuidv5(`${state}#${product_code}`, PRICING_NAMESPACE_UUID) so recompute
// is idempotent (one row per state+program, overwritten in place).
export const PRICING_NAMESPACE_UUID = 'a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d';

// Program id = uuidv5(product_code, PROGRAM_NAMESPACE_UUID). One row per
// product line; the id is deterministic so seeded + synced rows agree.
export const PROGRAM_NAMESPACE_UUID = '7c3d9e1a-2b4c-4d6e-8f01-23456789abcd';

// Sync freshness window: dashboard auto-runs the CDC sync if the last
// successful sync is older than this.
export const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

// ── CDC STATE System (Socrata SODA) datasets ──────────────────────────────
// Public, no API key. Endpoint: https://data.cdc.gov/resource/{id}.json
// Four share a "standard" row shape (provisionvalue / citation / dates /
// geolocation:{latitude,longitude}); the smokefree-air summary uses a
// different "summary" shape (summary columns; geolocation GeoJSON Point).
export interface CdcDataset {
  id: string;
  category: RegulatoryCategory;
  shape: 'standard' | 'summary';
  label: string;
}

export const CDC_DATASETS: readonly CdcDataset[] = [
  { id: 'kwbr-syv2', category: 'tax', shape: 'standard', label: 'E-Cigarette Excise Tax' },
  { id: '8zea-kwnt', category: 'youth_access', shape: 'standard', label: 'E-Cigarette Youth Access' },
  { id: 'ne52-uraz', category: 'licensure', shape: 'standard', label: 'E-Cigarette Licensure' },
  { id: 'piju-vf3p', category: 'preemption', shape: 'standard', label: 'E-Cigarette Preemption' },
  // Smokefree indoor air — context only, NOT a pricing driver. Swapped from the
  // summary dataset `i8t6-whzd` (empty provision fields) to the non-summary
  // `wan8-w4er` (standard shape with populated provisionvalue/citation/dates).
  { id: 'wan8-w4er', category: 'smokefree_air', shape: 'standard', label: 'E-Cigarette Smokefree Indoor Air' },
] as const;

// Cap per dataset so the browser-side pull stays demo-fast and polite to the
// anonymous Socrata endpoint. We take the most recent year/quarter per
// (state, provision) client-side after the pull.
export const CDC_ROW_LIMIT = 1000;

// Descriptive User-Agent identifying the project (per source-etiquette rules).
export const CDC_USER_AGENT =
  'fabric-demos/pmi-state-regulatory-monitor (+https://github.com/marcelfranke/fabric-demos)';

// Category → default Program product code. Kept as a single lookup so the
// program mapping is trivial to change. All CDC regulatory legislation defaults
// to IQOS; the curated seed layer additionally assigns flavor bans to ZYN.
export const CATEGORY_PROGRAM: Record<RegulatoryCategory, ProductCode> = {
  tax: 'IQOS',
  youth_access: 'IQOS',
  licensure: 'IQOS',
  smokefree_air: 'IQOS',
  preemption: 'IQOS',
  flavor_ban: 'IQOS',
  pmta_registry: 'IQOS',
};

// The seeded programs (product lines).
export interface ProgramSeed {
  product_code: ProductCode;
  name: string;
  description: string;
}

export const PROGRAM_SEEDS: readonly ProgramSeed[] = [
  { product_code: 'IQOS', name: 'IQOS', description: 'Heated tobacco system (heat-not-burn).' },
  { product_code: 'ZYN', name: 'ZYN', description: 'Oral nicotine pouches.' },
] as const;

// Human-readable labels for the RegulatoryItem category set.
export const CATEGORY_LABELS: Record<RegulatoryCategory, string> = {
  tax: 'Excise tax',
  youth_access: 'Youth access',
  licensure: 'Licensure',
  smokefree_air: 'Smokefree air',
  preemption: 'Preemption',
  flavor_ban: 'Flavor ban',
  pmta_registry: 'PMTA registry',
};

// ── Pricing Signal (Gold) ─────────────────────────────────────────────────
// The dynamic-pricing story: before the pricing engine sets a shelf price it
// screens each state's tax + product rules and emits a per-state, per-program
// `pricing_action`. See pricing.service.ts for the derivation.

export type PricingAction =
  | 'price_freely'
  | 'adjust_for_tax'
  | 'delist_banned'
  | 'restricted_assortment'
  | 'watch_pending';

export interface PricingActionMeta {
  /** Short label for pills / legends. */
  label: string;
  /** Choropleth fill colour. */
  color: string;
  /** Pill class suffix (maps to the shared .pill--* styles). */
  pill: string;
  /** Legend + sort order (ascending = least → most restrictive). */
  order: number;
}

// Map colours align to the PMI "Value Report 2025" pricing-action palette so the
// choropleth, legend, and chips match the Power BI report exactly:
// green = price_freely, amber = adjust_for_tax, purple = watch_pending,
// blue = restricted_assortment, red = delist_banned.
export const PRICING_ACTIONS: Record<PricingAction, PricingActionMeta> = {
  price_freely: { label: 'Price freely', color: '#2E9E6B', pill: 'emerald', order: 0 },
  adjust_for_tax: { label: 'Adjust for tax', color: '#E8A23D', pill: 'amber', order: 1 },
  watch_pending: { label: 'Watch pending', color: '#7A5CD0', pill: 'blue', order: 2 },
  restricted_assortment: { label: 'Restricted assortment', color: '#3D7DD8', pill: 'orange', order: 3 },
  delist_banned: { label: 'Delist banned', color: '#E0523E', pill: 'rose', order: 4 },
};

export const PRICING_ACTION_ORDER: readonly PricingAction[] = (
  Object.keys(PRICING_ACTIONS) as PricingAction[]
).sort((a, b) => PRICING_ACTIONS[a].order - PRICING_ACTIONS[b].order);

// A tax_burden above this (%) trips the `adjust_for_tax` action.
export const HIGH_TAX_THRESHOLD = 20;

// Per-unit → % conversion (documented demo assumption). CDC e-cigarette excise
// values come either as a percentage of wholesale/retail (used directly) or as
// a per-unit dollar amount ($/mL). To express a $/mL value as an approximate %
// burden we assume a reference package of ASSUMED_ML_PER_PACK mL selling at
// ASSUMED_RETAIL_PRICE_USD: pct ≈ (perMl * mlPerPack) / retail * 100.
// These are illustrative demo constants, NOT PMI pricing data.
export const ASSUMED_ML_PER_PACK = 5;
export const ASSUMED_RETAIL_PRICE_USD = 20;

// The pricing hero programs (hit by tax + flavor bans + registry laws). IQOS is
// the primary product line; ZYN is screened for flavor bans.
export const PRICING_HERO_PROGRAMS: readonly ProductCode[] = ['ZYN', 'IQOS'];
export const DEFAULT_PRICING_PROGRAM: ProductCode = 'IQOS';

// ── Revenue-at-risk (synthetic) ───────────────────────────────────────────
// The app has no real revenue basis, so the Revenue-at-risk what-if uses a
// LIGHTWEIGHT deterministic synthetic baseline (revenue.service.ts) allocated
// across the 60 (state × program) Pricing Signals. It is normalized so the
// portfolio total equals the Power BI "Value Report 2025" baseline and the
// non-`price_freely` (at-risk) slice matches the report's revenue-at-risk, so
// the app and report tell the same story. Deterministic + offline; clearly
// labeled synthetic. NOT PMI financials.
export const TOTAL_BASELINE_USD = 18_650_000;
export const REVENUE_AT_RISK_USD = 3_660_000;

// Default what-if inputs (sliders start here). A negative price change models a
// forced markdown; elasticity is the demand response to a 1% price move.
export const DEFAULT_PRICE_CHANGE_PCT = -10;
export const DEFAULT_ELASTICITY = 0.8;

// Fixed "as-of" snapshot the Alerts feed + Timeline classify against, so the
// upcoming-vs-recently-effective split is DETERMINISTIC (never drifts with the
// wall clock). Matches the curated seed's reporting snapshot. ISO yyyy-mm-dd.
export const REPORT_AS_OF_DATE = '2025-09-01';

// ── Curated / seeded layer ────────────────────────────────────────────────
// Well-documented, high-relevance items with no clean public API. Point-in-time
// snapshot (see README "Caveats"). Deterministic ids keep re-seeds idempotent:
// id = uuidv5(`${category}#${state}#${productCode}#${slug}`, SEED_NAMESPACE_UUID).

// USPS 2-letter → full state name (50 states + DC). Used for seeds and to label
// CDC rows; DC has no map geometry but still appears in lists/KPIs.
export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** The 50 states + DC — the set the CDC sync keeps (drops territories/national). */
export const US_STATE_CODES: readonly string[] = Object.keys(US_STATE_NAMES);

export interface SeedItem {
  slug: string;
  state: string;
  category: RegulatoryCategory;
  status: 'enacted' | 'pending' | 'no_provision';
  title: string;
  provision_value?: string;
  source_url: string;
  /** ISO effective date (curated). Only the tax sample carries one today. */
  effective_date?: string;
  /** Product lines this row is attached to (one RegulatoryItem row per program). */
  programs: ProductCode[];
}

// Statewide flavor bans — nicotine pouches (ZYN) are often included, so these
// attach to both ZYN and IQOS. Enacted statewide restrictions as of the
// snapshot date in the README. Nine jurisdictions with a statewide flavored
// tobacco restriction — reconciles to ZYN 9 delist signals.
const FLAVOR_BAN_STATES: readonly { state: string; note: string; url: string }[] = [
  { state: 'CA', note: 'Prop 31 flavored tobacco ban (upheld 2022)', url: 'https://oag.ca.gov/tobacco/flavored' },
  { state: 'DC', note: 'flavored tobacco product ban (2022)', url: 'https://dchealth.dc.gov/service/tobacco-control' },
  { state: 'MA', note: 'first statewide flavored tobacco ban (2020)', url: 'https://www.mass.gov/info-details/flavored-tobacco-and-vaping-products' },
  { state: 'MD', note: 'flavored ENDS restriction', url: 'https://health.maryland.gov/' },
  { state: 'ME', note: 'flavored tobacco restriction', url: 'https://www.maine.gov/dhhs/mecdc/' },
  { state: 'NJ', note: 'flavored e-cigarette ban (2020)', url: 'https://www.nj.gov/health/tobacco/' },
  { state: 'NY', note: 'flavored vapor products ban (2020)', url: 'https://www.health.ny.gov/prevention/tobacco_control/' },
  { state: 'RI', note: 'flavored vapor products ban (2020)', url: 'https://health.ri.gov/programs/detail.php?pgm_id=87' },
  { state: 'UT', note: 'flavored e-cigarette restriction', url: 'https://tobaccofreeutah.org/' },
];

// PMTA "registry" / directory laws: a product may only be sold if it holds an
// FDA marketing order or has a timely-filed PMTA. IA and UT are court-challenged
// → pending. Attach to IQOS.
const PMTA_REGISTRY_ENACTED = ['AL', 'FL', 'KY', 'LA', 'NC', 'OK', 'VA', 'WI', 'MS'] as const;
const PMTA_REGISTRY_PENDING = ['IA', 'UT'] as const;
const PMTA_REGISTRY_URL =
  'https://www.fda.gov/tobacco-products/products-guidance-regulations/tobacco-product-marketing-orders';

// Curated illustrative excise-tax sample (seeded mode only). CDC has the live
// tax dataset; in seeded mode we supply a representative set so the Pricing
// Signal has a tax dimension for every taxed jurisdiction. Mixes percentage and
// per-unit ($/mL) values to exercise both parse paths. Thirty-four taxed states
// (all 19 gated states + 15 ungated) — reconciles to 34 taxed signals and an
// average excise burden of 24.2%. Seven ungated states above the 20% threshold
// (CO, MN, VT, PA, NV, NM, IL) drive the seven `adjust_for_tax` signals.
// Each row also carries a curated ISO `effective` date spread across 2024-2026
// (several future-dated) — these are the ONLY dated rows, so they reconcile to
// exactly 34 dated signals / 26 undated. Dates never feed the action logic, so
// action + KPI counts are unchanged. Illustrative demo values — NOT PMI data.
const CURATED_TAX_SAMPLE: readonly { state: string; value: string; effective: string }[] = [
  // Ungated, high burden (> 20%) → adjust_for_tax (7)
  { state: 'CO', value: '62%', effective: '2024-01-01' },
  { state: 'MN', value: '95%', effective: '2024-01-01' },
  { state: 'VT', value: '92%', effective: '2025-07-01' },
  { state: 'PA', value: '40%', effective: '2024-10-01' },
  { state: 'NV', value: '30%', effective: '2026-01-01' },
  { state: 'NM', value: '25%', effective: '2025-01-01' },
  { state: 'IL', value: '45%', effective: '2025-09-15' },
  // Ungated, low burden (≤ 20%) → price_freely (8)
  { state: 'WA', value: '$0.27/ml', effective: '2024-04-01' },
  { state: 'CT', value: '$0.40/ml', effective: '2024-10-01' },
  { state: 'DE', value: '$0.05/ml', effective: '2025-03-15' },
  { state: 'KS', value: '$0.05/ml', effective: '2025-07-01' },
  { state: 'GA', value: '$0.05/ml', effective: '2026-03-01' },
  { state: 'OH', value: '$0.10/ml', effective: '2024-10-01' },
  { state: 'IN', value: '15%', effective: '2025-07-01' },
  { state: 'WV', value: '11.5%', effective: '2025-01-01' },
  // Flavor-ban states — carry a tax figure too (action set by the ban) (9)
  { state: 'CA', value: '63%', effective: '2024-01-01' },
  { state: 'DC', value: '71%', effective: '2024-10-01' },
  { state: 'MA', value: '75%', effective: '2024-06-01' },
  { state: 'MD', value: '18%', effective: '2025-03-31' },
  { state: 'ME', value: '43%', effective: '2025-01-01' },
  { state: 'NJ', value: '10%', effective: '2024-04-20' },
  { state: 'NY', value: '20%', effective: '2024-01-01' },
  { state: 'RI', value: '10%', effective: '2025-01-01' },
  { state: 'UT', value: '18%', effective: '2026-01-01' },
  // PMTA-registry states + IA — carry a tax figure too (10)
  { state: 'AL', value: '5%', effective: '2025-07-01' },
  { state: 'FL', value: '8%', effective: '2025-10-01' },
  { state: 'KY', value: '5%', effective: '2025-01-01' },
  { state: 'LA', value: '$0.15/ml', effective: '2024-07-01' },
  { state: 'NC', value: '6%', effective: '2025-07-01' },
  { state: 'OK', value: '7%', effective: '2024-11-01' },
  { state: 'VA', value: '6.6%', effective: '2025-07-01' },
  { state: 'WI', value: '5%', effective: '2025-09-01' },
  { state: 'MS', value: '5%', effective: '2026-05-01' },
  { state: 'IA', value: '5%', effective: '2026-01-01' },
];

// Remaining jurisdictions with no tax/ban/registry/pending rule → a neutral
// monitored baseline so every state resolves to a Pricing Signal (price_freely).
// These 17 states complete IQOS's coverage of all 51 jurisdictions (50 + DC).
const CURATED_BASELINE_STATES: readonly string[] = [
  'AK', 'AZ', 'AR', 'HI', 'ID', 'MI', 'MO', 'MT', 'NE', 'NH',
  'ND', 'OR', 'SC', 'SD', 'TN', 'TX', 'WY',
];

export const SEED_ITEMS: readonly SeedItem[] = [
  ...FLAVOR_BAN_STATES.flatMap<SeedItem>((s) => {
    const base = {
      slug: 'flavor-ban',
      state: s.state,
      category: 'flavor_ban' as const,
      status: 'enacted' as const,
      title: `Statewide flavor ban — ${s.note}`,
      provision_value: 'Flavored sales prohibited',
      source_url: s.url,
    };
    return [
      { ...base, programs: ['ZYN'] as ProductCode[] },
      { ...base, programs: ['IQOS'] as ProductCode[] },
    ];
  }),
  ...PMTA_REGISTRY_ENACTED.map<SeedItem>((state) => ({
    slug: 'pmta-registry',
    state,
    category: 'pmta_registry',
    status: 'enacted',
    title: 'PMTA registry / directory law — enacted',
    provision_value: 'FDA order or pending PMTA required',
    source_url: PMTA_REGISTRY_URL,
    programs: ['IQOS'],
  })),
  ...PMTA_REGISTRY_PENDING.map<SeedItem>((state) => ({
    slug: 'pmta-registry',
    state,
    category: 'pmta_registry',
    status: 'pending',
    title: 'PMTA registry / directory law — court-challenged (pending)',
    provision_value: 'FDA order or pending PMTA required',
    source_url: PMTA_REGISTRY_URL,
    programs: ['IQOS'],
  })),
];

// Curated illustrative excise-tax sample — used ONLY in seeded mode (in CDC mode
// the live tax dataset supplies this dimension). Mixes percentage and per-unit
// ($/mL) values to exercise both parse paths. Illustrative demo values, NOT PMI
// data. Kept separate from SEED_ITEMS so the shared curated-facts layer (bans +
// registry, seeded in BOTH modes) never double-counts tax against live CDC rows.
export const SEED_TAX_ITEMS: readonly SeedItem[] = CURATED_TAX_SAMPLE.map<SeedItem>(
  (t) => ({
    slug: 'excise-tax',
    state: t.state,
    category: 'tax',
    status: 'enacted',
    title: `Vapor excise tax — ${t.value}`,
    provision_value: t.value,
    effective_date: t.effective,
    source_url: 'https://www.cdc.gov/statesystem/factsheets/ecigarette/EcigTax.html',
    programs: ['IQOS'],
  })
);

// Neutral monitored baseline for states with no tax/ban/registry rule — used
// ONLY in seeded mode so every jurisdiction resolves to an IQOS Pricing Signal
// (price_freely). Completes IQOS's 51-jurisdiction coverage. Illustrative.
export const SEED_BASELINE_ITEMS: readonly SeedItem[] = CURATED_BASELINE_STATES.map<SeedItem>(
  (state) => ({
    slug: 'baseline-monitored',
    state,
    category: 'licensure',
    status: 'enacted',
    title: 'Monitored — no statewide pricing restriction',
    provision_value: 'Retail license only; no assortment or flavor restriction',
    source_url: 'https://www.cdc.gov/statesystem/factsheets/ecigarette/index.html',
    programs: ['IQOS'],
  })
);

// Federal FDA authorizations, rendered as Program-level milestone rows
// (state = 'US'). Category reuses 'pmta_registry' as the federal
// marketing-authorization bucket.
export interface FdaMilestone {
  slug: string;
  program: ProductCode;
  status: 'enacted' | 'pending';
  title: string;
  provision_value: string;
  enacted_date?: string; // ISO date
  source_url: string;
}

export const FDA_MILESTONES: readonly FdaMilestone[] = [
  {
    slug: 'iqos-mrtp-2020',
    program: 'IQOS',
    status: 'enacted',
    title: 'FDA MRTP exposure-modification order — IQOS 2.4',
    provision_value: 'Modified-risk (reduced exposure) order',
    enacted_date: '2020-07-07',
    source_url: 'https://www.fda.gov/news-events/press-announcements/fda-authorizes-marketing-iqos-tobacco-heating-system-reduced-exposure-information',
  },
  {
    slug: 'iqos-pmta-2022',
    program: 'IQOS',
    status: 'enacted',
    title: 'FDA marketing order — IQOS 3 heated tobacco system',
    provision_value: 'PMTA marketing authorization',
    enacted_date: '2022-01-01',
    source_url: 'https://www.fda.gov/tobacco-products/products-guidance-regulations/tobacco-product-marketing-orders',
  },
  {
    slug: 'zyn-pmta-2025',
    program: 'ZYN',
    status: 'enacted',
    title: 'FDA PMTA marketing order — ZYN nicotine pouches (10 flavors)',
    provision_value: 'PMTA marketing authorization',
    enacted_date: '2025-01-16',
    source_url: 'https://www.fda.gov/news-events/press-announcements/fda-authorizes-marketing-20-zyn-nicotine-pouch-products',
  },
  {
    slug: 'zyn-mrtp-2026',
    program: 'ZYN',
    status: 'pending',
    title: 'ZYN modified-risk (MRTP) application — 20 SKUs under review',
    provision_value: 'MRTP application pending',
    source_url: 'https://www.fda.gov/tobacco-products/advertising-and-promotion/modified-risk-tobacco-products',
  },
];
