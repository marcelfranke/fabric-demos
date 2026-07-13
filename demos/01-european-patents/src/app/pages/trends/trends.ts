import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';

import {
  type Granularity,
  type SchemeFact,
  type TrendFact,
  type TrendsData,
  TrendsService,
  bucketOf,
} from '../../services/trends.service';
import { PALETTE, chartInk, sectionColor } from '../../brand';

type Basis = 'publication' | 'filing';
type Dimension = 'section' | 'appCountry' | 'pubCountry' | 'scheme';
type SchemePick = 'all' | 'IPC' | 'CPC';

const IPC_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const IPC_SECTION_LABELS: Record<string, string> = {
  A: 'Human necessities',
  B: 'Operations & transport',
  C: 'Chemistry & metallurgy',
  D: 'Textiles & paper',
  E: 'Fixed constructions',
  F: 'Mechanical & heating',
  G: 'Physics',
  H: 'Electricity',
};

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const TOP_N = 12;
const SPEEDS = [0.5, 1, 2, 4] as const;

interface Series {
  buckets: string[];
  categories: string[];
  colors: string[];
  /** perBucket[b][c] = count for bucket b, category c. */
  perBucket: number[][];
  /** cumulative[b][c] = running sum through bucket b. */
  cumulative: number[][];
}

