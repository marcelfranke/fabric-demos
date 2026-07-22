import {
  entity,
  authenticated,
  uuid,
  text,
  date,
  set,
  one,
  many,
  boolean,
  decimal,
} from '@microsoft/rayfin-core';

// A PMI smoke-free product line being monitored (renamed from the reference
// demo's "Project"). Seeded programs: IQOS (heated tobacco) and ZYN (nicotine
// pouch).
@entity()
@authenticated('*')
export class Program {
  @uuid() id!: string;
  @text({ max: 200 }) name!: string;
  @text({ max: 1000, optional: true }) description?: string;
  // IQOS | ZYN — stable product code used for deterministic ids + lookups.
  @set('IQOS', 'ZYN') product_code!: 'IQOS' | 'ZYN';
  @date({ optional: true }) created_at?: Date;
  @many(() => RegulatoryItem) items?: RegulatoryItem[];
}

// One monitored state (or federal) regulatory provision (renamed from "Task").
// For CDC-synced rows the id is a deterministic UUID v5 of
// "<datasetId>#<state>#<provisionid>#<year>Q<quarter>" so re-syncs are
// idempotent and concurrent syncs converge on the same id.
@entity()
@authenticated('*')
export class RegulatoryItem {
  @uuid() id!: string;
  @text({ max: 500 }) title!: string;
  // 2-letter USPS code (e.g. 'CA'); 'US' for federal FDA milestone rows.
  @text({ max: 2 }) state!: string;
  @text({ max: 100 }) state_name!: string;
  @set(
    'tax',
    'youth_access',
    'licensure',
    'smokefree_air',
    'preemption',
    'flavor_ban',
    'pmta_registry'
  )
  category!:
    | 'tax'
    | 'youth_access'
    | 'licensure'
    | 'smokefree_air'
    | 'preemption'
    | 'flavor_ban'
    | 'pmta_registry';
  @set('enacted', 'pending', 'no_provision') status!:
    | 'enacted'
    | 'pending'
    | 'no_provision';
  // Human-readable provision value, e.g. '62%', 'License Suspension', 'Banned'.
  @text({ max: 300, optional: true }) provision_value?: string;
  @text({ max: 500, optional: true }) citation?: string;
  @date({ optional: true }) enacted_date?: Date;
  @date({ optional: true }) effective_date?: Date;
  @text({ max: 1000, optional: true }) source_url?: string;
  // Stored as strings (CDC returns them as strings); parsed for the map. Kept
  // as text to avoid MSSQL decimal precision/dialect gotchas.
  @text({ max: 32, optional: true }) latitude?: string;
  @text({ max: 32, optional: true }) longitude?: string;
  // Display-only JSON array of chip labels. Not server-side filterable —
  // promote to a Label/ItemLabel pair if you need queryable tagging.
  @text({ max: 2000, optional: true }) labels_json?: string;
  @date({ optional: true }) created_at?: Date;
  @date({ optional: true }) updated_at?: Date;
  @one(() => Program) program!: Program;
}

// Singleton config row — see APP_CONFIG_ID in src/app/services/constants.ts.
// sync_mode: 'seeded' = curated point-in-time snapshot; 'cdc' = live CDC sync.
@entity()
@authenticated('*')
export class AppConfig {
  @uuid() id!: string;
  @set('pending', 'seeded', 'cdc') sync_mode!: 'pending' | 'seeded' | 'cdc';
  @date({ optional: true }) last_synced_at?: Date;
}

// Gold serving entity — the per-state, per-program **Pricing Signal** the whole
// pricing UI reads. One row per (state, product_code). RegulatoryItem rows are
// the Silver "evidence"; PricingSignal is computed + persisted from them after
// every load (see pricing.service.ts) so recompute is idempotent.
// Deterministic id = uuidv5("<state>#<product_code>", PRICING_NAMESPACE_UUID).
@entity()
@authenticated('*')
export class PricingSignal {
  @uuid() id!: string;
  // 2-letter USPS state code.
  @text({ max: 2 }) state!: string;
  @text({ max: 100 }) state_name!: string;
  @set('IQOS', 'ZYN') product_code!: 'IQOS' | 'ZYN';
  // true when the SKU can be sold as-is; false when a flavor ban or a PMTA
  // registry law blocks/gates it (sellable = !(flavor_banned || registry_gated)).
  @boolean() sellable!: boolean;
  // Approximate excise tax burden as a percentage. Null when no CDC excise row
  // covers the state+program (e.g. ZYN pouches). Per-unit $ rows are converted
  // to an approximate % via a documented assumed retail price (see constants).
  @decimal({ optional: true, min: 0 }) tax_burden?: number;
  // The pricing engine's recommended action, derived by precedence.
  @set(
    'price_freely',
    'adjust_for_tax',
    'delist_banned',
    'restricted_assortment',
    'watch_pending'
  )
  pricing_action!:
    | 'price_freely'
    | 'adjust_for_tax'
    | 'delist_banned'
    | 'restricted_assortment'
    | 'watch_pending';
  // One-line headline recommendation shown on the state detail card.
  @text({ max: 500 }) recommendation!: string;
  // Supporting flags (for transparency on the detail card).
  @boolean() flavor_banned!: boolean;
  @boolean() registry_gated!: boolean;
  @boolean() has_pending!: boolean;
  // Effective date carried up from the driving tax RegulatoryItem (curated).
  // Null for the 26 signals with no dated rule — feeds the alerts + timeline.
  @date({ optional: true }) effective_date?: Date;
  @date({ optional: true }) updated_at?: Date;
  @one(() => Program) program!: Program;
}

export type DashboardSchema = {
  Program: Program;
  RegulatoryItem: RegulatoryItem;
  AppConfig: AppConfig;
  PricingSignal: PricingSignal;
};

export const schema = [Program, RegulatoryItem, AppConfig, PricingSignal];
