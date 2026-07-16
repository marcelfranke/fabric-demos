import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';

import type { PricingSignal, Program, RegulatoryItem } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';
import { CdcStateSyncService } from '../../services/cdc-state-sync.service';
import { UsChoropleth } from '../../components/us-choropleth';
import {
  DEFAULT_PRICING_PROGRAM,
  PRICING_ACTIONS,
  PRICING_ACTION_ORDER,
  type PricingAction,
  type ProductCode,
} from '../../services/constants';

@Component({
  selector: 'app-dashboard',
  imports: [
    BaseChartDirective,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    UsChoropleth,
  ],
  template: `
    <div class="dashboard page-enter">
      <header class="hero">
        <p class="eyebrow">Overview</p>
        <h1 class="hero__title">
          {{ greeting }}.<br />
          <em>{{ totalLabel() }}</em>
        </h1>
        <p class="hero__lead">
          @if (appConfig.isSynced()) {
            Live from the
            <span class="mono">CDC STATE System</span> ·
            {{ syncMeta() }}
          } @else {
            A curated snapshot of US state regulation across PMI's smoke-free
            product lines.
          }
        </p>
      </header>

      @if (loading()) {
        <section class="kpis">
          <div class="skeleton skeleton--card kpi--feature"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
        </section>
        <section class="split">
          <div class="skeleton skeleton--card" style="height: 18rem"></div>
          <div class="skeleton skeleton--card" style="height: 18rem"></div>
        </section>
      } @else {
        <!-- KPI grid -->
        <section class="kpis">
          <article class="kpi kpi--feature">
            <span class="kpi__label">SKUs needing a price change</span>
            <div class="kpi__value">
              <span class="kpi__num">{{ actionableSignals() }}</span>
              <span class="kpi__suffix">/ {{ totalSignals() }} signals</span>
            </div>
            <div class="kpi__bar">
              @for (a of actions; track a) {
                <span
                  class="kpi__bar-seg"
                  [style.background]="actionColor(a)"
                  [style.flexGrow]="actionShare(a)"
                ></span>
              }
            </div>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--closed"></span>
              Restricted / banned states
            </span>
            <span class="kpi__num">{{ restrictedStates() }}</span>
            <span class="kpi__delta">SKU blocked</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--in_progress"></span>
              Avg excise tax burden
            </span>
            <span class="kpi__num">{{ avgTaxLabel() }}</span>
            <span class="kpi__delta">on taxed SKUs</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--in_progress"></span>
              Pending-bill states
            </span>
            <span class="kpi__num">{{ pendingStates() }}</span>
            <span class="kpi__delta">pricing risk</span>
          </article>
        </section>

        <!-- US map -->
        <section class="panel panel--map">
          <header class="panel__head">
            <h3 class="panel__title">Pricing action by state</h3>
            <div class="prog-switch">
              @for (p of programOptions; track p) {
                <button
                  type="button"
                  class="prog-switch__btn"
                  [class.prog-switch__btn--active]="program() === p"
                  (click)="selectProgram(p)"
                >
                  {{ p }}
                </button>
              }
            </div>
          </header>
          <app-us-choropleth
            [actionByState]="actionByState()"
            (stateSelect)="onStateSelect($event)"
          />
          <p class="panel__hint eyebrow">Click a state to see its pricing recommendation</p>
        </section>

        <!-- Chart + recent -->
        <section class="split">
          <article class="panel panel--chart">
            <header class="panel__head">
              <h3 class="panel__title">{{ program() }} states by pricing action</h3>
              <span class="eyebrow">{{ programSignals().length }} states</span>
            </header>
            <div class="chart-wrap">
              <canvas
                baseChart
                [data]="chartData"
                [options]="chartOptions"
                type="bar"
              ></canvas>
            </div>
          </article>

          <article class="panel">
            <header class="panel__head">
              <h3 class="panel__title">Priority signals</h3>
              <a class="panel__link" routerLink="/regulatory">
                View all
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            @if (recent().length === 0) {
              <p class="panel__empty">No pricing signals yet — run setup.</p>
            } @else {
              <ol class="feed">
                @for (s of recent(); track s.id) {
                  <li class="feed__item">
                    <span
                      class="feed__swatch"
                      [style.background]="actionColor(s.pricing_action)"
                    ></span>
                    <a class="feed__title" [routerLink]="['/regulatory', s.id]">
                      {{ s.state_name }} · {{ s.product_code }}
                    </a>
                    <span class="feed__meta">
                      <span class="pill pill--{{ actionPill(s.pricing_action) }}">
                        {{ actionLabel(s.pricing_action) }}
                      </span>
                    </span>
                  </li>
                }
              </ol>
            }
          </article>
        </section>

        <!-- Programs strip -->
        @if (programs().length > 0) {
          <section class="strip">
            <header class="strip__head">
              <h3 class="panel__title">Programs</h3>
              <a class="panel__link" routerLink="/programs">
                Browse programs
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            <div class="strip__grid">
              @for (p of programs().slice(0, 4); track p.id) {
                <a class="proj-card" [routerLink]="['/programs', p.id]">
                  <span class="eyebrow">{{ signalCount(p.id) }} signals</span>
                  <h4 class="proj-card__title">{{ p.name }}</h4>
                  @if (p.description) {
                    <p class="proj-card__desc">{{ p.description }}</p>
                  }
                  <span class="proj-card__arrow">
                    <mat-icon>north_east</mat-icon>
                  </span>
                </a>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .dashboard {
      display: flex;
      flex-direction: column;
      gap: clamp(2rem, 4vw, 3.5rem);
    }

    /* ── Hero ──────────────────────────────────────────────────── */
    .hero {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 48rem;
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4.5vw, 3.25rem);
      line-height: 1;
      letter-spacing: -0.035em;
      color: var(--cream);
      margin: 0;
    }

    .hero__title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 90, 'wght' 400;
      padding-right: 0.18em;
      color: var(--accent);
    }

    .hero__lead {
      color: var(--cream-muted);
      font-size: var(--text-body);
      max-width: 36rem;
    }

    .hero__lead .mono {
      font-family: var(--font-mono);
      color: var(--cream);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 4rem 0;
    }

    /* ── KPI cards ─────────────────────────────────────────────── */
    .kpis {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: 1rem;
    }

    @media (max-width: 64rem) {
      .kpis { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 28rem) {
      .kpis { grid-template-columns: 1fr; }
    }

    .kpi {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1.5rem;
      min-width: 0;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      transition: border-color var(--d-2) var(--ease-out);
    }

    .kpi:hover {
      border-color: var(--accent-border);
    }

    .kpi__label {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .kpi__value {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }

    .kpi__num {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.75rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
      color: var(--cream);
    }

    .kpi__suffix {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .kpi__delta {
      font-family: var(--font-mono);
      font-size: var(--text-small);
      color: var(--cream-muted);
      margin-top: auto;
    }

    .kpi--feature .kpi__num {
      font-size: clamp(3.5rem, 6vw, 5.5rem);
    }

    .kpi--feature {
      grid-row: span 1;
    }

    .kpi__bar {
      display: flex;
      height: 0.375rem;
      border-radius: var(--radius-pill);
      overflow: hidden;
      background: var(--ink-elevated);
      margin-top: auto;
    }

    .kpi__bar-seg {
      flex-grow: 0;
      flex-basis: 0;
      transition: flex-grow var(--d-3) var(--ease-out);
    }

    .kpi__bar-seg--open {
      background: var(--emerald);
    }

    .kpi__bar-seg--in_progress {
      background: var(--amber);
    }

    .kpi__bar-seg--closed {
      background: var(--cream-dim);
    }

    /* ── Split: chart + recent ─────────────────────────────────── */
    .split {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: 1rem;
    }

    @media (max-width: 64rem) {
      .split { grid-template-columns: minmax(0, 1fr); }
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 1.5rem;
      min-width: 0;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
    }

    .panel--map app-us-choropleth {
      display: block;
      max-width: 46rem;
      margin: 0 auto;
      width: 100%;
    }

    .panel--chart .chart-wrap {
      flex: 1;
      min-height: 16rem;
      min-width: 0;
      position: relative;
    }

    .panel--chart .chart-wrap canvas {
      display: block;
      max-width: 100%;
    }

    .panel__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .panel__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.375rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .panel__link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-muted);
      transition: color var(--d-1) var(--ease-out);
    }

    .panel__link:hover {
      color: var(--accent);
    }

    .panel__link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: transform var(--d-1) var(--ease-out);
    }

    .panel__link:hover mat-icon {
      transform: translateX(2px);
    }

    .panel__empty {
      color: var(--cream-dim);
      padding: 1rem 0 0.5rem;
    }

    /* Feed (recent tasks) */
    .feed {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .feed__item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 0;
      border-top: 1px solid var(--ink-border-soft);
    }

    .feed__item:first-child {
      border-top: none;
    }

    .feed__title {
      font-size: var(--text-body);
      color: var(--cream);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .feed__title:hover {
      color: var(--accent);
    }

    .feed__meta {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .feed__time {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--cream-dim);
    }

    /* ── Projects strip ────────────────────────────────────────── */
    .strip {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .strip__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .strip__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
      gap: 1rem;
    }

    .proj-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      padding: 1.25rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-md);
      color: var(--cream);
      min-height: 8rem;
      transition: border-color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out),
        background var(--d-2) var(--ease-out);
    }

    .proj-card:hover {
      border-color: var(--accent-border);
      transform: translateY(-2px);
      background: var(--ink-elevated);
      color: var(--cream);
    }

    .proj-card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.25rem;
      letter-spacing: -0.015em;
      color: var(--cream);
      margin: 0;
    }

    .proj-card__desc {
      font-size: var(--text-small);
      color: var(--cream-muted);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .proj-card__arrow {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      color: var(--cream-dim);
      transition: color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out);
    }

    .proj-card:hover .proj-card__arrow {
      color: var(--accent);
      transform: translate(2px, -2px);
    }

    .proj-card__arrow mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* ── Pricing extras ────────────────────────────────────────── */
    .prog-switch {
      display: inline-flex;
      gap: 0.25rem;
      padding: 0.2rem;
      background: var(--ink-elevated-1);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
    }

    .prog-switch__btn {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.08em;
      color: var(--cream-dim);
      background: transparent;
      border: 0;
      border-radius: calc(var(--radius-sm) - 2px);
      padding: 0.3rem 0.7rem;
      cursor: pointer;
      transition: background var(--d-2) var(--ease-out),
        color var(--d-2) var(--ease-out);
    }

    .prog-switch__btn--active {
      background: var(--accent);
      color: var(--ink);
    }

    .panel__hint {
      margin: 0.5rem 0 0;
    }

    .feed__swatch {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 2px;
      flex: 0 0 auto;
    }
  `,
})
export class Dashboard implements OnInit {
  private readonly data = inject(DataService);
  private readonly sync = inject(CdcStateSyncService);
  private readonly router = inject(Router);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly items = signal<RegulatoryItem[]>([]);
  protected readonly programs = signal<Program[]>([]);
  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly loading = signal(true);
  protected readonly greeting = greet();