@Component({
  selector: 'app-trends',
  imports: [BaseChartDirective, MatIconModule, MatTooltipModule],
  template: `
    <div class="trends page-enter">
      <header class="hero">
        <p class="eyebrow">Applications over time</p>
        <h1 class="hero__title">
          The register,<br /><em>in motion.</em>
        </h1>
        <p class="hero__lead">
          Watch European patent
          {{ basis() === 'filing' ? 'applications' : 'publications' }}
          accumulate across {{ dimLabel().toLowerCase() }}. Press play to animate
          the timeline, or scrub to any point.
        </p>
      </header>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 30rem"></div>
      } @else if (error()) {
        <div class="panel panel--error">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
        </div>
      } @else {
        <!-- ── Controls ─────────────────────────────────────────── -->
        <section class="controls">
          <div class="ctrl">
            <span class="ctrl__label">Date basis</span>
            <div class="seg">
              <button
                type="button"
                class="seg__btn"
                [class.active]="basis() === 'filing'"
                (click)="setBasis('filing')"
              >
                Filing
              </button>
              <button
                type="button"
                class="seg__btn"
                [class.active]="basis() === 'publication'"
                (click)="setBasis('publication')"
              >
                Publication
              </button>
            </div>
          </div>

          <div class="ctrl">
            <span class="ctrl__label">Granularity</span>
            <div class="seg">
              @for (g of granularities; track g.key) {
                <button
                  type="button"
                  class="seg__btn"
                  [class.active]="granularity() === g.key"
                  (click)="setGranularity(g.key)"
                >
                  {{ g.label }}
                </button>
              }
            </div>
          </div>

          <div class="ctrl">
            <span class="ctrl__label">Break down by</span>
            <div class="seg">
              @for (d of dimensions; track d.key) {
                <button
                  type="button"
                  class="seg__btn"
                  [class.active]="dimension() === d.key"
                  (click)="setDimension(d.key)"
                >
                  {{ d.label }}
                </button>
              }
            </div>
          </div>

          @if (dimension() === 'scheme') {
            <div class="ctrl">
              <span class="ctrl__label">Scheme</span>
              <div class="seg">
                <button
                  type="button"
                  class="seg__btn"
                  [class.active]="schemePick() === 'all'"
                  (click)="setScheme('all')"
                >
                  IPC + CPC
                </button>
                <button
                  type="button"
                  class="seg__btn"
                  [class.active]="schemePick() === 'IPC'"
                  (click)="setScheme('IPC')"
                >
                  IPC
                </button>
                <button
                  type="button"
                  class="seg__btn"
                  [class.active]="schemePick() === 'CPC'"
                  (click)="setScheme('CPC')"
                >
                  CPC
                </button>
              </div>
            </div>
          }

          <div class="ctrl">
            <span class="ctrl__label">Mode</span>
            <div class="seg">
              <button
                type="button"
                class="seg__btn"
                [class.active]="cumulative()"
                (click)="cumulative.set(true)"
              >
                Cumulative
              </button>
              <button
                type="button"
                class="seg__btn"
                [class.active]="!cumulative()"
                (click)="cumulative.set(false)"
              >
                Per period
              </button>
            </div>
          </div>
        </section>

        <!-- ── Filters ──────────────────────────────────────────── -->
        <section class="filters">
          <div class="filter">
            <span class="ctrl__label">IPC section</span>
            <div class="chips">
              @for (s of ipcSections; track s) {
                <button
                  type="button"
                  class="chip"
                  [class.chip--on]="selSections().has(s)"
                  [style.--chip]="sectionColor(s)"
                  (click)="toggleSection(s)"
                  [matTooltip]="sectionLabels[s]"
                >
                  {{ s }}
                </button>
              }
              @if (selSections().size) {
                <button type="button" class="chip chip--clear" (click)="clearSections()">
                  Clear
                </button>
              }
            </div>
          </div>

          @if (dimension() !== 'scheme' && topCountries().length) {
            <div class="filter">
              <span class="ctrl__label">Applicant country</span>
              <div class="chips">
                @for (c of topCountries(); track c) {
                  <button
                    type="button"
                    class="chip"
                    [class.chip--on]="selCountries().has(c)"
                    (click)="toggleCountry(c)"
                  >
                    {{ c }}
                  </button>
                }
                @if (selCountries().size) {
                  <button type="button" class="chip chip--clear" (click)="clearCountries()">
                    Clear
                  </button>
                }
              </div>
            </div>
          }

          @if (monthPeriods().length > 1) {
            <div class="filter filter--range">
              <span class="ctrl__label">
                Date range
                <span class="range__val mono">
                  {{ monthPeriods()[fromIdx()] }} → {{ monthPeriods()[toIdx()] }}
                </span>
              </span>
              <div class="range">
                <input
                  type="range"
                  min="0"
                  [max]="monthPeriods().length - 1"
                  [value]="fromIdx()"
                  (input)="setFrom($event)"
                  aria-label="Range start"
                />
                <input
                  type="range"
                  min="0"
                  [max]="monthPeriods().length - 1"
                  [value]="toIdx()"
                  (input)="setTo($event)"
                  aria-label="Range end"
                />
              </div>
            </div>
          }
        </section>

        <!-- ── Chart + transport ────────────────────────────────── -->
        <section class="panel panel--chart">
          <header class="panel__head">
            <div>
              <h3 class="panel__title">{{ dimLabel() }}</h3>
              <span class="eyebrow">
                {{ totalAtFrame().toLocaleString() }}
                {{ basis() === 'filing' ? 'applications' : 'publications' }}
                {{ cumulative() ? 'through' : 'in' }}
                {{ currentBucket() }}
              </span>
            </div>
            <span class="frame-badge mono">{{ currentBucket() }}</span>
          </header>

          @if (series().buckets.length === 0) {
            <p class="panel__empty">No data matches the current filters.</p>
          } @else {
            <div class="chart-wrap" [style.height.px]="chartHeight()">
              <canvas
                baseChart
                [data]="chartData"
                [options]="chartOptions"
                type="bar"
              ></canvas>
            </div>

            <div class="transport">
              <button
                type="button"
                class="play"
                (click)="togglePlay()"
                [attr.aria-label]="playing() ? 'Pause' : 'Play'"
              >
                <mat-icon>{{ playing() ? 'pause' : 'play_arrow' }}</mat-icon>
              </button>
              <input
                type="range"
                class="scrub"
                min="0"
                [max]="maxFrame()"
                [value]="frame()"
                (input)="onScrub($event)"
                aria-label="Timeline position"
              />
              <div class="speed">
                @for (s of speeds; track s) {
                  <button
                    type="button"
                    class="speed__btn"
                    [class.active]="speed() === s"
                    (click)="speed.set(s)"
                  >
                    {{ s }}×
                  </button>
                }
              </div>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    :host { display: block; }

    .trends {
      display: flex;
      flex-direction: column;
      gap: clamp(1.5rem, 3vw, 2.5rem);
    }

    .hero { display: flex; flex-direction: column; gap: 0.75rem; max-width: 48rem; }

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
      color: var(--accent);
    }

    .hero__lead { color: var(--cream-muted); font-size: var(--text-body); max-width: 40rem; }

    .controls, .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem 1.5rem;
      padding: 1.25rem 1.5rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
    }

    .ctrl, .filter { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
    .filter--range { flex: 1; min-width: 16rem; }

    .ctrl__label {
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

    .range__val { text-transform: none; letter-spacing: 0; color: var(--cream-muted); }

    .seg {
      display: inline-flex;
      background: var(--ink-elevated);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-pill);
      padding: 2px;
      gap: 2px;
    }

    .seg__btn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--cream-muted);
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      padding: 0.4rem 0.75rem;
      border-radius: var(--radius-pill);
      cursor: pointer;
      white-space: nowrap;
      transition: color var(--d-1) var(--ease-out), background var(--d-1) var(--ease-out);
    }

    .seg__btn:hover { color: var(--cream); }
    .seg__btn.active { color: var(--lime-on); background: var(--lime); }

    .chips { display: flex; flex-wrap: wrap; gap: 0.375rem; }

    .chip {
      --chip: var(--cream-dim);
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 2rem;
      justify-content: center;
      padding: 0.35rem 0.6rem;
      background: var(--ink-elevated);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-pill);
      color: var(--cream-muted);
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out), background var(--d-1) var(--ease-out);
    }

    .chip:hover { color: var(--cream); border-color: var(--accent-border); }

    .chip--on {
      color: var(--cream);
      border-color: var(--chip);
      box-shadow: inset 0 0 0 1px var(--chip);
    }

    .chip--on::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--chip);
    }

    .chip--clear { color: var(--cream-dim); font-style: italic; }

    .range { display: flex; flex-direction: column; gap: 0.25rem; }

    input[type='range'] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--ink-border);
      cursor: pointer;
    }

    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--ink-bg);
      box-shadow: 0 0 0 1px var(--accent-border);
    }

    input[type='range']::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--ink-bg);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 1.5rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      min-width: 0;
    }

    .panel--error {
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
      color: var(--cream-muted);
    }

    .panel__empty { color: var(--cream-dim); padding: 2rem 0; text-align: center; }

    .panel__head {
      display: flex;
      align-items: flex-start;
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
      margin: 0 0 0.25rem;
    }

    .frame-badge {
      font-size: 1.25rem;
      color: var(--accent);
      background: var(--ink-elevated);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.75rem;
    }

    .chart-wrap { position: relative; min-width: 0; transition: height var(--d-3) var(--ease-out); }
    .chart-wrap canvas { display: block; max-width: 100%; }

    .transport {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .play {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      flex-shrink: 0;
      background: var(--lime);
      color: var(--lime-on);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 6px 16px -4px var(--accent-glow);
      transition: transform var(--d-1) var(--ease-out);
    }

    .play:hover { transform: scale(1.05); }
    .play mat-icon { font-size: 24px; width: 24px; height: 24px; }

    .scrub { flex: 1; min-width: 10rem; }

    .speed { display: inline-flex; gap: 2px; }

    .speed__btn {
      appearance: none;
      border: 1px solid var(--ink-border);
      background: var(--ink-elevated);
      color: var(--cream-muted);
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      padding: 0.3rem 0.5rem;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }

    .speed__btn.active { color: var(--lime-on); background: var(--lime); border-color: var(--lime); }

    @media (max-width: 40rem) {
      .controls, .filters { padding: 1rem; gap: 1rem; }
    }
  `,
})
export class Trends implements OnInit, OnDestroy {
  private readonly trends = inject(TrendsService);

