import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import type { PricingSignal, RegulatoryItem } from '../../../../rayfin/data/schema';
import { RevenueWhatif } from '../../components/revenue-whatif';
import { DataService } from '../../services/data.service';
import { RevenueService } from '../../services/revenue.service';
import {
  CATEGORY_LABELS,
  PRICING_ACTIONS,
  US_STATE_NAMES,
  type PricingAction,
} from '../../services/constants';

@Component({
  selector: 'app-state-detail',
  imports: [MatIconModule, RouterLink, RevenueWhatif],
  template: `
    <div class="page page-enter">
      <a class="back" routerLink="/states">
        <mat-icon>arrow_back</mat-icon> All states
      </a>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 14rem"></div>
      } @else if (stateSignals().length === 0) {
        <p class="empty">No monitored signals for “{{ code() }}”.</p>
      } @else {
        <header class="head">
          <p class="eyebrow">State drill-down</p>
          <h1 class="title">{{ stateName() }} <span class="mono">{{ code() }}</span></h1>
        </header>

        <!-- KPI strip -->
        <div class="kpis">
          <div class="kpi">
            <span class="kpi__label">Excise tax</span>
            <span class="kpi__num">{{ excise() == null ? '—' : excise()!.toFixed(1) + '%' }}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">Programs affected</span>
            <span class="kpi__num">{{ stateSignals().length }}</span>
          </div>
          <div class="kpi kpi--risk">
            <span class="kpi__label">Revenue at risk</span>
            <span class="kpi__num">{{ money(stateAtRisk()) }}</span>
          </div>
          <div class="kpi">
            <span class="kpi__label">Baseline revenue</span>
            <span class="kpi__num">{{ money(stateBaseline()) }}</span>
          </div>
        </div>

        <!-- Per-program pricing action + affected product lines -->
        <section class="block">
          <h2 class="block__title">Recommended action by program</h2>
          <div class="prog-grid">
            @for (s of stateSignals(); track s.id) {
              <article class="prog-card">
                <div class="prog-card__top">
                  <span class="tag mono">{{ s.product_code }}</span>
                  <span class="pill pill--{{ actionPill(s.pricing_action) }}">
                    {{ actionLabel(s.pricing_action) }}
                  </span>
                </div>
                <p class="prog-card__rec">{{ s.recommendation }}</p>
                <dl class="mini">
                  <div><dt>Sellable</dt><dd>{{ s.sellable ? 'Yes' : 'Blocked' }}</dd></div>
                  <div><dt>Tax burden</dt><dd class="mono">{{ s.tax_burden == null ? '—' : s.tax_burden + '%' }}</dd></div>
                  <div><dt>Effective</dt><dd class="mono">{{ s.effective_date ? fmt(s.effective_date) : 'Undated' }}</dd></div>
                  <div><dt>Baseline</dt><dd class="mono">{{ money(baselineFor(s)) }}</dd></div>
                </dl>
                <a class="link" [routerLink]="['/regulatory', s.id]">
                  Signal detail <mat-icon>arrow_forward</mat-icon>
                </a>
              </article>
            }
          </div>
        </section>

        <!-- Regulatory rules with effective dates -->
        <section class="block">
          <h2 class="block__title">Regulatory rules · effective dates</h2>
          @if (rules().length === 0) {
            <p class="empty">No underlying provisions recorded for this state.</p>
          } @else {
            <ul class="rules">
              @for (r of rules(); track r.id) {
                <li class="rule">
                  <div class="rule__main">
                    <span class="pill pill--{{ statusPill(r.status) }}">{{ r.status }}</span>
                    <span class="tag mono">{{ catLabel(r.category) }}</span>
                    <span class="rule__title">{{ r.title }}</span>
                  </div>
                  <div class="rule__meta">
                    @if (r.effective_date) {
                      <span class="mono">eff. {{ fmt(r.effective_date) }}</span>
                    }
                    @if (r.provision_value) { <span class="mono">{{ r.provision_value }}</span> }
                    @if (r.source_url) {
                      <a class="link" [href]="r.source_url" target="_blank" rel="noopener">
                        Source <mat-icon>open_in_new</mat-icon>
                      </a>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Scoped what-if -->
        <section class="block">
          <h2 class="block__title">Revenue-at-risk what-if · {{ code() }}</h2>
          <app-revenue-whatif [signals]="allSignals()" [scopeState]="code()" />
        </section>

        <p class="foot">
          Revenue figures are a deterministic synthetic baseline (labeled), not
          PMI financials — see the Revenue page for the portfolio model.
        </p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.5rem; max-width: 60rem; }
    .back {
      display: inline-flex; align-items: center; gap: 0.35rem;
      color: var(--cream-dim); text-decoration: none;
      font-family: var(--font-mono); font-size: var(--text-small); width: fit-content;
    }
    .back:hover { color: var(--accent); }
    .back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .title {
      font-family: var(--font-display); font-weight: 800;
      font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.02;
      letter-spacing: -0.02em; color: var(--cream); margin: 0;
      display: flex; align-items: baseline; gap: 0.6rem;
    }
    .title .mono { font-size: 1rem; color: var(--accent); }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
    .kpi {
      display: flex; flex-direction: column; gap: 0.35rem;
      padding: 1.1rem 1.2rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg); background: var(--ink-surface);
    }
    .kpi--risk {
      background: linear-gradient(160deg, var(--hero-bg-2), var(--hero-bg) 65%);
      border: 0;
    }
    .kpi--risk .kpi__label { color: var(--hero-on-muted); }
    .kpi--risk .kpi__num { color: var(--hero-on); }
    .kpi__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .kpi__num {
      font-family: var(--font-display); font-weight: 800;
      font-size: 1.6rem; line-height: 1; color: var(--cream);
    }
    .block { display: flex; flex-direction: column; gap: 0.9rem; }
    .block__title {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-dim); margin: 0;
    }
    .prog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 1rem; }
    .prog-card {
      display: flex; flex-direction: column; gap: 0.7rem;
      padding: 1.1rem 1.2rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg); background: var(--ink-surface);
    }
    .prog-card__top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .prog-card__rec { color: var(--cream-muted); margin: 0; font-size: var(--text-small); }
    .tag { font-size: var(--text-caption); letter-spacing: 0.08em; color: var(--cream-dim); text-transform: uppercase; }
    .mini { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; margin: 0; }
    .mini > div { display: flex; flex-direction: column; gap: 0.1rem; }
    .mini dt {
      font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--cream-dim);
    }
    .mini dd { margin: 0; color: var(--cream); font-size: var(--text-small); }
    .link {
      display: inline-flex; align-items: center; gap: 0.3rem;
      color: var(--accent); text-decoration: none; font-size: var(--text-small);
    }
    .link mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .rule {
      display: flex; flex-direction: column; gap: 0.4rem;
      padding: 0.85rem 1rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
    }
    .rule__main { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .rule__title { color: var(--cream); }
    .rule__meta {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
      color: var(--cream-dim); font-size: var(--text-small);
    }
    .empty { color: var(--cream-dim); }
    .foot { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
    @media (max-width: 46rem) { .kpis { grid-template-columns: 1fr 1fr; } }
  `,
})
export class StateDetail implements OnInit {
  private readonly data = inject(DataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly revenue = inject(RevenueService);

  protected readonly code = signal('');
  protected readonly loading = signal(true);
  protected readonly allSignals = signal<PricingSignal[]>([]);
  protected readonly rules = signal<RegulatoryItem[]>([]);

  protected readonly stateSignals = computed(() =>
    this.allSignals()
      .filter((s) => s.state === this.code())
      .sort((a, b) => PRICING_ACTIONS[b.pricing_action].order - PRICING_ACTIONS[a.pricing_action].order)
  );

  protected readonly stateName = computed(() => US_STATE_NAMES[this.code()] ?? this.code());

  protected readonly excise = computed(() => {
    const rates = this.stateSignals()
      .map((s) => s.tax_burden)
      .filter((n): n is number => typeof n === 'number' && n > 0);
    return rates.length ? Math.max(...rates) : null;
  });

  private readonly baselineByKey = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.revenue.baselines(this.allSignals())) {
      map.set(`${e.state}|${e.product_code}`, e.baseline);
    }
    return map;
  });

  protected readonly stateBaseline = computed(() =>
    this.stateSignals().reduce((sum, s) => sum + this.baselineFor(s), 0)
  );

  protected readonly stateAtRisk = computed(() =>
    this.revenue.atRisk(this.allSignals(), { state: this.code() })
  );

  async ngOnInit(): Promise<void> {
    const code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();
    if (!code) {
      void this.router.navigate(['/states']);
      return;
    }
    this.code.set(code);
    try {
      const [signals, rules] = await Promise.all([
        this.data.listSignals(),
        this.data.listItemsForState(code),
      ]);
      this.allSignals.set(signals);
      this.rules.set(rules);
    } finally {
      this.loading.set(false);
    }
  }

  protected baselineFor(s: PricingSignal): number {
    return this.baselineByKey().get(`${s.state}|${s.product_code}`) ?? 0;
  }

  protected money(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }

  protected fmt(d: Date | string): string {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected actionPill(a: PricingAction): string {
    return PRICING_ACTIONS[a].pill;
  }
  protected actionLabel(a: PricingAction): string {
    return PRICING_ACTIONS[a].label;
  }
  protected catLabel(category: RegulatoryItem['category']): string {
    return CATEGORY_LABELS[category];
  }
  protected statusPill(status: string): string {
    if (status === 'enacted') return 'emerald';
    if (status === 'pending') return 'amber';
    return '';
  }
}
