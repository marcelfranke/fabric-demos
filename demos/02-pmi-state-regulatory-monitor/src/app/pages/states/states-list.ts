import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { UsChoropleth } from '../../components/us-choropleth';
import { DataService } from '../../services/data.service';
import {
  PRICING_ACTIONS,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from '../../services/constants';

interface StateRow {
  code: string;
  name: string;
  signalCount: number;
  actions: PricingAction[];
  worst: PricingAction;
  tax: number | null;
  pending: boolean;
}

// Action precedence (worst → mildest) for the row summary swatch.
const SEVERITY: PricingAction[] = [
  'delist_banned',
  'restricted_assortment',
  'watch_pending',
  'adjust_for_tax',
  'price_freely',
];

@Component({
  selector: 'app-states-list',
  imports: [FormsModule, MatIconModule, UsChoropleth],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Regulatory desk</p>
        <h1 class="title">States</h1>
        <p class="lead">
          Every monitored US state — click the map or a row to open its excise
          tax, regulatory rules, per-program pricing action and revenue at risk.
        </p>
      </header>

      <section class="panel">
        <div class="panel__head">
          <h2 class="panel__title">Pricing action map</h2>
          <div class="prog-switch">
            @for (p of programOptions; track p) {
              <button
                type="button"
                class="prog-switch__btn"
                [class.prog-switch__btn--active]="program() === p"
                (click)="program.set(p)"
              >
                {{ p }}
              </button>
            }
          </div>
        </div>
        <app-us-choropleth
          [actionByState]="actionByState()"
          (stateSelect)="open($event)"
        />
      </section>

      <div class="filters">
        <label class="field field--search">
          <mat-icon>search</mat-icon>
          <input
            type="text"
            placeholder="Search state…"
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
          />
        </label>
      </div>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 18rem"></div>
      } @else {
        <ul class="rows">
          @for (r of rows(); track r.code) {
            <li class="row" (click)="open(r.code)" tabindex="0" (keydown.enter)="open(r.code)">
              <span class="row__swatch" [style.background]="actionColor(r.worst)"></span>
              <span class="row__code mono">{{ r.code }}</span>
              <span class="row__name">{{ r.name }}</span>
              <span class="row__tax mono">{{ r.tax == null ? '—' : r.tax.toFixed(1) + '%' }}</span>
              <span class="row__pills">
                @for (a of r.actions; track a) {
                  <span class="pill pill--{{ actionPill(a) }}">{{ actionLabel(a) }}</span>
                }
                @if (r.pending) { <span class="pill pill--amber">Pending bill</span> }
              </span>
              <mat-icon class="row__chev">chevron_right</mat-icon>
            </li>
          }
          @if (rows().length === 0) {
            <li class="empty">No states match “{{ search() }}”.</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.5rem; }
    .head { display: flex; flex-direction: column; gap: 0.5rem; }
    .title {
      font-family: var(--font-display); font-weight: 800;
      font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.02;
      letter-spacing: -0.02em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); max-width: 46rem; }
    .panel {
      border: 1px solid var(--ink-border); border-radius: var(--radius-lg);
      background: var(--ink-surface); padding: 1.25rem;
      display: flex; flex-direction: column; gap: 1rem;
    }
    .panel__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .panel__title {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-dim); margin: 0;
    }
    .prog-switch {
      display: inline-flex; gap: 0.25rem; padding: 0.2rem;
      background: var(--accent-soft); border: 1px solid var(--accent-border);
      border-radius: var(--radius-sm);
    }
    .prog-switch__btn {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; color: var(--cream-dim); background: transparent;
      border: 0; border-radius: calc(var(--radius-sm) - 2px);
      padding: 0.3rem 0.7rem; cursor: pointer;
    }
    .prog-switch__btn--active { background: var(--accent); color: #fff; }
    .filters { display: flex; gap: 0.75rem; }
    .field {
      display: flex; align-items: center; gap: 0.5rem; flex: 1;
      padding: 0.55rem 0.8rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
    }
    .field mat-icon { color: var(--cream-dim); font-size: 18px; width: 18px; height: 18px; }
    .field input { flex: 1; border: 0; background: transparent; color: var(--cream); outline: none; font: inherit; }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .row {
      display: grid; align-items: center;
      grid-template-columns: 0.6rem 2.2rem 1fr auto 2fr 1.2rem;
      gap: 0.75rem; padding: 0.7rem 0.9rem; cursor: pointer;
      border: 1px solid var(--ink-border); border-radius: var(--radius-sm);
      background: var(--ink-surface); transition: border-color var(--d-2) var(--ease-out);
    }
    .row:hover, .row:focus-visible { border-color: var(--accent-border); outline: none; }
    .row__swatch { width: 0.6rem; height: 1.4rem; border-radius: 2px; }
    .row__code { color: var(--accent); font-weight: 600; }
    .row__name { color: var(--cream); }
    .row__tax { color: var(--cream-muted); }
    .row__pills { display: flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end; }
    .row__chev { color: var(--cream-dim); }
    .empty { color: var(--cream-dim); padding: 1rem; }
    @media (max-width: 46rem) {
      .row { grid-template-columns: 0.6rem 2rem 1fr 1.2rem; }
      .row__tax, .row__pills { display: none; }
    }
  `,
})
export class StatesList implements OnInit {
  private readonly data = inject(DataService);
  private readonly router = inject(Router);

  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly program = signal<ProductCode>('IQOS');
  protected readonly programOptions: readonly ProductCode[] = ['IQOS', 'ZYN'];

  protected readonly actionByState = computed(() => {
    const by: Record<string, PricingAction> = {};
    for (const s of this.signals()) {
      if (s.product_code === this.program()) by[s.state] = s.pricing_action;
    }
    return by;
  });

  private readonly allRows = computed<StateRow[]>(() => {
    const byState = new Map<string, PricingSignal[]>();
    for (const s of this.signals()) {
      const list = byState.get(s.state) ?? [];
      list.push(s);
      byState.set(s.state, list);
    }
    const rows: StateRow[] = [];
    for (const [code, list] of byState) {
      const actions = [...new Set(list.map((s) => s.pricing_action))].sort(
        (a, b) => PRICING_ACTIONS[b].order - PRICING_ACTIONS[a].order
      );
      const worst = SEVERITY.find((a) => actions.includes(a)) ?? 'price_freely';
      const taxes = list
        .map((s) => s.tax_burden)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      rows.push({
        code,
        name: US_STATE_NAMES[code] ?? code,
        signalCount: list.length,
        actions,
        worst,
        tax: taxes.length ? Math.max(...taxes) : null,
        pending: list.some((s) => s.has_pending),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly rows = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.allRows();
    return this.allRows().filter(
      (r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  });

  async ngOnInit(): Promise<void> {
    try {
      this.signals.set(await this.data.listSignals());
    } finally {
      this.loading.set(false);
    }
  }

  protected open(code: string): void {
    void this.router.navigate(['/states', code]);
  }

  protected actionColor(a: PricingAction): string {
    return PRICING_ACTIONS[a].color;
  }
  protected actionPill(a: PricingAction): string {
    return PRICING_ACTIONS[a].pill;
  }
  protected actionLabel(a: PricingAction): string {
    return PRICING_ACTIONS[a].label;
  }
}