  @ViewChild(BaseChartDirective) private chart?: BaseChartDirective;

  protected readonly ipcSections = IPC_SECTIONS;
  protected readonly sectionLabels = IPC_SECTION_LABELS;
  protected readonly speeds = SPEEDS;
  protected readonly granularities = GRANULARITIES;
  protected readonly sectionColor = sectionColor;
  protected readonly dimensions: { key: Dimension; label: string }[] = [
    { key: 'section', label: 'IPC section' },
    { key: 'appCountry', label: 'Applicant country' },
    { key: 'pubCountry', label: 'Pub. country' },
    { key: 'scheme', label: 'Scheme sections' },
  ];

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly data = signal<TrendsData | null>(null);

  protected readonly basis = signal<Basis>('filing');
  protected readonly granularity = signal<Granularity>('quarter');
  protected readonly dimension = signal<Dimension>('section');
  protected readonly schemePick = signal<SchemePick>('all');
  protected readonly selSections = signal<Set<string>>(new Set());
  protected readonly selCountries = signal<Set<string>>(new Set());
  protected readonly cumulative = signal(true);
  protected readonly fromIdx = signal(0);
  protected readonly toIdx = signal(0);
  protected readonly frame = signal(0);
  protected readonly playing = signal(false);
  protected readonly speed = signal<number>(1);

