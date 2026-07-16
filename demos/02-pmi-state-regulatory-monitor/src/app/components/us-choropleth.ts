import { Component, computed, input, output, signal } from '@angular/core';

import { PRICING_ACTIONS, PRICING_ACTION_ORDER, type PricingAction } from '../services/constants';
import { US_MAP_VIEWBOX, US_STATE_PATHS } from '../data/us-states-paths';

interface StateShape {
  code: string;
  name: string;
  d: string;
}

interface HoverInfo {
  name: string;
  label: string;
  x: number;
  y: number;
}

// Fill for a state with no signal for the selected program (no monitored rule).
const NO_SIGNAL_FILL = '#e6ebf2';

/**
 * Self-contained US-states choropleth (zero runtime deps, no topojson fetch).
 * Each state is filled by its Pricing Signal `pricing_action` for the selected
 * program; hovering shows the recommended action and clicking a state emits its
 * 2-letter code so the parent can drill in. Geometry lives in
 * ../data/us-states-paths.ts.
 */
@Component({
  selector: 'app-us-choropleth',
  template: `
    <div class="map">
      <div class="map__frame" (mousemove)="onMove($event)">
        <svg
          [attr.viewBox]="viewBox"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="US states by pricing action"
        >
          @for (s of states(); track s.code) {
            <path
              [attr.d]="s.d"
              [attr.fill]="fillFor(s.code)"
              [attr.stroke]="strokeFor(s.code)"
              [attr.stroke-width]="selected() === s.code ? 2 : 0.75"
              class="state"
              [class.state--selected]="selected() === s.code"
              [attr.aria-label]="s.name"
              (click)="pick(s.code)"
              (mouseenter)="hoverState(s)"
              (mouseleave)="clearHover()"
            />
          }
        </svg>

        @if (hover(); as h) {
          <div class="tip" [style.left.px]="h.x" [style.top.px]="h.y">
            <span class="tip__name">{{ h.name }}</span>
            <span class="tip__score">{{ h.label }}</span>
          </div>
        }
      </div>

      <div class="legend">
        @for (a of actions; track a) {
          <span class="legend__item">
            <span class="legend__swatch" [style.background]="actionColor(a)"></span>
            <span class="legend__label">{{ actionLabel(a) }}</span>
          </span>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .map {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .map__frame {
      position: relative;
      width: 100%;
    }

    svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .state {
      cursor: pointer;
      transition: fill var(--d-2) var(--ease-out),
        opacity var(--d-2) var(--ease-out);
    }

    .state:hover {
      opacity: 0.82;
    }

    .state--selected {
      filter: drop-shadow(0 0 6px var(--accent-glow));
    }

    .tip {
      position: absolute;
      transform: translate(-50%, calc(-100% - 12px));
      pointer-events: none;
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.5rem 0.7rem;
      background: var(--ink-elevated-2);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
      white-space: nowrap;
      box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.6);
    }

    .tip__name {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 40, 'wght' 500;
      font-size: 0.9rem;
      color: var(--cream);
    }

    .tip__score {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.06em;
      color: var(--cream-muted);
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 1rem;
    }

    .legend__item {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .legend__label {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .legend__swatch {
      width: 1.4rem;
      height: 0.55rem;
      border-radius: 2px;
      border: 1px solid var(--ink-border);
    }
  `,
})
export class UsChoropleth {
  readonly actionByState = input<Record<string, PricingAction>>({});
  readonly selected = input<string | null>(null);
  readonly stateSelect = output<string>();

  protected readonly viewBox = US_MAP_VIEWBOX;
  protected readonly hover = signal<HoverInfo | null>(null);
  protected readonly actions = PRICING_ACTION_ORDER;

  protected readonly states = computed<StateShape[]>(() =>
    Object.entries(US_STATE_PATHS).map(([code, p]) => ({
      code,
      name: p.name,
      d: p.d,
    }))
  );

  protected actionColor(a: PricingAction): string {
    return PRICING_ACTIONS[a].color;
  }

  protected actionLabel(a: PricingAction): string {
    return PRICING_ACTIONS[a].label;
  }

  protected fillFor(code: string): string {
    const action = this.actionByState()[code];
    return action ? PRICING_ACTIONS[action].color : NO_SIGNAL_FILL;
  }

  protected strokeFor(code: string): string {
    if (this.selected() === code) return 'var(--accent)';
    return 'rgba(10, 9, 17, 0.55)';
  }

  protected pick(code: string): void {
    this.stateSelect.emit(code);
  }

  protected hoverState(s: StateShape): void {
    const action = this.actionByState()[s.code];
    const label = action ? PRICING_ACTIONS[action].label : 'No monitored rule';
    this.hover.update((h) => ({
      name: s.name,
      label,
      x: h?.x ?? 0,
      y: h?.y ?? 0,
    }));
  }

  protected clearHover(): void {
    this.hover.set(null);
  }

  protected onMove(evt: MouseEvent): void {
    const el = evt.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    this.hover.update((h) => (h ? { ...h, x, y } : h));
  }
}
