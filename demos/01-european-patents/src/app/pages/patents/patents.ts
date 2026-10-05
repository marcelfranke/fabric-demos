import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type {
  ApplicationRow,
  KpiSummary,
  TopApplicantRow,
  TopInventorRow,
} from '../../../../rayfin/functions/src/types';
import { PatentsDataService } from '../../services/patents-data.service';

const PAGE_SIZE = 25;
const TOP_LIMIT = 10;

@Component({
  selector: 'app-patents',
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="patents page-enter">
      <header class="hero">
        <p class="eyebrow">Live · European Patents lakehouse</p>
        <h1 class="hero__title">
          Patent applications,<br />
          <em>straight from the gold layer.</em>
        </h1>
        <p class="hero__lead">
          Every number on this page is queried on demand from the
          <span class="mono">eps_lakehouse</span> SQL analytics endpoint — no
          rows are copied into the app store.
        </p>
      </header>

      @if (error()) {
        <section class="banner banner--error" role="alert">
          <mat-icon>error_outline</mat-icon>
          <div>
            <strong>Couldn't reach the lakehouse.</strong>
            <span class="banner__detail">{{ error() }}</span>
          </div>
          <button type="button" class="ghost-btn" (click)="reload()">
            <mat-icon>refresh</mat-icon>
          </button>
        </section>
      }

      <!-- ── KPI tiles ─────────────────────────────────────────── -->
      <section class="kpis">
        @if (kpiLoading()) {
          <div class="skeleton skeleton--card kpi--feature"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
        } @else if (kpi(); as k) {
          <article class="kpi kpi--feature">
            <span class="kpi__label">Total applications</span>
            <div class="kpi__value">
              <span class="kpi__num">{{ fmt(k.totalApplications) }}</span>
            </div>
          </article>
          <article class="kpi">
            <span class="kpi__label">Granted</span>
            <span class="kpi__num">{{ fmt(k.granted) }}</span>
          </article>
          <article class="kpi">
            <span class="kpi__label">Grant rate</span>
            <span class="kpi__num">{{ k.grantRatePct }}%</span>
          </article>
          <article class="kpi">
            <span class="kpi__label">Publications</span>
            <span class="kpi__num">{{ fmt(k.totalPublications) }}</span>
          </article>
        }
      </section>

      <section class="split">
        <!-- ── Applications table ──────────────────────────────── -->
        <div class="panel">
          <div class="panel__head">
            <h2 class="panel__title">Applications</h2>
            <form class="filters" (submit)="applyFilters($event)">
              <input
                class="field"
                type="text"
                name="country"
                placeholder="Country (e.g. DE)"
                [value]="country()"
                (input)="country.set(asValue($event))"
                aria-label="Filter by country code"
              />
              <input
                class="field"
                type="text"
                name="techArea"
                placeholder="Tech area"
                [value]="techArea()"
                (input)="techArea.set(asValue($event))"
                aria-label="Filter by technology area"
              />
              <select
                class="field"
                name="granted"
                [value]="grantedFilter()"
                (change)="grantedFilter.set(asValue($event))"
                aria-label="Filter by grant status"
              >
                <option value="">All statuses</option>
                <option value="true">Granted</option>
                <option value="false">Pending</option>
              </select>
              <button type="submit" class="btn">Apply</button>
            </form>
          </div>

          @if (listLoading()) {
            <div class="panel__loading">
              <mat-spinner diameter="28" />
            </div>
          } @else {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Title</th>
                    <th>Country</th>
                    <th>Tech area</th>
                    <th class="num">Pubs</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.applicationNumber) {
                    <tr>
                      <td class="mono">{{ row.applicationNumber }}</td>
                      <td class="cell-title">{{ row.title || '—' }}</td>
                      <td>{{ row.countryName || row.countryCode || '—' }}</td>
                      <td>{{ row.techArea || '—' }}</td>
                      <td class="num">{{ row.publicationCount }}</td>
                      <td>
                        <span
                          class="pill"
                          [class.pill--granted]="row.granted"
                        >
                          {{ row.granted ? 'Granted' : 'Pending' }}
                        </span>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="empty">No applications match.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="pager">
              <span class="pager__info">
                {{ rangeLabel() }} of {{ fmt(total()) }}
              </span>
              <div class="pager__controls">
                <button
                  type="button"
                  class="ghost-btn"
                  [disabled]="page() <= 1"
                  (click)="prevPage()"
                  aria-label="Previous page"
                >
                  <mat-icon>chevron_left</mat-icon>
                </button>
                <span class="pager__page">Page {{ page() }} / {{ pageCount() }}</span>
                <button
                  type="button"
                  class="ghost-btn"
                  [disabled]="page() >= pageCount()"
                  (click)="nextPage()"
                  aria-label="Next page"
                >
                  <mat-icon>chevron_right</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>

        <!-- ── Top applicants / inventors ──────────────────────── -->
        <div class="rankings">
          <div class="panel">
            <div class="panel__head">
              <h2 class="panel__title">Top applicants</h2>
            </div>
            @if (topLoading()) {
              <div class="panel__loading"><mat-spinner diameter="24" /></div>
            } @else {
              <ol class="ranklist">
                @for (a of topApplicants(); track a.applicant; let i = $index) {
                  <li class="ranklist__item">
                    <span class="ranklist__rank">{{ i + 1 }}</span>
                    <span class="ranklist__name">{{ a.applicant }}</span>
                    <span class="ranklist__count">{{ fmt(a.applicationCount) }}</span>
                  </li>
                } @empty {
                  <li class="empty">No data.</li>
                }
              </ol>
            }
          </div>

          <div class="panel">
            <div class="panel__head">
              <h2 class="panel__title">Top inventors</h2>
            </div>
            @if (topLoading()) {
              <div class="panel__loading"><mat-spinner diameter="24" /></div>
            } @else {
              <ol class="ranklist">
                @for (v of topInventors(); track v.inventor; let i = $index) {
                  <li class="ranklist__item">
                    <span class="ranklist__rank">{{ i + 1 }}</span>
                    <span class="ranklist__name">{{ v.inventor }}</span>
                    <span class="ranklist__count">{{ fmt(v.applicationCount) }}</span>
                  </li>
                } @empty {
                  <li class="empty">No data.</li>
                }
              </ol>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .hero {
      margin-bottom: 2.5rem;
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 40, 'wght' 460;
      font-size: clamp(1.8rem, 4vw, 2.9rem);
      line-height: 1.05;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0.5rem 0 0.75rem;
    }

    .hero__title em {
      font-style: italic;
      color: var(--accent);
    }

    .hero__lead {
      color: var(--cream-muted);
      max-width: 46rem;
      font-size: var(--text-body);
    }

    .mono {
      font-family: var(--font-mono);
      color: var(--cream);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 1.125rem;
      border-radius: var(--radius-md);
      margin-bottom: 1.75rem;
    }

    .banner--error {
      background: color-mix(in srgb, #b3261e 12%, var(--ink-elevated));
      border: 1px solid color-mix(in srgb, #b3261e 40%, transparent);
      color: var(--cream);
    }

    .banner__detail {
      display: block;
      color: var(--cream-muted);
      font-size: var(--text-caption);
      font-family: var(--font-mono);
    }

    .banner mat-icon {
      color: #f2b8b5;
    }

    .banner > div {
      flex: 1;
    }

    /* ── KPI grid ─────────────────────────────────────────────── */
    .kpis {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr 1fr;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .kpi {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 1.25rem 1.375rem;
      background: var(--ink-elevated);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-md);
    }

    .kpi--feature {
      background: linear-gradient(
          145deg,
          var(--accent-soft),
          transparent 70%
        ),
        var(--ink-elevated);
    }

    .kpi__label {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .kpi__num {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'wght' 520;
      font-size: 2rem;
      letter-spacing: -0.02em;
      color: var(--cream);
    }

    /* ── Split layout ─────────────────────────────────────────── */
    .split {
      display: grid;
      grid-template-columns: 1fr 20rem;
      gap: 1.25rem;
      align-items: start;
    }

    .panel {
      background: var(--ink-elevated);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .panel__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--ink-border-soft);
    }

    .panel__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 60, 'wght' 500;
      font-size: 1.15rem;
      letter-spacing: -0.01em;
      color: var(--cream);
      margin: 0;
    }

    .panel__loading {
      display: flex;
      justify-content: center;
      padding: 2.5rem;
    }

    /* ── Filters ──────────────────────────────────────────────── */
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .field {
      height: 2.25rem;
      padding: 0 0.75rem;
      background: var(--ink-bg);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
      color: var(--cream);
      font-family: var(--font-sans);
      font-size: var(--text-caption);
      min-width: 8rem;
    }

    .field:focus {
      outline: none;
      border-color: var(--accent-border);
    }

    .btn {
      height: 2.25rem;
      padding: 0 1rem;
      background: var(--accent);
      color: var(--lime-on, #14140f);
      border: none;
      border-radius: var(--radius-sm);
      font-weight: 600;
      font-size: var(--text-caption);
      cursor: pointer;
    }

    .btn:hover {
      filter: brightness(1.05);
    }

    /* ── Table ────────────────────────────────────────────────── */
    .table-wrap {
      overflow-x: auto;
    }

    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-caption);
    }

    .table th {
      text-align: left;
      padding: 0.625rem 1rem;
      font-family: var(--font-mono);
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--cream-dim);
      border-bottom: 1px solid var(--ink-border-soft);
      white-space: nowrap;
    }

    .table td {
      padding: 0.7rem 1rem;
      color: var(--cream-muted);
      border-bottom: 1px solid var(--ink-border-soft);
      vertical-align: top;
    }

    .table tbody tr:hover td {
      background: color-mix(in srgb, var(--accent) 5%, transparent);
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .cell-title {
      max-width: 22rem;
      color: var(--cream);
    }

    .pill {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: var(--radius-pill);
      font-family: var(--font-mono);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: var(--ink-border-soft);
      color: var(--cream-dim);
    }

    .pill--granted {
      background: var(--accent-soft);
      color: var(--accent);
    }

    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--cream-dim);
    }

    /* ── Pager ────────────────────────────────────────────────── */
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.25rem;
      border-top: 1px solid var(--ink-border-soft);
    }

    .pager__info,
    .pager__page {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--cream-dim);
    }

    .pager__controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    /* ── Rankings ─────────────────────────────────────────────── */
    .rankings {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .ranklist {
      list-style: none;
      margin: 0;
      padding: 0.5rem 0;
    }

    .ranklist__item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.55rem 1.25rem;
    }

    .ranklist__rank {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--cream-dim);
      width: 1.25rem;
      flex-shrink: 0;
    }

    .ranklist__name {
      flex: 1;
      color: var(--cream);
      font-size: var(--text-caption);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ranklist__count {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }

    .ghost-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      background: transparent;
      color: var(--cream-muted);
      border: 1px solid var(--ink-border-soft);
      border-radius: var(--radius-sm);
      cursor: pointer;
    }

    .ghost-btn:hover:not([disabled]) {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .ghost-btn[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .ghost-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .skeleton {
      background: linear-gradient(
        90deg,
        var(--ink-elevated),
        var(--ink-border-soft),
        var(--ink-elevated)
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
      border-radius: var(--radius-md);
    }

    .skeleton--card {
      height: 6rem;
    }

    @keyframes shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }

    @media (max-width: 68rem) {
      .split {
        grid-template-columns: 1fr;
      }

      .kpis {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 40rem) {
      .kpis {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Patents implements OnInit {
  private readonly data = inject(PatentsDataService);

  protected readonly kpi = signal<KpiSummary | null>(null);
  protected readonly kpiLoading = signal(true);

  protected readonly rows = signal<ApplicationRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly listLoading = signal(true);

  protected readonly topApplicants = signal<TopApplicantRow[]>([]);
  protected readonly topInventors = signal<TopInventorRow[]>([]);
  protected readonly topLoading = signal(true);

  protected readonly error = signal<string | null>(null);

  // Filter inputs (applied on submit, not on keystroke).
  protected readonly country = signal('');
  protected readonly techArea = signal('');
  protected readonly grantedFilter = signal('');

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE))
  );

  protected readonly rangeLabel = computed(() => {
    const t = this.total();
    if (t === 0) return '0';
    const start = (this.page() - 1) * PAGE_SIZE + 1;
    const end = Math.min(this.page() * PAGE_SIZE, t);
    return `${this.fmt(start)}–${this.fmt(end)}`;
  });

  ngOnInit(): void {
    void this.loadAll();
  }

  protected reload(): void {
    void this.loadAll();
  }

  protected fmt(n: number): string {
    return n.toLocaleString('en-US');
  }

  protected asValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected applyFilters(event: Event): void {
    event.preventDefault();
    this.page.set(1);
    void this.loadApplications();
  }

  protected prevPage(): void {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    void this.loadApplications();
  }

  protected nextPage(): void {
    if (this.page() >= this.pageCount()) return;
    this.page.update((p) => p + 1);
    void this.loadApplications();
  }

  private async loadAll(): Promise<void> {
    this.error.set(null);
    await Promise.all([
      this.loadKpis(),
      this.loadApplications(),
      this.loadTop(),
    ]);
  }

  private async loadKpis(): Promise<void> {
    this.kpiLoading.set(true);
    try {
      this.kpi.set(await this.data.kpiSummary());
    } catch (err) {
      this.error.set(this.msg(err));
    } finally {
      this.kpiLoading.set(false);
    }
  }

  private async loadApplications(): Promise<void> {
    this.listLoading.set(true);
    try {
      const granted =
        this.grantedFilter() === ''
          ? undefined
          : this.grantedFilter() === 'true';
      const result = await this.data.listApplications({
        page: this.page(),
        pageSize: PAGE_SIZE,
        country: this.country().trim() || undefined,
        techArea: this.techArea().trim() || undefined,
        granted,
      });
      this.rows.set(result.rows);
      this.total.set(result.total);
      this.page.set(result.page);
    } catch (err) {
      this.error.set(this.msg(err));
      this.rows.set([]);
      this.total.set(0);
    } finally {
      this.listLoading.set(false);
    }
  }

  private async loadTop(): Promise<void> {
    this.topLoading.set(true);
    try {
      const [applicants, inventors] = await Promise.all([
        this.data.topApplicants({ limit: TOP_LIMIT }),
        this.data.topInventors({ limit: TOP_LIMIT }),
      ]);
      this.topApplicants.set(applicants);
      this.topInventors.set(inventors);
    } catch (err) {
      this.error.set(this.msg(err));
    } finally {
      this.topLoading.set(false);
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
  }
}
