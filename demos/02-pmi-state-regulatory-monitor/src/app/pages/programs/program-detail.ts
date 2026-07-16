import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';

import type {
  PricingSignal,
  Program,
  RegulatoryItem,
} from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  PRICING_ACTIONS,
  US_STATE_NAMES,
  type PricingAction,
} from '../../services/constants';

@Component({
  selector: 'app-program-detail',
  imports: [MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <a class="back" routerLink="/programs">
        <mat-icon>arrow_back</mat-icon> Programs
      </a>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 8rem"></div>
      } @else if (program(); as p) {
        <header class="head">
          <span class="badge">{{ p.product_code }}</span>
          <h1 class="title">{{ p.name }}</h1>
          @if (p.description) {
            <p class="lead">{{ p.description }}</p>
          }
        </header>

        <!-- Federal FDA milestones (state = US) -->
        @if (milestones().length > 0) {
          <section class="section">
            <h2 class="section__title">FDA milestones</h2>
            <ol class="timeline">
              @for (m of milestones(); track m.id) {
                <li class="timeline__item">
                  <span class="timeline__dot" [class.timeline__dot--pending]="m.status === 'pending'"></span>
                  <div class="timeline__body">
                    <span class="timeline__date mono">
                      {{ m.enacted_date ? fmt(m.enacted_date) : 'Pending' }}
                    </span>
                    <span class="timeline__title">{{ m.title }}</span>
                    @if (m.provision_value) {
                      <span class="timeline__meta">{{ m.provision_value }}</span>
                    }
                  </div>
                </li>
              }
            </ol>
          </section>
        }

        <!-- Pricing signals -->
        <section class="section">
          <div class="section__head">
            <h2 class="section__title">Pricing signals</h2>
            <a class="section__link" [routerLink]="['/regulatory']">
              Open pricing desk <mat-icon>arrow_forward</mat-icon>
            </a>
          </div>
          @if (signals().length === 0) {
            <p class="empty">No state pricing signals for this program yet.</p>
          } @else {
            <table class="table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Pricing action</th>
                  <th>Tax burden</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                @for (s of signals(); track s.id) {
                  <tr [routerLink]="['/regulatory', s.id]">
                    <td class="mono">{{ s.state }}</td>
                    <td>
                      <span class="pill pill--{{ actionPill(s.pricing_action) }}">
                        {{ actionLabel(s.pricing_action) }}
                      </span>
                    </td>
                    <td class="mono">{{ s.tax_burden == null ? '—' : s.tax_burden + '%' }}</td>
                    <td class="dim">{{ s.recommendation }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      } @else {
        <p class="empty">Program not found.</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.75rem; max-width: 60rem; }
    .back {
      display: inline-flex; align-items: center; gap: 0.35rem;
      color: var(--cream-dim); text-decoration: none;
      font-family: var(--font-mono); font-size: var(--text-small);
      width: fit-content;
    }
    .back:hover { color: var(--accent); }
    .back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .head { display: flex; flex-direction: column; gap: 0.6rem; }
    .badge {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.1em; padding: 0.25rem 0.55rem; width: fit-content;
      border: 1px solid var(--accent-border); border-radius: var(--radius-pill);
      color: var(--accent);
    }
    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4vw, 3rem); line-height: 1;
      letter-spacing: -0.035em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); }
    .section { display: flex; flex-direction: column; gap: 1rem; }
    .section__head { display: flex; align-items: center; justify-content: space-between; }
    .section__title {
      font-family: var(--font-display); font-size: 1.4rem;
      color: var(--cream); margin: 0;
    }
    .section__link {
      display: inline-flex; align-items: center; gap: 0.3rem;
      color: var(--cream-dim); text-decoration: none;
      font-family: var(--font-mono); font-size: var(--text-caption);
    }
    .section__link:hover { color: var(--accent); }
    .section__link mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; }
    .timeline__item { display: flex; gap: 0.9rem; }
    .timeline__dot {
      margin-top: 0.35rem; width: 0.6rem; height: 0.6rem; flex-shrink: 0;
      border-radius: 50%; background: var(--accent);
    }
    .timeline__dot--pending { background: var(--amber); }
    .timeline__body { display: flex; flex-direction: column; gap: 0.2rem; }
    .timeline__date {
      font-size: var(--text-caption); color: var(--cream-dim);
      letter-spacing: 0.06em;
    }
    .timeline__title { color: var(--cream); text-decoration: none; font-weight: 600; }
    .timeline__title:hover { color: var(--accent); }
    .timeline__meta { color: var(--cream-muted); font-size: var(--text-small); }
    .table { width: 100%; border-collapse: collapse; }
    .table th {
      text-align: left; padding: 0.6rem 0.75rem;
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--cream-dim); border-bottom: 1px solid var(--ink-border);
    }
    .table td {
      padding: 0.7rem 0.75rem; border-bottom: 1px solid var(--ink-border);
      color: var(--cream-muted); font-size: var(--text-small);
    }
    .table tbody tr { cursor: pointer; transition: background var(--d-1) var(--ease-out); }
    .table tbody tr:hover { background: rgba(255, 255, 255, 0.02); }
    .empty { color: var(--cream-dim); }
  `,
})
export class ProgramDetail implements OnInit {
  private readonly data = inject(DataService);
  private readonly route = inject(ActivatedRoute);

  protected readonly program = signal<Program | null>(null);
  protected readonly items = signal<RegulatoryItem[]>([]);
  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly loading = signal(true);

  protected readonly milestones = computed(() =>
    this.items().filter((t) => t.state === 'US')
  );

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    try {
      const [program, items, signals] = await Promise.all([
        this.data.getProgram(id),
        this.data.listItemsForProgram(id),
        this.data.listSignalsForProgram(id),
      ]);
      this.program.set(program);
      this.items.set(items);
      this.signals.set(signals);
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

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
  }

  protected fmt(d: Date | string): string {
    return new Date(d).toLocaleDateString();
  }
}
