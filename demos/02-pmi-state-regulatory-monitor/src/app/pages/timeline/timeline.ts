import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import type { PricingSignal } from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';
import {
  PRICING_ACTIONS,
  PRICING_ACTION_ORDER,
  US_STATE_NAMES,
  type PricingAction,
  type ProductCode,
} from '../../services/constants';

interface Marker {
  signal: PricingSignal;
  when: Date;
  x: number; // 0..100 position along the track
  lane: number; // vertical lane to avoid overlap
  color: string;
}

const DAY = 86_400_000;

@Component({
  selector: 'app-timeline',
  imports: [FormsModule],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Regulatory desk</p>
        <h1 class="title">Effective-date timeline</h1>
        <p class="lead">
          The {{ allDated().length }} signals with a curated CDC effective date,
          plotted by date and colored by pricing action. Filter by program or
          state; click a marker to open the state.
        </p>
      </header>

      <div class="filters">
        <label class="field">
          <span class="field__label">Program</span>
          <select [ngModel]="program()" (ngModelChange)="program.set($event)">
            <option value="">All programs</option>
            <option value="IQOS">IQOS</option>
            <option value="ZYN">ZYN</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">State</span>
          <select [ngModel]="state()" (ngModelChange)="state.set($event)">
            <option value="">All states</option>
            @for (s of stateOptions(); track s) {
              <option [value]="s">{{ s }} — {{ stateName(s) }}</option>
            }
          </select>
        </label>
      </div>

      <div class="legend">
        @for (a of actions; track a) {
          <span class="legend__item">
            <span class="legend__swatch" [style.background]="actionColor(a)"></span>
            <span class="legend__label">{{ actionLabel(a) }}</span>
          </span>
        }
      </div>

      @if (loading()) {
        <div class="skeleton skeleton--card" style="height: 16rem"></div>
      } @else if (markers().length === 0) {
        <p class="empty">No dated signals match the current filter.</p>
      } @else {
        <section class="tl" [style.height.px]="trackHeight()">
          <!-- year gridlines -->
          @for (t of ticks(); track t.x) {
            <div class="tl__grid" [style.left.%]="t.x">
              <span class="tl__tick">{{ t.label }}</span>
            </div>
          }
          <!-- markers -->
          @for (m of markers(); track m.signal.id) {
            <button
              type="button"
              class="tl__marker"
              [style.left.%]="m.x"
              [style.top.px]="24 + m.lane * 34"
              [style.background]="m.color"
              [title]="stateName(m.signal.state) + ' · ' + m.signal.product_code + ' · ' + fmt(m.when)"
              (click)="open(m.signal.state)"
            >
              <span class="tl__label">{{ m.signal.state }}</span>
            </button>
          }
        </section>
        <p class="foot">
          Showing {{ markers().length }} of {{ allDated().length }} dated signals ·
          {{ rangeLabel() }}.
        </p>
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
    .lead { color: var(--cream-muted); max-width: 48rem; }
    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 12rem; }
    .field__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .field select {
      padding: 0.55rem 0.7rem; border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm); background: var(--ink-surface);
      color: var(--cream); font: inherit; outline: none;
    }
    .field select:focus { border-color: var(--accent); }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1rem; }
    .legend__item { display: inline-flex; align-items: center; gap: 0.35rem; }
    .legend__swatch { width: 1.4rem; height: 0.55rem; border-radius: 2px; border: 1px solid var(--ink-border); }
    .legend__label {
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream-dim);
    }
    .tl {
      position: relative; width: 100%;
      border: 1px solid var(--ink-border); border-radius: var(--radius-lg);
      background: var(--ink-surface); padding: 0.5rem 0; overflow: hidden;
    }
    .tl__grid { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--ink-border); }
    .tl__tick {
      position: absolute; bottom: 6px; left: 4px;
      font-family: var(--font-mono); font-size: var(--text-caption);
      letter-spacing: 0.06em; color: var(--cream-dim); white-space: nowrap;
    }
    .tl__marker {
      position: absolute; transform: translateX(-50%);
      display: inline-flex; align-items: center; gap: 0.25rem;
      height: 1.5rem; padding: 0 0.4rem; border: 0; border-radius: 999px;
      color: #fff; cursor: pointer; font: inherit; line-height: 1;
      box-shadow: 0 4px 10px -4px rgba(20, 33, 61, 0.5);
    }
    .tl__marker:hover { filter: brightness(1.08); }
    .tl__label { font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em; }
    .empty { color: var(--cream-dim); }
    .foot { color: var(--cream-dim); font-size: var(--text-small); margin: 0; }
  `,
})
export class Timeline implements OnInit {
  private readonly data = inject(DataService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly signals = signal<PricingSignal[]>([]);
  protected readonly program = signal<ProductCode | ''>('');
  protected readonly state = signal<string>('');
  protected readonly actions = PRICING_ACTION_ORDER;

  protected readonly allDated = computed(() =>
    this.signals().filter((s) => s.effective_date)
  );

  protected readonly stateOptions = computed(() =>
    [...new Set(this.allDated().map((s) => s.state))].sort()
  );

  private readonly filtered = computed(() =>
    this.allDated().filter((s) => {
      if (this.program() && s.product_code !== this.program()) return false;
      if (this.state() && s.state !== this.state()) return false;
      return true;
    })
  );

  private readonly bounds = computed(() => {
    const times = this.allDated().map((s) => new Date(s.effective_date as Date).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { min, max: max === min ? min + DAY : max };
  });

  protected readonly markers = computed<Marker[]>(() => {
    const { min, max } = this.bounds();
    const span = max - min;
    const sorted = [...this.filtered()].sort(
      (a, b) => new Date(a.effective_date as Date).getTime() - new Date(b.effective_date as Date).getTime()
    );
    const laneLastX: number[] = [];
    return sorted.map((s) => {
      const when = new Date(s.effective_date as Date);
      const x = ((when.getTime() - min) / span) * 96 + 2; // 2..98%
      // pick the first lane whose previous marker is far enough left (avoid overlap)
      let lane = laneLastX.findIndex((lx) => x - lx > 6);
      if (lane === -1) {
        lane = laneLastX.length;
      }
      laneLastX[lane] = x;
      return { signal: s, when, x, lane, color: PRICING_ACTIONS[s.pricing_action].color };
    });
  });

  protected readonly trackHeight = computed(() => {
    const lanes = this.markers().reduce((m, k) => Math.max(m, k.lane), 0) + 1;
    return 48 + lanes * 34;
  });

  protected readonly ticks = computed(() => {
    const { min, max } = this.bounds();
    const span = max - min;
    const startYear = new Date(min).getFullYear();
    const endYear = new Date(max).getFullYear();
    const out: { x: number; label: string }[] = [];
    for (let y = startYear; y <= endYear + 1; y++) {
      const t = new Date(`${y}-01-01`).getTime();
      if (t < min || t > max) continue;
      out.push({ x: ((t - min) / span) * 96 + 2, label: String(y) });
    }
    return out;
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

  protected rangeLabel(): string {
    const { min, max } = this.bounds();
    return `${this.fmt(new Date(min))} → ${this.fmt(new Date(max))}`;
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
  protected actionLabel(a: PricingAction): string {
    return PRICING_ACTIONS[a].label;
  }
}
