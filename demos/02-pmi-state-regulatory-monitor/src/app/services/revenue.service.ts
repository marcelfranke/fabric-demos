import { Injectable } from '@angular/core';

import {
  DEFAULT_ELASTICITY,
  DEFAULT_PRICE_CHANGE_PCT,
  REVENUE_AT_RISK_USD,
  TOTAL_BASELINE_USD,
  type PricingAction,
  type ProductCode,
} from './constants';

/**
 * Synthetic revenue-at-risk model (deterministic, offline, clearly labeled).
 *
 * The app has no real revenue basis, so we allocate a lightweight synthetic
 * baseline across the 60 (state × program) Pricing Signals. Two group scalars
 * normalize the raw per-signal weights so that:
 *   • Σ baseline over ALL signals            = TOTAL_BASELINE_USD ($18.65M)
 *   • Σ baseline over NON-`price_freely` rows = REVENUE_AT_RISK_USD ($3.66M)
 * which makes the app agree exactly with the Power BI "Value Report 2025"
 * baseline + revenue-at-risk. Deterministic (no RNG, no clock, no network) so
 * every reload reproduces the same figures. NOT PMI financials.
 */

/** Minimal shape shared by ComputedSignal and the PricingSignal gold row. */
export interface RevenueSignal {
  state: string;
  product_code: ProductCode;
  pricing_action: PricingAction;
}

export interface BaselineEntry extends RevenueSignal {
  /** Synthetic annual baseline revenue (USD). */
  baseline: number;
  /** True when the signal is under a regulatory action (not `price_freely`). */
  atRisk: boolean;
}

export interface WhatIfInput {
  /** Price change to model, e.g. -10 for a 10% markdown. */
  priceChangePct: number;
  /** Demand elasticity: %ΔQ = -elasticity × %ΔP. */
  elasticity: number;
  /** Optional filter applied AFTER portfolio-wide normalization. */
  scope?: { state?: string; product?: ProductCode; atRiskOnly?: boolean };
}

export interface WhatIfResult {
  /** Baseline revenue of the scoped signals. */
  baselineRevenue: number;
  /** At-risk baseline (non-`price_freely`) within the scope — the anchor. */
  atRiskBaseline: number;
  /** Revenue after the price move + elastic demand response. */
  projectedRevenue: number;
  /** projectedRevenue − baselineRevenue (negative = revenue lost). */
  revenueDelta: number;
  /** Contribution-margin impact of the move (negative = margin lost). */
  marginDelta: number;
  /** Count of signals in scope. */
  signals: number;
}

// Assumed baseline contribution margin (documented demo assumption, NOT PMI).
const MARGIN_RATE = 0.45;

// Relative program size — only affects how baseline spreads across programs.
// (IQOS has 0 signals so its weight is never exercised.)
const PROGRAM_WEIGHT: Record<ProductCode, number> = {
  VEEV: 1,
  ZYN: 0.6,
  IQOS: 0.4,
};

function isAtRisk(action: PricingAction): boolean {
  return action !== 'price_freely';
}

/** Deterministic weight in [0.5, 1.5) from a stable string (FNV-1a). */
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.5 + ((h >>> 0) % 1000) / 1000;
}

function rawWeight(s: RevenueSignal): number {
  return hashUnit(s.state) * (PROGRAM_WEIGHT[s.product_code] ?? 1);
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/**
 * Allocate the synthetic baseline across the FULL signal set. Always call with
 * the complete portfolio (all 60 signals); scope AFTER, never before, or the
 * group scalars — and therefore the totals — would be wrong.
 */
export function buildBaselines(signals: readonly RevenueSignal[]): BaselineEntry[] {
  const freeRaw = sum(
    signals.filter((s) => !isAtRisk(s.pricing_action)).map(rawWeight)
  );
  const riskRaw = sum(
    signals.filter((s) => isAtRisk(s.pricing_action)).map(rawWeight)
  );
  const freeTarget = TOTAL_BASELINE_USD - REVENUE_AT_RISK_USD;
  const freeScale = freeRaw > 0 ? freeTarget / freeRaw : 0;
  const riskScale = riskRaw > 0 ? REVENUE_AT_RISK_USD / riskRaw : 0;

  return signals.map((s) => {
    const atRisk = isAtRisk(s.pricing_action);
    return {
      state: s.state,
      product_code: s.product_code,
      pricing_action: s.pricing_action,
      atRisk,
      baseline: rawWeight(s) * (atRisk ? riskScale : freeScale),
    };
  });
}

function inScope(e: BaselineEntry, scope?: WhatIfInput['scope']): boolean {
  if (!scope) return true;
  if (scope.state && e.state !== scope.state) return false;
  if (scope.product && e.product_code !== scope.product) return false;
  if (scope.atRiskOnly && !e.atRisk) return false;
  return true;
}

/** Portfolio (or scoped) revenue-at-risk = Σ baseline of non-`price_freely`. */
export function revenueAtRisk(
  signals: readonly RevenueSignal[],
  scope?: WhatIfInput['scope']
): number {
  return sum(
    buildBaselines(signals)
      .filter((e) => e.atRisk && inScope(e, scope))
      .map((e) => e.baseline)
  );
}

/** Live what-if recompute of revenue + margin impact for a price move. */
export function whatIf(
  signals: readonly RevenueSignal[],
  input: WhatIfInput
): WhatIfResult {
  const scoped = buildBaselines(signals).filter((e) => inScope(e, input.scope));
  const baselineRevenue = sum(scoped.map((e) => e.baseline));
  const atRiskBaseline = sum(scoped.filter((e) => e.atRisk).map((e) => e.baseline));

  const p = input.priceChangePct / 100;
  const priceFactor = 1 + p;
  const qtyFactor = 1 - input.elasticity * p; // %ΔQ = -e × %ΔP

  const projectedRevenue = baselineRevenue * priceFactor * qtyFactor;
  const revenueDelta = projectedRevenue - baselineRevenue;

  const baseCost = baselineRevenue * (1 - MARGIN_RATE);
  const projCost = baseCost * qtyFactor; // cost scales with volume only
  const baseMargin = baselineRevenue - baseCost;
  const projMargin = projectedRevenue - projCost;
  const marginDelta = projMargin - baseMargin;

  return {
    baselineRevenue,
    atRiskBaseline,
    projectedRevenue,
    revenueDelta,
    marginDelta,
    signals: scoped.length,
  };
}

@Injectable({ providedIn: 'root' })
export class RevenueService {
  readonly totalBaselineUsd = TOTAL_BASELINE_USD;
  readonly revenueAtRiskUsd = REVENUE_AT_RISK_USD;
  readonly defaultPriceChangePct = DEFAULT_PRICE_CHANGE_PCT;
  readonly defaultElasticity = DEFAULT_ELASTICITY;

  baselines(signals: readonly RevenueSignal[]): BaselineEntry[] {
    return buildBaselines(signals);
  }

  atRisk(signals: readonly RevenueSignal[], scope?: WhatIfInput['scope']): number {
    return revenueAtRisk(signals, scope);
  }

  whatIf(signals: readonly RevenueSignal[], input: WhatIfInput): WhatIfResult {
    return whatIf(signals, input);
  }
}