  // Which program's signals color the map + drive the chart.
  protected readonly program = signal<ProductCode>(DEFAULT_PRICING_PROGRAM);
  protected readonly programOptions: readonly ProductCode[] = ['ZYN', 'VEEV', 'IQOS'];

  protected readonly actions = PRICING_ACTION_ORDER;

  /** Signals for the currently-selected program. */
  protected readonly programSignals = computed(() =>
    this.signals().filter((s) => s.product_code === this.program())
  );

  /** state → pricing_action for the selected program (map fill). */
  protected readonly actionByState = computed(() => {
    const byState: Record<string, PricingAction> = {};
    for (const s of this.programSignals()) byState[s.state] = s.pricing_action;
    return byState;
  });

  // ── Pricing KPIs (portfolio-wide across all programs) ─────────────────────

  /** Distinct states where a SKU is restricted or banned (not sellable). */
  protected readonly restrictedStates = computed(() => {
    const states = new Set<string>();
    for (const s of this.signals()) if (!s.sellable) states.add(s.state);
    return states.size;
  });

  /** Mean excise tax burden across signals that carry a tax figure. */
  protected readonly avgTaxBurden = computed(() => {
    const rates = this.signals()
      .map((s) => s.tax_burden)
      .filter((n): n is number => typeof n === 'number' && n > 0);
    if (!rates.length) return null;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  });

