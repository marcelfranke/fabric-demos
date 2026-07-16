import { Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { AppConfigService } from '../../services/app-config.service';
import { CdcStateSyncService } from '../../services/cdc-state-sync.service';
import { SeedService } from '../../services/seed.service';

@Component({
  selector: 'app-setup',
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <header class="header page-enter">
        <p class="eyebrow">Step 01 — set up your workspace</p>
        <h1 class="title">
          Two ways<br />
          to <em>begin.</em>
        </h1>
        <p class="lead">
          Either load a curated snapshot of state pricing rules, or pull them
          live from the CDC STATE System. Every state resolves to a
          <em>Pricing Signal</em> for ZYN &amp; VEEV. Switch later from Settings.
        </p>
      </header>

      <div class="cards page-enter">
        <article class="card" [class.card--busy]="busy() === 'seeded'">
          <header class="card__top">
            <span class="card__num">A</span>
            <span class="card__tag">Curated snapshot</span>
          </header>
          <h2 class="card__title">Seed a <em>snapshot.</em></h2>
          <p class="card__lead">
            Loads the three PMI programs plus a hand-curated set of flavor bans,
            PMTA registry laws, a vapor excise-tax sample, and FDA milestones —
            then computes each state's Pricing Signal. Full CRUD in the UI.
          </p>
          <ul class="card__notes">
            <li>Full read &amp; write access</li>
            <li>IQOS, ZYN &amp; VEEV programs</li>
            <li>Point-in-time curated dataset</li>
          </ul>
          <button
            type="button"
            class="card__cta"
            [disabled]="busy() !== null"
            (click)="startSeeded()"
          >
            @if (busy() === 'seeded') {
              <mat-spinner diameter="16" strokeWidth="2" />
            } @else {
              <mat-icon>arrow_forward</mat-icon>
            }
            <span>Use this</span>
          </button>
        </article>

        <article class="card card--accent" [class.card--busy]="busy() === 'cdc'">
          <header class="card__top">
            <span class="card__num">B</span>
            <span class="card__tag">Live CDC sync</span>
          </header>
          <h2 class="card__title">Pull from <em>the CDC.</em></h2>
          <p class="card__lead">
            Mirrors five CDC STATE System e-cigarette datasets (tax, youth
            access, licensure, preemption, smoke-free air), folds in the curated
            flavor-ban &amp; registry facts, then computes each state's Pricing
            Signal. The UI becomes read-only; sync runs on dashboard load when
            stale, and you can refresh on demand from the toolbar.
          </p>
          <ul class="card__notes">
            <li>Public, no-API-key endpoints</li>
            <li>50 states + DC, deduped to current law</li>
            <li>Idempotent — re-sync converges</li>
          </ul>
          @if (error(); as err) {
            <p class="card__error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ err }}</span>
            </p>
          }
          <button
            type="button"
            class="card__cta card__cta--accent"
            [disabled]="busy() !== null"
            (click)="startCdc()"
          >
            @if (busy() === 'cdc') {
              <mat-spinner diameter="16" strokeWidth="2" />
            } @else {
              <mat-icon>cloud_sync</mat-icon>
            }
            <span>Sync from CDC</span>
          </button>
        </article>
      </div>

      <footer class="hint page-enter">
        <span class="eyebrow">Tip</span>
        <p>
          CDC data is legislation tracking, not real-time enforcement. Switching
          modes from Settings will reset the workspace.
        </p>
      </footer>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }

    .page {
      min-height: 100vh;
      max-width: 76rem;
      margin: 0 auto;
      padding: clamp(3rem, 8vw, 6rem) clamp(1.5rem, 4vw, 4rem) 4rem;
      display: flex;
      flex-direction: column;
      gap: clamp(2.5rem, 5vw, 4rem);
      isolation: isolate;
    }

    /* Subtle backdrop glow */
    .page::before {
      content: '';
      position: fixed;
      inset: -6rem auto auto -6rem;
      width: 40rem;
      height: 40rem;
      background: radial-gradient(
        circle,
        rgba(212, 255, 58, 0.1),
        transparent 60%
      );
      filter: blur(20px);
      z-index: -1;
      pointer-events: none;
    }

    /* Header */
    .header {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-width: 48rem;
    }

    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.5rem, 6vw, 4.5rem);
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: var(--cream);
      margin: 0;
    }

    .title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 90, 'wght' 400;
      padding-right: 0.18em;
      color: var(--accent);
    }

    .lead {
      font-size: 1.0625rem;
      line-height: 1.55;
      color: var(--cream-muted);
      max-width: 36rem;
    }

    /* Cards */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1.25rem;
    }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 2rem;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.025),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      transition: border-color var(--d-3) var(--ease-out),
        transform var(--d-3) var(--ease-out);
    }

    .card:hover {
      transform: translateY(-2px);
      border-color: var(--ink-border);
    }

    .card--accent {
      background: linear-gradient(
          180deg,
          rgba(212, 255, 58, 0.04),
          rgba(212, 255, 58, 0)
        ),
        var(--ink-surface);
    }

    .card--accent:hover {
      border-color: var(--accent-border);
    }

    .card--busy {
      opacity: 0.7;
      pointer-events: none;
    }

    .card__top {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .card__num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      border: 1px solid var(--ink-border);
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 400;
      font-size: 1rem;
      color: var(--cream);
    }

    .card--accent .card__num {
      border-color: var(--accent-border);
      color: var(--accent);
    }

    .card__tag {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .card--accent .card__tag {
      color: var(--accent);
    }

    .card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.05;
      letter-spacing: -0.025em;
      color: var(--cream);
      margin: 0;
    }

    .card__title em {
      font-style: italic;
      font-variation-settings: 'opsz' 96, 'SOFT' 80, 'wght' 400;
      color: var(--cream);
      padding-right: 0.18em;
    }

    .card--accent .card__title em {
      color: var(--accent);
    }

    .card__lead {
      color: var(--cream-muted);
      line-height: 1.55;
    }

    .card__notes {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card__notes li {
      position: relative;
      padding-left: 1.25rem;
      color: var(--cream-muted);
      font-size: var(--text-small);
    }

    .card__notes li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0.55rem;
      width: 0.5rem;
      height: 1px;
      background: var(--cream-dim);
    }

    /* Field */
    .card__field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card__field-label {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .card__input {
      height: 2.75rem;
      padding: 0 0.875rem;
      background: var(--ink-bg);
      color: var(--cream);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.9375rem;
      letter-spacing: -0.005em;
      transition: border-color var(--d-1) var(--ease-out),
        background var(--d-1) var(--ease-out);
    }

    .card__input::placeholder {
      color: var(--cream-dim);
    }

    .card__input:focus {
      outline: none;
      border-color: var(--accent);
      background: var(--ink-elevated);
    }

    /* Error */
    .card__error {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.625rem 0.75rem;
      background: var(--rose-soft);
      color: var(--rose);
      border: 1px solid rgba(251, 113, 133, 0.25);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--text-small);
      line-height: 1.4;
    }

    .card__error mat-icon {
      flex-shrink: 0;
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-top: 1px;
    }

    /* CTA — text + icon, edge-aligned */
    .card__cta {
      display: inline-flex;
      align-items: center;
      gap: 0.625rem;
      align-self: flex-start;
      height: 2.75rem;
      padding: 0 1.25rem;
      background: transparent;
      color: var(--cream);
      border: 1px solid var(--cream);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      letter-spacing: -0.005em;
      margin-top: auto;
      transition: background var(--d-1) var(--ease-out),
        color var(--d-1) var(--ease-out),
        transform var(--d-1) var(--ease-out);
    }

    .card__cta:hover:not([disabled]) {
      background: var(--cream);
      color: var(--ink-bg);
      transform: translateY(-1px);
    }

    .card__cta--accent {
      background: var(--accent);
      color: var(--ink-bg);
      border-color: var(--accent);
      box-shadow: 0 10px 30px -10px rgba(212, 255, 58, 0.3);
    }

    .card__cta--accent:hover:not([disabled]) {
      background: var(--accent);
      color: var(--ink-bg);
      transform: translateY(-1px);
      box-shadow: 0 14px 36px -10px rgba(212, 255, 58, 0.5);
    }

    .card__cta[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .card__cta mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .card__cta .mat-mdc-progress-spinner {
      --mat-progress-spinner-active-indicator-color: currentColor;
    }

    /* Hint footer */
    .hint {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      padding-top: 2rem;
      border-top: 1px solid var(--ink-border-soft);
      color: var(--cream-dim);
    }

    .hint .eyebrow {
      color: var(--accent);
      flex-shrink: 0;
    }

    .hint p {
      max-width: 40rem;
      font-size: var(--text-small);
    }
  `,
})
export class Setup {
  private readonly appConfig = inject(AppConfigService);
  private readonly seed = inject(SeedService);
  private readonly sync = inject(CdcStateSyncService);
  private readonly router = inject(Router);

  protected readonly busy = signal<'seeded' | 'cdc' | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async startSeeded(): Promise<void> {
    this.busy.set('seeded');
    this.error.set(null);
    try {
      await this.appConfig.setMode('seeded');
      await this.seed.seedAll();
      await this.router.navigate(['/']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async startCdc(): Promise<void> {
    this.busy.set('cdc');
    this.error.set(null);
    try {
      await this.appConfig.setMode('cdc');
      await this.sync.syncNow();
      await this.router.navigate(['/']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }
}
