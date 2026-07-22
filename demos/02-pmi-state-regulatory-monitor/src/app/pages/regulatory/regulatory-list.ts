import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  PRICING_ACTIONS,
  PRICING_ACTION_ORDER,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from '../../services/constants';

@Component({
  selector: 'app-regulatory-list',
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Pricing desk</p>
        <h1 class="title">Pricing signals</h1>
        <p class="lead">
          One screening verdict per state and product line — the rule that
          decides whether the dynamic-pricing engine may set a price.
        </p>
      </header>

      <!-- Filters -->
      <div class="filters">
        <label class="field field--search">
          <mat-icon>search</mat-icon>
          <input
            type="text"
            placeholder="Search state or recommendation…"
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
          />
        </label>

        <label class="field">
          <select [ngModel]="programFilter()" (ngModelChange)="programFilter.set($event)">
            <option value="">All programs</option>
            <option value="ZYN">ZYN</option>
            <option value="IQOS">IQOS</option>
          </select>
        </label>

        <label class="field">
          <select [ngModel]="stateFilter()" (ngModelChange)="stateFilter.set($event)">
            <option value="">All states</option>
            @for (s of stateOptions(); track s) {
              <option [value]="s">{{ s }} — {{ stateName(s) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <select [ngModel]="actionFilter()" (ngModelChange)="actionFilter.set($event)">
            <option value="">All actions</option>
            @for (a of actionOptions; track a) {
              <option [value]="a">{{ actionLabel(a) }}</option>
            }
          </select>
        </label>

        @if (hasFilter()) {
          <button type="button" class="clear" (click)="clearFilters()">
            <mat-icon>close</mat-icon> Clear
          </button>
        }
      </div>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 20rem"></div>
      } @else {
        <p class="count mono">{{ filtered().length }} of {{ signals().length }} signals</p>
        @if (filtered().length === 0) {
          <p class="empty">No signals match those filters.</p>
        } @else {
          <table class="table">
            <thead>
              <tr>
                <th>State</th>
                <th>Program</th>
                <th>Pricing action</th>
                <th>Tax burden</th>
                <th>Sellable</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              @for (s of filtered(); track s.id) {
                <tr (click)="open(s.id)">
                  <td class="mono">{{ s.state }}</td>
                  <td>{{ s.product_code }}</td>
                  <td>
                    <span class="pill pill--{{ actionPill(s.pricing_action) }}">
                      {{ actionLabel(s.pricing_action) }}
                    </span>
                  </td>
                  <td class="mono">{{ taxLabel(s.tax_burden) }}</td>
                  <td>
                    <span class="pill pill--{{ s.sellable ? 'emerald' : 'rose' }}">
                      {{ s.sellable ? 'Yes' : 'No' }}
                    </span>
                  </td>
                  <td class="dim">{{ s.recommendation }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.5rem; }
    .head { display: flex; flex-direction: column; gap: 0.6rem; max-width: 44rem; }
    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4vw, 3rem); line-height: 1;
      letter-spacing: -0.035em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); }
    .filters {
      display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center;
    }
    .field {
      display: flex; align-items: center; gap: 0.4rem;
      background: var(--ink-surface); border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); padding: 0 0.6rem; height: 2.5rem;
    }
    .field--search { flex: 1; min-width: 14rem; }
    .field mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cream-dim); }
    .field input, .field select {
      background: transparent; border: none; outline: none; width: 100%;
      color: var(--cream); font-family: var(--font-sans); font-size: 0.9rem;
    }
    .field select option { background: var(--ink-surface); color: var(--cream); }
    .clear {
      display: inline-flex; align-items: center; gap: 0.3rem;
      height: 2.5rem; padding: 0 0.75rem; cursor: pointer;
      background: transparent; border: 1px solid var(--ink-border);
      border-radius: var(--radius-pill); color: var(--cream-muted);
      font-family: var(--font-mono); font-size: var(--text-caption);
    }
    .clear:hover { color: var(--accent); border-color: var(--accent-border); }
    .clear mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .count { color: var(--cream-dim); font-size: var(--text-caption); }
    .table { width: 100%; border-collapse: collapse; }
    .table th {
      text-align: left; padding: 0.6rem 0.75rem;
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--cream-dim); border-bottom: 1px solid var(--ink-border);
    }
    .table td {
      padding: 0.7rem 0.75rem; border-bottom: 1px solid var(--ink-border);
      color: var(--cream-muted); font-size: var(--text-small); cursor: pointer;
    }
    .table tbody tr { transition: background var(--d-1) var(--ease-out); }
    .table tbody tr:hover { background: rgba(255, 255, 255, 0.02); }
    .cell-title { color: var(--cream); }
    .cell-actions { cursor: default; text-align: right; }
    .icon-btn {
      background: transparent; border: none; cursor: pointer;
      color: var(--cream-dim); display: inline-flex;
    }
    .icon-btn:hover { color: var(--rose); }
    .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .empty { color: var(--cream-dim); }
  `,
})
export class RegulatoryList implements OnInit {
  private readonly data = inject(DataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly loading = signal(true);

  protected readonly search = signal('');
  protected readonly programFilter = signal('');
  protected readonly stateFilter = signal('');
  protected readonly actionFilter = signal('');

  protected readonly actionOptions = PRICING_ACTION_ORDER;

  protected readonly stateOptions = computed(() =>
    [...new Set(this.signals().map((s) => s.state))].sort()
  );

  protected readonly hasFilter = computed(
    () =>
      !!this.search() ||
      !!this.programFilter() ||
      !!this.stateFilter() ||
      !!this.actionFilter()
  );

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const prog = this.programFilter();
    const st = this.stateFilter();
    const action = this.actionFilter();
    return this.signals().filter((s) => {
      if (prog && s.product_code !== prog) return false;
      if (st && s.state !== st) return false;
      if (action && s.pricing_action !== action) return false;
      if (q) {
        const hay = `${s.state} ${s.state_name} ${s.recommendation}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    const stateParam = this.route.snapshot.queryParamMap.get('state');
    if (stateParam) this.stateFilter.set(stateParam);
    const progParam = this.route.snapshot.queryParamMap.get('program');
    if (progParam) this.programFilter.set(progParam as ProductCode);
    await this.refresh();
  }

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
  }

  protected actionLabel(action: PricingAction): string {
    return PRICING_ACTIONS[action].label;
  }

  protected actionPill(action: PricingAction): string {
    return PRICING_ACTIONS[action].pill;
  }

  protected taxLabel(tax?: number): string {
    return tax == null ? '—' : `${tax}%`;
  }

  protected open(id: string): void {
    void this.router.navigate(['/regulatory', id]);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.programFilter.set('');
    this.stateFilter.set('');
    this.actionFilter.set('');
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.signals.set(await this.data.listSignals());
    } finally {
      this.loading.set(false);
    }
  }
}
