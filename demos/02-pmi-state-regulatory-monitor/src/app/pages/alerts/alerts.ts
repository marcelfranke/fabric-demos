import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  PRICING_ACTIONS,
  REPORT_AS_OF_DATE,
  US_STATE_NAMES,
  type PricingAction,
} from '../../services/constants';

interface AlertRow {
  signal: PricingSignal;
  when: Date;
  days: number; // signed days from the as-of snapshot (negative = already effective)
  badge: string;
  badgePill: string;
}

const DAY = 86_400_000;

@Component({
  selector: 'app-alerts',
  imports: [MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Regulatory desk</p>
        <h1 class="title">Alerts</h1>
        <p class="lead">
          What changed and what's coming — pending legislation plus CDC effective
          dates, classified against the {{ asOfLabel() }} reporting snapshot.
        </p>
      </header>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 12rem"></div>
      } @else {
        <!-- Pending reconciliation note -->
        <section class="callout">
          <div class="callout__nums">
            <div class="cnum">
              <span class="cnum__n">{{ pendingStates().length }}</span>
              <span class="cnum__l">pending-bill states</span>
            </div>
            <span class="cnum__op">vs</span>
            <div class="cnum">
              <span class="cnum__n">{{ watchPendingCount() }}</span>
              <span class="cnum__l">“watch pending” action</span>
            </div>
          </div>
          <p class="callout__note">
            Both are correct. {{ pendingStates().length }} states carry a pending
            bill ({{ pendingStateNames() }}), but only {{ watchPendingCount() }}
            resolves to a <em>watch&nbsp;pending</em> action — in the others a
            flavor ban or registry law outranks the pending flag, so the
            recommended action is stricter. No number is fudged.
          </p>
        </section>

        <!-- Pending bills -->
        <section class="block">
          <h2 class="block__title">Pending legislation</h2>
          <ul class="feed">
            @for (s of pendingSignals(); track s.id) {
              <li class="alert">
                <span class="alert__swatch" [style.background]="actionColor(s.pricing_action)"></span>
                <div class="alert__body">
                  <a class="alert__state" [routerLink]="['/states', s.state]">
                    {{ stateName(s.state) }} · {{ s.product_code }}
                  </a>
                  <span class="alert__rec">{{ s.recommendation }}</span>
                </div>
                <span class="pill pill--amber">Pending bill</span>
                <span class="pill pill--{{ actionPill(s.pricing_action) }}">{{ actionLabel(s.pricing_action) }}</span>
              </li>
            }
          </ul>
        </section>

        <!-- Upcoming effective dates -->
        <section class="block">
          <h2 class="block__title">Upcoming effective dates ({{ upcoming().length }})</h2>
          @if (upcoming().length === 0) {
            <p class="empty">Nothing scheduled after the snapshot.</p>
          } @else {
            <ul class="feed">
              @for (a of upcoming(); track a.signal.id) {
                <li class="alert">
                  <span class="alert__swatch" [style.background]="actionColor(a.signal.pricing_action)"></span>
                  <div class="alert__body">
                    <a class="alert__state" [routerLink]="['/states', a.signal.state]">
                      {{ stateName(a.signal.state) }} · {{ a.signal.product_code }}
                    </a>
                    <span class="alert__rec mono">effective {{ fmt(a.when) }} · in {{ a.days }} days</span>
                  </div>
                  <span class="pill pill--{{ a.badgePill }}">{{ a.badge }}</span>
                  <span class="pill pill--{{ actionPill(a.signal.pricing_action) }}">{{ actionLabel(a.signal.pricing_action) }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Recently effective -->
        <section class="block">
          <h2 class="block__title">Recently in effect ({{ recent().length }})</h2>
          <ul class="feed">
            @for (a of recent(); track a.signal.id) {
              <li class="alert">
                <span class="alert__swatch" [style.background]="actionColor(a.signal.pricing_action)"></span>
                <div class="alert__body">
                  <a class="alert__state" [routerLink]="['/states', a.signal.state]">
                    {{ stateName(a.signal.state) }} · {{ a.signal.product_code }}
                  </a>
                  <span class="alert__rec mono">effective {{ fmt(a.when) }}</span>
                </div>
                <span class="pill pill--{{ a.badgePill }}">{{ a.badge }}</span>
                <span class="pill pill--{{ actionPill(a.signal.pricing_action) }}">{{ actionLabel(a.signal.pricing_action) }}</span>
              </li>
            }
          </ul>
        </section>

        <p class="foot">
          {{ datedCount() }} of {{ total() }} signals carry a curated CDC effective
          date; the other {{ total() - datedCount() }} are undated in the seed.
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
    .lead { color: var(--cream-muted); max-width: 46rem; }
    .callout {
      display: flex; flex-direction: column; gap: 0.9rem;
      padding: 1.25rem 1.4rem; border: 1px solid var(--accent-border);
      border-radius: var(--radius-lg); background: var(--accent-soft);
    }
    .callout__nums { display: flex; align-items: center; gap: 1.4rem; }
    .cnum { display: flex; flex-direction: column; gap: 0.15rem; }
    .cnum__n { font-family: var(--font-display); font-weight: 800; font-size: 2rem; line-height: 1; color: var(--accent); }
    .cnum__l { font-family: var(--font-mono); font-size: var(--text-caption); letter-spacing: 0.06em; text-transform: uppercase; color: var(--cream-dim); }
    .cnum__op { font-family: var(--font-mono); color: var(--cream-dim); }
    .callout__note { margin: 0; color: var(--cream-muted); font-size: var(--text-small); }
    .callout__note em { color: var(--cream); font-style: normal; font-weight: 600; }
    .block { display: flex; flex-direction: column; gap: 0.8rem; }
    .block__title {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-dim); margin: 0;
    }
    .feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .alert {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.7rem 0.9rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface); flex-wrap: wrap;
    }
    .alert__swatch { width: 0.5rem; height: 1.6rem; border-radius: 2px; flex: 0 0 auto; }
    .alert__body { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 12rem; }
    .alert__state { color: var(--cream); text-decoration: none; font-weight: 600; }
    .alert__state:hover { color: var(--accent); }
    .alert__rec { color: var(--cream-dim); font-size: var(--text-small); }
    .empty { color: var(--cream-dim); }
    .foot { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
  `,
})
export class Alerts implements OnInit {
  private readonly data = inject(DataService);

  private readonly asOf = new Date(REPORT_AS_OF_DATE);
  protected readonly loading = signal(true);
  protected readonly signals = signal<PricingSignal[]>([]);

  protected readonly total = computed(() => this.signals().length);

  protected readonly pendingSignals = computed(() =>
    this.signals()
      .filter((s) => s.has_pending)
      .sort((a, b) => a.state.localeCompare(b.state))
  );

  /** Distinct states carrying a pending bill (KPI = 2). */
  protected readonly pendingStates = computed(() => [
    ...new Set(this.pendingSignals().map((s) => s.state)),
  ]);

  /** Signals whose resolved action is watch_pending (= 1). */
  protected readonly watchPendingCount = computed(
    () => this.signals().filter((s) => s.pricing_action === 'watch_pending').length
  );

  private readonly dated = computed<AlertRow[]>(() =>
    this.signals()
      .filter((s) => s.effective_date)
      .map((s) => {
        const when = new Date(s.effective_date as Date);
        const days = Math.round((when.getTime() - this.asOf.getTime()) / DAY);
        return { signal: s, when, days, ...this.badgeFor(days) };
      })
  );

  protected readonly datedCount = computed(() => this.dated().length);

  protected readonly upcoming = computed(() =>
    this.dated()
      .filter((a) => a.days > 0)
      .sort((a, b) => a.days - b.days)
  );

  protected readonly recent = computed(() =>
    this.dated()
      .filter((a) => a.days <= 0)
      .sort((a, b) => b.days - a.days)
  );

  async ngOnInit(): Promise<void> {
    try {
      this.signals.set(await this.data.listSignals());
    } finally {
      this.loading.set(false);
    }
  }

  private badgeFor(days: number): { badge: string; badgePill: string } {
    if (days > 90) return { badge: 'Upcoming', badgePill: 'blue' };
    if (days > 0) return { badge: 'This quarter', badgePill: 'amber' };
    if (days > -90) return { badge: 'Just effective', badgePill: 'emerald' };
    return { badge: 'In effect', badgePill: '' };
  }

  protected pendingStateNames(): string {
    return this.pendingStates()
      .map((c) => US_STATE_NAMES[c] ?? c)
      .join(' & ');
  }

  protected asOfLabel(): string {
    return this.asOf.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  protected fmt(d: Date): string {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
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
