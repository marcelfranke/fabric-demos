import { Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type {
  PricingSignal,
  Program,
  RegulatoryItem,
} from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  CATEGORY_LABELS,
  PRICING_ACTIONS,
  US_STATE_NAMES,
  type PricingAction,
} from '../../services/constants';

@Component({
  selector: 'app-regulatory-detail',
  imports: [MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <a class="back" routerLink="/regulatory">
        <mat-icon>arrow_back</mat-icon> Pricing signals
      </a>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 12rem"></div>
      } @else if (sig(); as s) {
        <header class="head">
          <div class="head__tags">
            <span class="pill pill--{{ actionPill(s.pricing_action) }}">
              {{ actionLabel(s.pricing_action) }}
            </span>
            <span class="pill pill--{{ s.sellable ? 'emerald' : 'rose' }}">
              {{ s.sellable ? 'Sellable' : 'Blocked' }}
            </span>
            <span class="tag mono">{{ s.product_code }}</span>
          </div>
          <h1 class="title">{{ s.state_name }} · {{ s.product_code }}</h1>
          <p class="lead">{{ s.recommendation }}</p>
        </header>

        <dl class="grid">
          <div class="row">
            <dt>Pricing action</dt>
            <dd>{{ actionLabel(s.pricing_action) }}</dd>
          </div>
          <div class="row">
            <dt>Tax burden</dt>
            <dd class="mono">{{ s.tax_burden == null ? '—' : s.tax_burden + '%' }}</dd>
          </div>
          <div class="row">
            <dt>Flavor ban</dt>
            <dd>{{ s.flavor_banned ? 'Yes — flavored SKUs banned' : 'No' }}</dd>
          </div>
          <div class="row">
            <dt>Registry gated</dt>
            <dd>{{ s.registry_gated ? 'Yes — PMTA directory law' : 'No' }}</dd>
          </div>
          <div class="row">
            <dt>Pending bill</dt>
            <dd>{{ s.has_pending ? 'Yes — monitoring' : 'No' }}</dd>
          </div>
          @if (program(); as p) {
            <div class="row">
              <dt>Program</dt>
              <dd>
                <a class="link" [routerLink]="['/programs', p.id]">
                  {{ p.name }} <mat-icon>arrow_forward</mat-icon>
                </a>
              </dd>
            </div>
          }
        </dl>

        <section class="evidence">
          <h3 class="evidence__title">Evidence — underlying laws</h3>
          @if (evidence().length === 0) {
            <p class="empty">No underlying provisions recorded for this state.</p>
          } @else {
            <ul class="ev-list">
              @for (e of evidence(); track e.id) {
                <li class="ev">
                  <div class="ev__main">
                    <span class="pill pill--{{ statusPill(e.status) }}">{{ e.status }}</span>
                    <span class="tag mono">{{ catLabel(e.category) }}</span>
                    <span class="ev__title">{{ e.title }}</span>
                  </div>
                  <div class="ev__meta">
                    @if (e.provision_value) {
                      <span class="mono">{{ e.provision_value }}</span>
                    }
                    @if (e.source_url) {
                      <a class="link" [href]="e.source_url" target="_blank" rel="noopener">
                        Source <mat-icon>open_in_new</mat-icon>
                      </a>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      } @else {
        <p class="empty">Pricing signal not found.</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.5rem; max-width: 52rem; }
    .back {
      display: inline-flex; align-items: center; gap: 0.35rem;
      color: var(--cream-dim); text-decoration: none;
      font-family: var(--font-mono); font-size: var(--text-small); width: fit-content;
    }
    .back:hover { color: var(--accent); }
    .back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .head { display: flex; flex-direction: column; gap: 0.6rem; }
    .head__tags { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .tag {
      font-size: var(--text-caption); letter-spacing: 0.08em;
      color: var(--cream-dim); text-transform: uppercase;
    }
    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: clamp(1.6rem, 3.5vw, 2.5rem); line-height: 1.05;
      letter-spacing: -0.03em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); }
    .grid {
      display: flex; flex-direction: column; gap: 0; margin: 0;
      border-top: 1px solid var(--ink-border);
    }
    .row {
      display: grid; grid-template-columns: 10rem 1fr; gap: 1rem;
      padding: 0.85rem 0; border-bottom: 1px solid var(--ink-border);
    }
    .row dt {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .row dd { margin: 0; color: var(--cream); word-break: break-word; }
    .link {
      display: inline-flex; align-items: center; gap: 0.3rem;
      color: var(--accent); text-decoration: none; word-break: break-all;
    }
    .link mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .evidence { display: flex; flex-direction: column; gap: 0.75rem; }
    .evidence__title {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--cream-dim); margin: 0;
    }
    .ev-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .ev {
      display: flex; flex-direction: column; gap: 0.4rem;
      padding: 0.85rem 1rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
    }
    .ev__main { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .ev__title { color: var(--cream); }
    .ev__meta {
      display: flex; align-items: center; gap: 1rem;
      color: var(--cream-dim); font-size: var(--text-small);
    }
    .empty { color: var(--cream-dim); }
    @media (max-width: 34rem) {
      .row { grid-template-columns: 1fr; gap: 0.25rem; }
    }
  `,
})
export class RegulatoryDetail implements OnInit {
  private readonly data = inject(DataService);
  private readonly route = inject(ActivatedRoute);

  protected readonly sig = signal<PricingSignal | null>(null);
  protected readonly program = signal<Program | null>(null);
  protected readonly evidence = signal<RegulatoryItem[]>([]);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    try {
      const s = await this.data.getSignal(id);
      this.sig.set(s);
      if (s?.program?.id) {
        this.program.set(await this.data.getProgram(s.program.id));
      }
      if (s) {
        this.evidence.set(
          await this.data.listItemsForState(s.state, s.program?.id)
        );
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected actionLabel(action: PricingAction): string {
    return PRICING_ACTIONS[action].label;
  }

  protected actionPill(action: PricingAction): string {
    return PRICING_ACTIONS[action].pill;
  }

  protected catLabel(category: RegulatoryItem['category']): string {
    return CATEGORY_LABELS[category];
  }

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
  }

  protected statusPill(status: string): string {
    if (status === 'enacted') return 'emerald';
    if (status === 'pending') return 'amber';
    return '';
  }

  protected fmt(d: Date | string): string {
    return new Date(d).toLocaleDateString();
  }
}
