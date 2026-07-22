import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { RevenueWhatif } from '../../components/revenue-whatif';
import { DataService } from '../../services/data.service';
import { RevenueService } from '../../services/revenue.service';
import {
  US_STATE_NAMES,
  type ProductCode,
} from '../../services/constants';

@Component({
  selector: 'app-revenue',
  imports: [FormsModule, RevenueWhatif],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Commercial desk</p>
        <h1 class="title">Revenue at risk · what-if</h1>
        <p class="lead">
          Model a price move against the regulated portfolio. Sliders recompute
          revenue and margin live; scope to a program or state to focus. The
          baseline is a deterministic synthetic allocation calibrated to the
          Power BI “Value Report 2025” ({{ money(baseline) }} baseline /
          {{ money(atRisk) }} at risk).
        </p>
      </header>

      <div class="scopes">
        <label class="field">
          <span class="field__label">Program</span>
          <select [ngModel]="program()" (ngModelChange)="setProgram($event)">
            <option value="">All programs</option>
            <option value="IQOS">IQOS</option>
            <option value="ZYN">ZYN</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">State</span>
          <select [ngModel]="state()" (ngModelChange)="state.set($event)">
            <option value="">All states</option>
            @for (s of stateOptions(); track s) {
              <option [value]="s">{{ s }} — {{ stateName(s) }}</option>
            }
          </select>
        </label>
      </div>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 20rem"></div>
      } @else {
        <section class="card">
          <app-revenue-whatif
            [signals]="signals()"
            [scopeProduct]="program() || undefined"
            [scopeState]="state() || undefined"
          />
        </section>

        <p class="foot">
          Synthetic, deterministic, offline — labeled model, NOT PMI financials.
          The portfolio total and at-risk slice are normalized to match the
          report so app and report tell one story.
        </p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.5rem; max-width: 56rem; }
    .head { display: flex; flex-direction: column; gap: 0.5rem; }
    .title {
      font-family: var(--font-display); font-weight: 800;
      font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.02;
      letter-spacing: -0.02em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); max-width: 48rem; }
    .scopes { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 12rem; }
    .field__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .field select {
      padding: 0.55rem 0.7rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
      color: var(--cream); font: inherit; outline: none;
    }
    .field select:focus { border-color: var(--accent); }
    .card {
      padding: 1.5rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg); background: var(--ink-surface);
    }
    .foot { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
  `,
})
export class Revenue implements OnInit {
  private readonly data = inject(DataService);
  private readonly revenue = inject(RevenueService);

  protected readonly loading = signal(true);
  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly program = signal<ProductCode | ''>('');
  protected readonly state = signal<string>('');

  protected readonly baseline = this.revenue.totalBaselineUsd;
  protected readonly atRisk = this.revenue.revenueAtRiskUsd;

  protected readonly stateOptions = computed(() =>
    [...new Set(this.signals().map((s) => s.state))].sort()
  );

  async ngOnInit(): Promise<void> {
    try {
      this.signals.set(await this.data.listSignals());
    } finally {
      this.loading.set(false);
    }
  }

  protected setProgram(p: ProductCode | ''): void {
    this.program.set(p);
  }

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
  }

  protected money(n: number): string {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
}