  private timer: ReturnType<typeof setInterval> | null = null;

  /** All month periods present for the current basis, sorted ascending. */
  protected readonly monthPeriods = computed(() => {
    const d = this.data();
    if (!d) return [] as string[];
    const facts = d[this.basis()].facts;
    return [...new Set(facts.map((f) => f.period))].sort();
  });

  /** Top applicant countries (by count) for the current basis — filter chips. */
  protected readonly topCountries = computed(() => {
    const d = this.data();
    if (!d) return [] as string[];
    const totals = new Map<string, number>();
    for (const f of d[this.basis()].facts) {
      if (!f.appCountry) continue;
      totals.set(f.appCountry, (totals.get(f.appCountry) ?? 0) + f.count);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([c]) => c);
  });

  /** The animated series: buckets × categories with per-bucket and cumulative counts. */
  protected readonly series = computed<Series>(() => {
    const d = this.data();
    if (!d)
      return { buckets: [], categories: [], colors: [], perBucket: [], cumulative: [] };

    const dim = this.dimension();
    const gran = this.granularity();
    const months = this.monthPeriods();
    const lo = months[this.fromIdx()] ?? months[0] ?? '';
    const hi = months[this.toIdx()] ?? months[months.length - 1] ?? '';
    const sel = this.selSections();
    const cty = this.selCountries();

    const useScheme = dim === 'scheme';
    const scheme = this.schemePick();

    const rows: {
      period: string;
      category: string | null;
      section: string | null;
      appCountry: string | null;
      count: number;
    }[] = useScheme
      ? (d[this.basis()].scheme as SchemeFact[])
          .filter((f) => scheme === 'all' || f.scheme === scheme)
          .map((f) => ({
            period: f.period,
            category: f.section,
            section: f.section,
            appCountry: null,
            count: f.count,
          }))
      : (d[this.basis()].facts as TrendFact[]).map((f) => ({
          period: f.period,
          category:
            dim === 'section'
              ? f.section
              : dim === 'appCountry'
                ? f.appCountry
                : f.pubCountry,
          section: f.section,
          appCountry: f.appCountry,
          count: f.count,
        }));

    const byBucket = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();

    for (const r of rows) {
      if (r.period < lo || r.period > hi) continue;
      if (sel.size && (!r.section || !sel.has(r.section))) continue;
      if (!useScheme && cty.size && (!r.appCountry || !cty.has(r.appCountry))) continue;
      const cat = r.category || '—';
      const bucket = bucketOf(r.period, gran);
      let m = byBucket.get(bucket);
      if (!m) byBucket.set(bucket, (m = new Map()));
      m.set(cat, (m.get(cat) ?? 0) + r.count);
      totals.set(cat, (totals.get(cat) ?? 0) + r.count);
    }

    const buckets = [...byBucket.keys()].sort();
    const categories = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([c]) => c);

    const colors = categories.map((cat, i) =>
      dim === 'section' || dim === 'scheme'
        ? sectionColor(cat)
        : PALETTE[i % PALETTE.length]
    );

    const perBucket = buckets.map((b) => {
      const m = byBucket.get(b)!;
      return categories.map((c) => m.get(c) ?? 0);
    });
    const cumulative: number[][] = [];
    const running = categories.map(() => 0);
    for (const row of perBucket) {
      for (let i = 0; i < running.length; i++) running[i] += row[i];
      cumulative.push([...running]);
    }

    return { buckets, categories, colors, perBucket, cumulative };
  });

  protected readonly maxFrame = computed(() =>
    Math.max(0, this.series().buckets.length - 1)
  );

  protected readonly currentBucket = computed(
    () => this.series().buckets[this.frame()] ?? '—'
  );

  protected readonly dimLabel = computed(() => {
    switch (this.dimension()) {
      case 'section':
        return 'By IPC section';
      case 'appCountry':
        return 'By applicant country';
      case 'pubCountry':
        return 'By publication country';
      case 'scheme':
        return `By ${this.schemePick() === 'all' ? 'IPC + CPC' : this.schemePick()} section`;
    }
  });

  protected readonly chartHeight = computed(() =>
    Math.max(240, this.series().categories.length * 34 + 40)
  );

  protected readonly totalAtFrame = computed(() => {
    const s = this.series();
    const row = (this.cumulative() ? s.cumulative : s.perBucket)[this.frame()];
    return row ? row.reduce((a, b) => a + b, 0) : 0;
  });

  protected chartData: ChartConfiguration<'bar'>['data'] = {
    labels: [],
    datasets: [{ data: [], backgroundColor: [], borderRadius: 4, borderSkipped: false }],
  };

  protected chartOptions: ChartConfiguration<'bar'>['options'] = buildRaceOptions();

  constructor() {
    // Keep the frame in range whenever the series changes, and repaint.
    effect(() => {
      const max = this.maxFrame();
      if (this.frame() > max) this.frame.set(max);
      this.renderFrame();
    });

    // Restart the timer when speed changes mid-play.
    effect(() => {
      this.speed();
      if (this.playing()) this.startTimer();
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const d = await this.trends.load();
      this.data.set(d);
      const months = this.monthPeriods();
      this.fromIdx.set(0);
      this.toIdx.set(Math.max(0, months.length - 1));
      // Start showing the full picture at the last bucket.
      queueMicrotask(() => this.frame.set(this.maxFrame()));
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not load trends data.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  // ── Controls ─────────────────────────────────────────────────────────
  protected setBasis(b: Basis): void {
    this.basis.set(b);
    const months = this.monthPeriods();
    this.fromIdx.set(0);
    this.toIdx.set(Math.max(0, months.length - 1));
  }
  protected setGranularity(g: Granularity): void {
    this.granularity.set(g);
  }
  protected setDimension(d: Dimension): void {
    this.dimension.set(d);
  }
  protected setScheme(s: SchemePick): void {
    this.schemePick.set(s);
  }

  protected toggleSection(s: string): void {
    this.selSections.update((set) => {
      const next = new Set(set);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  protected clearSections(): void {
    this.selSections.set(new Set());
  }
  protected toggleCountry(c: string): void {
    this.selCountries.update((set) => {
      const next = new Set(set);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  protected clearCountries(): void {
    this.selCountries.set(new Set());
  }

  protected setFrom(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.fromIdx.set(Math.min(v, this.toIdx()));
  }
  protected setTo(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.toIdx.set(Math.max(v, this.fromIdx()));
  }

  // ── Transport ────────────────────────────────────────────────────────
  protected togglePlay(): void {
    if (this.playing()) {
      this.pause();
      return;
    }
    if (this.frame() >= this.maxFrame()) this.frame.set(0);
    this.playing.set(true);
    this.startTimer();
  }

  protected onScrub(e: Event): void {
    this.pause();
    this.frame.set(Number((e.target as HTMLInputElement).value));
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.frame() >= this.maxFrame()) {
        this.pause();
        return;
      }
      this.frame.update((f) => f + 1);
    }, 750 / this.speed());
  }

  private pause(): void {
    this.playing.set(false);
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private renderFrame(): void {
    const s = this.series();
    const rows = (this.cumulative() ? s.cumulative : s.perBucket)[this.frame()] ?? [];
    // Sort categories by current value for the bar-race effect.
    const order = s.categories
      .map((cat, i) => ({ cat, value: rows[i] ?? 0, color: s.colors[i] }))
      .sort((a, b) => b.value - a.value);

    this.chartData = {
      labels: order.map((o) => o.cat),
      datasets: [
        {
          data: order.map((o) => o.value),
          backgroundColor: order.map((o) => o.color),
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
    this.chart?.update();
  }
}

function buildRaceOptions(): ChartConfiguration<'bar'>['options'] {
  const ink = chartInk();
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500, easing: 'easeOutCubic' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: ink.surface,
        borderColor: ink.border,
        borderWidth: 1,
        titleColor: ink.title,
        bodyColor: ink.body,
        titleFont: { family: ink.mono, size: 11 },
        bodyFont: { family: ink.mono, size: 11 },
        padding: 10,
        displayColors: false,
        callbacks: {
          title: (items) => {
            const s = items[0]?.label ?? '';
            return IPC_SECTION_LABELS[s] ? `${s} — ${IPC_SECTION_LABELS[s]}` : s;
          },
          label: (item) => `${Number(item.raw).toLocaleString()} patents`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: ink.grid },
        ticks: { precision: 0, color: ink.body, font: { family: ink.mono, size: 10 } },
        border: { color: ink.border },
      },
      y: {
        grid: { display: false },
        ticks: { color: ink.title, font: { family: ink.mono, size: 12 } },
        border: { color: ink.border },
      },
    },
  };
}