  /** Distinct states with a pending bill (pricing risk). */
  protected readonly pendingStates = computed(() => {
    const states = new Set<string>();
    for (const s of this.signals()) if (s.has_pending) states.add(s.state);
    return states.size;
  });

  /** SKUs (state+program signals) needing a price change this quarter. */
  protected readonly actionableSignals = computed(
    () => this.signals().filter((s) => s.pricing_action !== 'price_freely').length
  );

  protected readonly totalSignals = computed(() => this.signals().length);

  protected readonly recent = computed(() =>
    [...this.signals()]
      .sort((a, b) => PRICING_ACTIONS[b.pricing_action].order - PRICING_ACTIONS[a.pricing_action].order)
      .slice(0, 6)
  );

  protected chartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1d1a26',
        borderColor: '#2a2532',
        borderWidth: 1,
        titleColor: '#f4ecdf',
        bodyColor: '#a39db1',
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#a39db1',
          font: { family: 'JetBrains Mono', size: 10 },
        },
        border: { color: '#2a2532' },
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
          color: '#a39db1',
          font: { family: 'JetBrains Mono', size: 10 },
        },
        grid: { color: 'rgba(255,255,255,0.03)' },
        border: { color: '#2a2532' },
      },
    },
  };

  protected chartData: ChartConfiguration<'bar'>['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        backgroundColor: [],
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 26,
      },
    ],
  };

  async ngOnInit(): Promise<void> {
    void this.sync.maybeAutoSync().then(async (res) => {
      if (res) await this.refresh();
    });
    await this.refresh();
  }

  protected selectProgram(p: ProductCode): void {
    this.program.set(p);
    this.rebuildChart();
  }

  protected onStateSelect(state: string): void {
    void this.router.navigate(['/regulatory'], {
      queryParams: { state, program: this.program() },
    });
  }

  protected actionPill(action: PricingAction): string {
    return PRICING_ACTIONS[action].pill;
  }

  protected actionLabel(action: PricingAction): string {
    return PRICING_ACTIONS[action].label;
  }

  protected actionColor(action: PricingAction): string {
    return PRICING_ACTIONS[action].color;
  }

  /** Share of the selected program's signals in a given action (KPI bar). */
  protected actionShare(action: PricingAction): number {
    return this.programSignals().filter((s) => s.pricing_action === action).length;
  }

  protected avgTaxLabel(): string {
    const v = this.avgTaxBurden();
    return v === null ? '—' : `${v.toFixed(1)}%`;
  }

  protected totalLabel(): string {
    const t = this.totalSignals();
    if (t === 0) return 'No pricing signals yet.';
    if (t === 1) return 'One pricing signal live.';
    return `${t} state pricing signals live.`;
  }

  protected syncMeta(): string {
    const last = this.appConfig.lastSyncedAt();
    if (!last) return 'never synced';
    return `last synced ${this.relative(last)}`;
  }

  protected relative(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  protected signalCount(programId: string): number {
    let n = 0;
    for (const s of this.signals()) if (s.program?.id === programId) n++;
    return n;
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [items, programs, signals] = await Promise.all([
        this.data.listItems(),
        this.data.listPrograms(),
        this.data.listSignals(),
      ]);
      this.items.set(items);
      this.programs.set(programs);
      this.signals.set(signals);
      this.rebuildChart();
    } finally {
      this.loading.set(false);
    }
  }

  /** Pricing-action distribution (states per action) for the selected program. */
  private rebuildChart(): void {
    const counts = this.actions.map(
      (a) => this.programSignals().filter((s) => s.pricing_action === a).length
    );
    this.chartData = {
      ...this.chartData,
      labels: this.actions.map((a) => PRICING_ACTIONS[a].label),
      datasets: [
        {
          ...this.chartData.datasets[0],
          data: counts,
          backgroundColor: this.actions.map((a) => PRICING_ACTIONS[a].color),
        },
      ],
    };
  }
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
