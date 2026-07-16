import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  QueryAssistantService,
  type AskResult,
} from '../../services/query-assistant.service';
import { US_STATE_NAMES } from '../../services/constants';

@Component({
  selector: 'app-ask',
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Ask the data</p>
        <h1 class="title">Ask the regulatory data</h1>
        <p class="lead">
          A deterministic, offline query assistant — it reads the live signal set
          (no network, no LLM) and answers questions about programs, actions,
          states, taxes and revenue at risk.
        </p>
      </header>

      <form class="ask" (submit)="run($event)">
        <label class="ask__field">
          <mat-icon>search</mat-icon>
          <input
            type="text"
            placeholder="e.g. Top 5 states by excise tax"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            name="q"
            autocomplete="off"
          />
        </label>
        <button type="submit" class="ask__go">Ask</button>
      </form>

      <div class="chips">
        @for (ex of assistant.examples; track ex) {
          <button type="button" class="chip" (click)="askExample(ex)">{{ ex }}</button>
        }
      </div>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 8rem"></div>
      } @else if (result(); as r) {
        <section class="answer" [class.answer--fallback]="r.fallback">
          <p class="answer__headline">{{ r.answer }}</p>

          @if (r.rows.length) {
            <ul class="answer__rows">
              @for (row of r.rows; track $index) {
                <li class="arow">
                  <span class="arow__label">{{ row.label }}</span>
                  <span class="arow__value mono">{{ row.value }}</span>
                </li>
              }
            </ul>
          }

          @if (r.states.length) {
            <div class="answer__states">
              <span class="answer__states-label">Open state:</span>
              @for (c of r.states; track c) {
                <button type="button" class="state-chip" (click)="open(c)">
                  {{ c }} <mat-icon>arrow_forward</mat-icon>
                </button>
              }
            </div>
          }
        </section>
      }

      <p class="foot">
        Rule-based intent parser (program · action · state · metric). Fully
        offline and deterministic — the same question always yields the same
        answer from the seed.
      </p>
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 1.25rem; max-width: 52rem; }
    .head { display: flex; flex-direction: column; gap: 0.5rem; }
    .title {
      font-family: var(--font-display); font-weight: 800;
      font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.02;
      letter-spacing: -0.02em; color: var(--cream); margin: 0;
    }
    .lead { color: var(--cream-muted); max-width: 46rem; }
    .ask { display: flex; gap: 0.6rem; }
    .ask__field {
      display: flex; align-items: center; gap: 0.5rem; flex: 1;
      padding: 0.65rem 0.9rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
    }
    .ask__field mat-icon { color: var(--cream-dim); }
    .ask__field input { flex: 1; border: 0; background: transparent; color: var(--cream); outline: none; font: inherit; }
    .ask__go {
      padding: 0 1.4rem; border: 0; border-radius: var(--radius-sm);
      background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
    }
    .ask__go:hover { filter: brightness(1.05); }
    .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .chip {
      padding: 0.4rem 0.8rem; border: 1px solid var(--accent-border);
      border-radius: 999px; background: var(--accent-soft); color: var(--accent);
      font: inherit; font-size: var(--text-small); cursor: pointer;
    }
    .chip:hover { background: var(--accent); color: #fff; }
    .answer {
      display: flex; flex-direction: column; gap: 1rem;
      padding: 1.4rem 1.5rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg); background: var(--ink-surface);
    }
    .answer--fallback { border-style: dashed; }
    .answer__headline {
      margin: 0; color: var(--cream);
      font-family: var(--font-display); font-weight: 600; font-size: 1.15rem; line-height: 1.35;
    }
    .answer__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .arow {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: 0.5rem 0.75rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--canvas, transparent);
    }
    .arow__label { color: var(--cream-muted); }
    .arow__value { color: var(--accent); font-weight: 600; }
    .answer__states { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .answer__states-label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--cream-dim);
    }
    .state-chip {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.3rem 0.6rem; border: 1px solid var(--ink-border);
      border-radius: 999px; background: transparent; color: var(--cream);
      font: inherit; font-size: var(--text-small); cursor: pointer;
    }
    .state-chip:hover { border-color: var(--accent-border); color: var(--accent); }
    .state-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .foot { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
  `,
})
export class Ask implements OnInit {
  private readonly data = inject(DataService);
  private readonly router = inject(Router);
  protected readonly assistant = inject(QueryAssistantService);

  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly loading = signal(true);
  protected readonly query = signal('');
  protected readonly result = signal<AskResult | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.signals.set(await this.data.listSignals());
    } finally {
      this.loading.set(false);
    }
  }

  protected run(evt: Event): void {
    evt.preventDefault();
    this.result.set(this.assistant.ask(this.query(), this.signals()));
  }

  protected askExample(ex: string): void {
    this.query.set(ex);
    this.result.set(this.assistant.ask(ex, this.signals()));
  }

  protected open(code: string): void {
    void this.router.navigate(['/states', code]);
  }

  protected stateName(code: string): string {
    return US_STATE_NAMES[code] ?? code;
  }
}
