import { Injectable } from '@angular/core';
import { v5 as uuidv5 } from 'uuid';

import type { RegulatoryItem } from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import {
  ASSUMED_ML_PER_PACK,
  ASSUMED_RETAIL_PRICE_USD,
  HIGH_TAX_THRESHOLD,
  PRICING_HERO_PROGRAMS,
  PRICING_NAMESPACE_UUID,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from './constants';
import { programId } from './programs';

// A computed Pricing Signal (before it is persisted as a PricingSignal row).
export interface ComputedSignal {
  id: string;
  state: string;
  state_name: string;
  product_code: ProductCode;
  sellable: boolean;
  tax_burden?: number;
  pricing_action: PricingAction;
  recommendation: string;
  flavor_banned: boolean;
  registry_gated: boolean;
  has_pending: boolean;
  effective_date?: Date;
}

export interface PricingResult {
  signals: number;
}

/** Deterministic PricingSignal id for a (state, product) pair. */
export function signalId(state: string, product: ProductCode): string {
  return uuidv5(`${state}#${product}`, PRICING_NAMESPACE_UUID);
}

const PRODUCT_BY_PROGRAM_ID: Record<string, ProductCode> = {
  [programId('IQOS')]: 'IQOS',
  [programId('ZYN')]: 'ZYN',
};

/**
 * Parse a provision value into an approximate excise-tax burden (%).
 *
 * CDC E-Cigarette excise rows arrive either as a percentage of wholesale/retail
 * (e.g. "62%" — used directly) or as a per-unit dollar amount (e.g. "$0.40/ml").
 * A per-unit value is converted to an approximate percentage against a documented
 * reference package (ASSUMED_ML_PER_PACK mL at ASSUMED_RETAIL_PRICE_USD):
 *   pct ≈ (perMl * mlPerPack) / retail * 100
 * These are illustrative demo assumptions, NOT PMI pricing inputs.
 * Returns undefined when no numeric tax value can be parsed.
 */
export function parseTaxBurden(value?: string): number | undefined {
  if (!value) return undefined;
  const v = value.trim();

  // Percentage, e.g. "62%" or "61.74 %".
  const pct = /(-?\d+(?:\.\d+)?)\s*%/.exec(v);
  if (pct) return round1(Number(pct[1]));

  // Per-unit dollars, e.g. "$0.40/ml" or "$0.40 per ml".
  const perMl = /\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*m?l\b/i.exec(v);
  if (perMl) {
    const perUnit = Number(perMl[1]);
    return round1((perUnit * ASSUMED_ML_PER_PACK) / ASSUMED_RETAIL_PRICE_USD * 100);
  }

  // Bare number → treat as a percent (CDC tax rows are normalized to "N%").
  const bare = /^(\d+(?:\.\d+)?)$/.exec(v);
  if (bare) return round1(Number(bare[1]));

  return undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** One-line pricing recommendation headline per action. */
function recommend(
  action: PricingAction,
  ctx: { product: ProductCode; state_name: string; tax_burden?: number }
): string {
  const { product, state_name, tax_burden } = ctx;
  switch (action) {
    case 'delist_banned':
      return `Delist: ${product} flavored SKUs banned in ${state_name}`;
    case 'restricted_assortment':
      return `Restricted assortment: sell only FDA-listed SKUs (${state_name} registry law)`;
    case 'watch_pending':
      return `Watch: pending bill in ${state_name} — hold price`;
    case 'adjust_for_tax':
      return `Adjust for tax: ${tax_burden}% excise — raise price to protect margin`;
    case 'price_freely':
    default:
      return `Price freely: no blocking rules in ${state_name}`;
  }
}

/**
 * Pure computation of Pricing Signals from a flat list of RegulatoryItems.
 * One signal per (state, product) that appears in the data (federal `US` rows
 * are excluded — they are milestones, not state pricing rules).
 */
export function computeSignals(items: RegulatoryItem[]): ComputedSignal[] {
  // Group state-level items by state + product code.
  const groups = new Map<string, RegulatoryItem[]>();
  for (const item of items) {
    if (item.state === 'US') continue;
    const product = PRODUCT_BY_PROGRAM_ID[item.program?.id ?? ''];
    if (!product) continue;
    const key = `${item.state}#${product}`;
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }

  const out: ComputedSignal[] = [];
  for (const [key, group] of groups) {
    const [state, product] = key.split('#') as [string, ProductCode];
    const state_name = US_STATE_NAMES[state] ?? state;

    // Flavor bans only apply to flavored SKUs (the hero programs ZYN + IQOS).
    const flavor_banned =
      PRICING_HERO_PROGRAMS.includes(product) &&
      group.some((i) => i.category === 'flavor_ban' && i.status === 'enacted');

    const registry_gated = group.some(
      (i) => i.category === 'pmta_registry' && i.status === 'enacted'
    );

    const has_pending = group.some((i) => i.status === 'pending');

    // First parseable tax row wins.
    let tax_burden: number | undefined;
    let effective_date: Date | undefined;
    for (const i of group) {
      if (i.category !== 'tax') continue;
      const parsed = parseTaxBurden(i.provision_value);
      if (parsed != null) {
        tax_burden = parsed;
        effective_date = i.effective_date ?? undefined;
        break;
      }
    }

    const pricing_action = deriveAction({
      flavor_banned,
      registry_gated,
      has_pending,
      tax_burden,
    });
    const sellable = !(flavor_banned || registry_gated);
    const recommendation = recommend(pricing_action, {
      product,
      state_name,
      tax_burden,
    });

    out.push({
      id: signalId(state, product),
      state,
      state_name,
      product_code: product,
      sellable,
      tax_burden,
      pricing_action,
      recommendation,
      flavor_banned,
      registry_gated,
      has_pending,
      effective_date,
    });
  }

  return out.sort(
    (a, b) =>
      a.product_code.localeCompare(b.product_code) || a.state.localeCompare(b.state)
  );
}

/** pricing_action precedence (most → least restrictive wins first). */
export function deriveAction(input: {
  flavor_banned: boolean;
  registry_gated: boolean;
  has_pending: boolean;
  tax_burden?: number;
}): PricingAction {
  if (input.flavor_banned) return 'delist_banned';
  if (input.registry_gated) return 'restricted_assortment';
  if (input.has_pending) return 'watch_pending';
  if (input.tax_burden != null && input.tax_burden > HIGH_TAX_THRESHOLD)
    return 'adjust_for_tax';
  return 'price_freely';
}

/**
 * Computes and persists the Gold PricingSignal rows from the current
 * RegulatoryItem rows. Called at the end of both the seeded and CDC-sync flows
 * so the pricing UI always reads a fresh, idempotent signal table.
 */
@Injectable({ providedIn: 'root' })
export class PricingService {
  /** Recompute + upsert all Pricing Signals. Returns the signal count. */
  async recompute(items: RegulatoryItem[]): Promise<PricingResult> {
    const client = getRayfinClient();
    const signals = computeSignals(items);
    const now = new Date();

    for (const s of signals) {
      const payload = {
        state: s.state,
        state_name: s.state_name,
        product_code: s.product_code,
        sellable: s.sellable,
        tax_burden: s.tax_burden,
        pricing_action: s.pricing_action,
        recommendation: s.recommendation,
        flavor_banned: s.flavor_banned,
        registry_gated: s.registry_gated,
        has_pending: s.has_pending,
        effective_date: s.effective_date,
        updated_at: now,
        program: { id: programId(s.product_code) },
      };
      await client.data.PricingSignal.upsert({ id: s.id }, { id: s.id, ...payload }, payload);
    }

    return { signals: signals.length };
  }

  /** Delete every PricingSignal row (used by the workspace reset). */
  async wipeAll(): Promise<void> {
    const client = getRayfinClient();
    const rows = await client.data.PricingSignal.findMany();
    for (const r of rows) await client.data.PricingSignal.delete({ id: r.id });
  }
}
