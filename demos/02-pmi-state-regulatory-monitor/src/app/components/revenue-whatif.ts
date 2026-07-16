import { Component, computed, inject, input, signal } from '@angular/core';

import type { PricingSignal } from '../../../rayfin/data/schema';
import type { ProductCode } from '../services/constants';
import { RevenueService, type WhatIfInput } from '../services/revenue.service';

/**
 * Reusable revenue-at-risk what-if widget. Deterministic + offline: it reads the
 * synthetic baseline (revenue.service) over the FULL signal set, then scopes the
 * live recompute by the optional state/program inputs. Used portfolio-wide on
 * the Revenue page and scoped-to-one-state on the state drill-down.
 */
@Component({
  selector: 'app-revenue-whatif',
  template: `
    <div class="whatif">
      <div class="whatif__anchors">
        <div class="anchor">
          <span class="anchor__label">Baseline revenue</span>
          <span class="anchor__num">{{ money(result().baselineRevenue) }}</span>
        </div>
        <div class="anchor anchor--risk">
          <span class="anchor__label">Revenue at risk</span>
          <span class="anchor__num">{{ money(result().atRiskBaseline) }}</span>
        </div>
      </div>

      <div class="whatif__controls">
        <label class="ctl">
          <span class="ctl__row">
            <span class="ctl__label">Price change</span>
            <span class="ctl__val mono">{{ priceChangePct() }}%</span>
          </span>
          <input
            type="range"
            min="-40"
            max="40"
            step="1"
            [value]="priceChangePct()"
            (input)="onPrice($event)"
          />
        </label>

        <label class="ctl">
          <span class="ctl__row">
            <span class="ctl__label">Demand elasticity</span>
            <span class="ctl__val mono">{{ elasticity().toFixed(2) }}</span>
          </span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            [value]="elasticity()"
            (input)="onElasticity($event)"
          />
        </label>
      </div>

      <div class="whatif__out">
        <div class="out">
          <span class="out__label">Projected revenue</span>
          <span class="out__num">{{ money(result().projectedRevenue) }}</span>
        </div>
        <div class="out">
          <span class="out__label">Revenue impact</span>
          <span class="out__num" [class.neg]="result().revenueDelta < 0" [class.pos]="result().revenueDelta > 0">
            {{ signed(result().revenueDelta) }}
          </span>
        </div>
        <div class="out">
          <span class="out__label">Margin impact</span>
          <span class="out__num" [class.neg]="result().marginDelta < 0" [class.pos]="result().marginDelta > 0">
            {{ signed(result().marginDelta) }}
          </span>
        </div>
      </div>

      <p class="whatif__note">
        Synthetic baseline · {{ result().signals }} signal(s) in scope · demand
        response %ΔQ = −elasticity × %ΔP.
      </p>
    </div>
  `,
  styles: `
    :host { display: block; }
    .whatif { display: flex; flex-direction: column; gap: 1.25rem; }
    .whatif__anchors { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .anchor {
      display: flex; flex-direction: column; gap: 0.35rem;
      padding: 1.1rem 1.25rem; border-radius: var(--radius-lg);
      background: linear-gradient(160deg, var(--hero-bg-2), var(--hero-bg) 65%);
      color: var(--hero-on);
      box-shadow: 0 16px 34px -22px rgba(10, 90, 181, 0.55);
    }
    .anchor--risk { background: linear-gradient(160deg, #e0523e, #b83b2b 70%); }
    .anchor__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--hero-on-muted);
    }
    .anchor__num {
      font-family: var(--font-display); font-weight: 800;
      font-size: clamp(1.6rem, 3vw, 2.25rem); line-height: 1; color: var(--hero-on);
    }
    .whatif__controls { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
    .ctl { display: flex; flex-direction: column; gap: 0.5rem; }
    .ctl__row { display: flex; align-items: baseline; justify-content: space-between; }
    .ctl__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .ctl__val { color: var(--accent); font-weight: 600; }
    input[type='range'] { width: 100%; accent-color: var(--accent); cursor: pointer; }
    .whatif__out { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .out {
      display: flex; flex-direction: column; gap: 0.3rem;
      padding: 1rem 1.15rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
    }
    .out__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .out__num {
      font-family: var(--font-display); font-weight: 700;
      font-size: 1.4rem; line-height: 1; color: var(--cream);
    }
    .out__num.neg { color: #e0523e; }
    .out__num.pos { color: #2e9e6b; }
    .whatif__note { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
    @media (max-width: 40rem) {
      .whatif__anchors, .whatif__controls, .whatif__out { grid-template-columns: 1fr; }
    }
  `,
})
export class RevenueWhatif {
  private readonly revenue = inject(RevenueService);

  readonly signals = input<PricingSignal[]>([]);
  readonly scopeState = input<string | undefined>(undefined);
  readonly scopeProduct = input<ProductCode | undefined>(undefined);

  protected readonly priceChangePct = signal(this.revenue.defaultPriceChangePct);
  protected readonly elasticity = signal(this.revenue.defaultElasticity);

  protected readonly result = computed(() => {
    const scope: WhatIfInput['scope'] = {
      state: this.scopeState(),
      product: this.scopeProduct(),
    };
    return this.revenue.whatIf(this.signals(), {
      priceChangePct: this.priceChangePct(),
      elasticity: this.elasticity(),
      scope,
    });
  });

  protected onPrice(e: Event): void {
    this.priceChangePct.set(Number((e.target as HTMLInputElement).value));
  }

  protected onElasticity(e: Event): void {
    this.elasticity.set(Number((e.target as HTMLInputElement).value));
  }

  protected money(n: number): string {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }

  protected signed(n: number): string {
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    return `${sign}$${(Math.abs(n) / 1_000_000).toFixed(2)}M`;
  }
}
