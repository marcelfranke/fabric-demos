/**
 * Offline reconciliation harness (mirrors the PR #31 proof standard).
 *
 * Rebuilds the curated seed set entirely in memory — NO backend, NO network,
 * NO Fabric — runs the pure `computeSignals` + synthetic `revenue` engines, and
 * asserts every canonical number the app's views must agree on. This is the
 * ground-truth proof that the enrichment pages reconcile, since the authed
 * pages themselves need a Fabric backend + interactive Entra auth that is not
 * reachable in autopilot.
 */
import type { RegulatoryItem } from '../../../rayfin/data/schema';

import {
  REVENUE_AT_RISK_USD,
  SEED_BASELINE_ITEMS,
  SEED_ITEMS,
  SEED_TAX_ITEMS,
  TOTAL_BASELINE_USD,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from './constants';
import { computeSignals, type ComputedSignal } from './pricing.service';
import { programId } from './programs';
import { buildBaselines, revenueAtRisk, whatIf } from './revenue.service';

/** Rebuild the seeded-mode RegulatoryItem set exactly as SeedService does. */
function buildSeedItems(): RegulatoryItem[] {
  const seeds = [...SEED_ITEMS, ...SEED_TAX_ITEMS, ...SEED_BASELINE_ITEMS];
  const items: RegulatoryItem[] = [];
  for (const seed of seeds) {
    for (const program of seed.programs) {
      items.push({
        id: `${seed.category}#${seed.state}#${program}#${seed.slug}`,
        title: seed.title,
        state: seed.state,
        state_name: US_STATE_NAMES[seed.state] ?? seed.state,
        category: seed.category,
        status: seed.status,
        provision_value: seed.provision_value,
        effective_date: seed.effective_date ? new Date(seed.effective_date) : undefined,
        source_url: seed.source_url,
        program: { id: programId(program) },
      } as unknown as RegulatoryItem);
    }
  }
  return items;
}

function byProduct(signals: ComputedSignal[], code: ProductCode): number {
  return signals.filter((s) => s.product_code === code).length;
}

function byAction(signals: ComputedSignal[], action: PricingAction): number {
  return signals.filter((s) => s.pricing_action === action).length;
}

function distinctStates(signals: ComputedSignal[]): number {
  return new Set(signals.map((s) => s.state)).size;
}

describe('PMI seed reconciliation (offline)', () => {
  const signals = computeSignals(buildSeedItems());

  it('produces 60 pricing signals (IQOS 51 / ZYN 9)', () => {
    expect(signals.length).toBe(60);
    expect(byProduct(signals, 'IQOS')).toBe(51);
    expect(byProduct(signals, 'ZYN')).toBe(9);
  });

  it('reconciles the action split 18 / 9 / 25 / 7 / 1', () => {
    expect(byAction(signals, 'delist_banned')).toBe(18);
    expect(byAction(signals, 'restricted_assortment')).toBe(9);
    expect(byAction(signals, 'price_freely')).toBe(25);
    expect(byAction(signals, 'adjust_for_tax')).toBe(7);
    expect(byAction(signals, 'watch_pending')).toBe(1);
  });

  it('has 34 dated signals and 26 undated', () => {
    const dated = signals.filter((s) => s.effective_date != null).length;
    expect(dated).toBe(34);
    expect(signals.length - dated).toBe(26);
  });

  it('has 34 taxed states with a 24.2% average excise burden', () => {
    const taxed = signals.filter((s) => s.tax_burden != null);
    expect(taxed.length).toBe(34);
    const avg =
      taxed.reduce((a, s) => a + (s.tax_burden ?? 0), 0) / taxed.length;
    expect(Math.round(avg * 10) / 10).toBe(24.2);
  });

  it('has 18 restricted-or-banned states and 35 SKUs needing a price change', () => {
    const restrictedOrBanned = signals.filter(
      (s) =>
        s.pricing_action === 'delist_banned' ||
        s.pricing_action === 'restricted_assortment'
    );
    expect(distinctStates(restrictedOrBanned)).toBe(18);

    const actionable = signals.filter((s) => s.pricing_action !== 'price_freely');
    expect(actionable.length).toBe(35);
  });

  it('surfaces both pending views: 2 pending-bill states vs 1 watch_pending action', () => {
    const pendingStates = new Set(
      signals.filter((s) => s.has_pending).map((s) => s.state)
    );
    expect(pendingStates.size).toBe(2); // IA + UT
    expect(byAction(signals, 'watch_pending')).toBe(1); // IA only (UT → delist)
  });

  it('allocates synthetic revenue that totals the report baseline + at-risk', () => {
    const baselines = buildBaselines(signals);
    const total = baselines.reduce((a, b) => a + b.baseline, 0);
    expect(Math.round(total)).toBe(TOTAL_BASELINE_USD);
    expect(Math.round(revenueAtRisk(signals))).toBe(REVENUE_AT_RISK_USD);
  });

  it('what-if reproduces the report at-risk anchor at default inputs', () => {
    const res = whatIf(signals, { priceChangePct: -10, elasticity: 0.8 });
    expect(Math.round(res.baselineRevenue)).toBe(TOTAL_BASELINE_USD);
    expect(Math.round(res.atRiskBaseline)).toBe(REVENUE_AT_RISK_USD);
    // A markdown with inelastic demand loses revenue (negative delta).
    expect(res.revenueDelta).toBeLessThan(0);
  });
});
