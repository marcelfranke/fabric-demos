import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';

import type { Patent } from '../../../../rayfin/data/schema';
import {
  type ApplicantLeader,
  type DataStats,
  DataService,
} from '../../services/data.service';
import { chartInk, sectionColor } from '../../brand';

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

@Component({
  selector: 'app-dashboard',
  imports: [BaseChartDirective, MatIconModule, RouterLink],
  template: `
    <div class="dashboard page-enter">
      <header class="hero">
        <p class="eyebrow">Overview</p>
        <h1 class="hero__title">
          {{ greeting }}.<br />
          <em>{{ totalLabel() }}</em>
        </h1>
        <p class="hero__lead">
          A snapshot of European patent publications, applicants and
          inventors in this workspace.
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
        <section class="kpis">
          <article class="kpi kpi--feature">
            <span class="kpi__label">Patents</span>
            <div class="kpi__value">
              <span class="kpi__num">{{ totalPatents().toLocaleString() }}</span>
              <span class="kpi__suffix">publications</span>
            </div>
            <div class="kpi__bar">
              @for (s of sectionBars(); track s.section) {
                <span
                  class="kpi__bar-seg"
                  [style.flexGrow]="s.count"
                  [style.background]="s.color"
                ></span>
              }
            </div>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--open"></span>
              Applicants
            </span>
            <span class="kpi__num">{{ distinctApplicants() }}</span>
            <span class="kpi__delta">distinct organisations</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--in_progress"></span>
              Inventors
            </span>
            <span class="kpi__num">{{ distinctInventors() }}</span>
            <span class="kpi__delta">distinct people</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--closed"></span>
              Avg inventors
            </span>
            <span class="kpi__num">{{ avgInventors() }}</span>
            <span class="kpi__delta">per patent</span>
          </article>
        </section>

        <section class="split">
          <article class="panel panel--chart">
            <header class="panel__head">
              <h3 class="panel__title">Patents by IPC section</h3>
              <span class="eyebrow">{{ totalPatents().toLocaleString() }} publications</span>
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
              <h3 class="panel__title">Recent publications</h3>
              <a class="panel__link" routerLink="/patents">
                View all
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            @if (recent().length === 0) {
              <p class="panel__empty">
                No patents yet — they'll appear here.
              </p>
            } @else {
              <ol class="feed">
                @for (p of recent(); track p.id) {
                  <li class="feed__item">
                    <span class="feed__num mono">{{ p.patent_number }}</span>
                    <a class="feed__title" [routerLink]="['/patents', p.id]">
                      {{ p.title_en || '(untitled)' }}
                    </a>
                    <span class="feed__meta">
                      @if (p.ipc_section) {
                        <span class="pill pill--lime">{{ p.ipc_section }}</span>
                      }
                      @if (p.publication_date) {
                        <span class="feed__time">
                          {{ formatDate(p.publication_date) }}
                        </span>
                      }
                    </span>
                  </li>
                }
              </ol>
            }
          </article>
        </section>

        @if (topApplicants().length > 0) {
          <section class="strip">
            <header class="strip__head">
              <h3 class="panel__title">Top applicants</h3>
              <a class="panel__link" routerLink="/applicants">
                Full leaderboard
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            <div class="strip__grid">
              @for (a of topApplicants(); track a.name) {
                <a class="proj-card" routerLink="/applicants">
                  <span class="eyebrow">
                    {{ a.patents }}
                    {{ a.patents === 1 ? 'patent' : 'patents' }}
                  </span>
                  <h4 class="proj-card__title">{{ a.name }}</h4>
                  @if (a.country) {
                    <p class="proj-card__desc mono">{{ a.country }}</p>
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
      gap: 2px;
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

    .feed__num {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.04em;
      color: var(--cream-dim);
    }

    .feed__title {
      font-size: var(--text-body);
      color: var(--cream);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
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
      white-space: nowrap;
    }

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
  `,
})
export class Dashboard implements OnInit {
  private readonly data = inject(DataService);

  protected readonly patents = signal<Patent[]>([]);
  protected readonly stats = signal<DataStats | null>(null);
  protected readonly leaders = signal<ApplicantLeader[]>([]);
  protected readonly loading = signal(true);
  protected readonly greeting = greet();

  protected readonly totalPatents = computed(
    () => this.stats()?.totalPatents ?? 0
  );

  protected readonly distinctApplicants = computed(
    () => this.stats()?.distinctApplicants ?? 0
  );

  protected readonly distinctInventors = computed(
    () => this.stats()?.distinctInventors ?? 0
  );

  protected readonly avgInventors = computed(() =>
    (this.stats()?.avgInventors ?? 0).toFixed(1)
  );

  protected readonly recent = computed(() =>
    [...this.patents()]
      .sort(
        (a, b) =>
          (b.publication_date ? new Date(b.publication_date).getTime() : 0) -
          (a.publication_date ? new Date(a.publication_date).getTime() : 0)
      )
      .slice(0, 6)
  );

  protected readonly sectionBars = computed(() => {
    const counts = this.sectionCounts();
    return IPC_SECTIONS.map((section, i) => ({
      section,
      count: counts[i],
      color: sectionColor(section),
    })).filter((s) => s.count > 0);
  });

  protected readonly topApplicants = computed(() =>
    this.leaders().slice(0, 4)
  );

  protected chartOptions: ChartConfiguration<'bar'>['options'] = buildBarOptions();

  protected chartData: ChartConfiguration<'bar'>['data'] = {
    labels: [...IPC_SECTIONS],
    datasets: [
      {
        data: IPC_SECTIONS.map(() => 0),
        backgroundColor: IPC_SECTIONS.map((s) => sectionColor(s)),
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 22,
      },
    ],
  };

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  protected totalLabel(): string {
    const t = this.totalPatents();
    if (t === 0) return 'Nothing on the register yet.';
    if (t === 1) return 'One publication on file.';
    return `${t.toLocaleString()} publications on file.`;
  }

  protected formatDate(d: Date | string | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private sectionCounts(): number[] {
    const counts = this.stats()?.sectionCounts ?? {};
    return IPC_SECTIONS.map((s) => counts[s] ?? 0);
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [patents, stats, leaders] = await Promise.all([
        this.data.listPatents(),
        this.data.getStats(),
        this.data.applicantLeaderboard(50),
      ]);
      this.patents.set(patents);
      this.stats.set(stats);
      this.leaders.set(leaders);
      this.chartData = {
        ...this.chartData,
        datasets: [
          {
            ...this.chartData.datasets[0],
            data: this.sectionCounts(),
          },
        ],
      };
    } finally {
      this.loading.set(false);
    }
  }
}

function buildBarOptions(): ChartConfiguration<'bar'>['options'] {
  const ink = chartInk();
  return {
    responsive: true,
    maintainAspectRatio: false,
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
            return `${s} — ${IPC_SECTION_LABELS[s] ?? ''}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: ink.grid },
        ticks: { color: ink.body, font: { family: ink.mono, size: 10 } },
        border: { color: ink.border },
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
          color: ink.body,
          font: { family: ink.mono, size: 10 },
        },
        grid: { color: ink.grid },
        border: { color: ink.border },
      },
    },
  };
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
