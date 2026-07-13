import { Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DataService } from '../../services/data.service';

interface ApplicantRank {
  name: string;
  country?: string;
  patents: number;
}

@Component({
  selector: 'app-applicants-list',
  imports: [MatIconModule],
  template: `
    <div class="page page-enter">
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">Workspace</p>
          <h1 class="head__title">Applicants.</h1>
          <p class="head__lead">
            {{ ranked().length }}
            {{ ranked().length === 1 ? 'organisation' : 'organisations' }}
            ranked by publications
          </p>
        </div>
      </header>

      @if (loading()) {
        <div class="board">
          @for (n of skeletonItems; track n) {
            <div class="skeleton skeleton--card" style="height: 3.5rem"></div>
          }
        </div>
      } @else if (ranked().length === 0) {
        <div class="empty">
          <p class="eyebrow">No applicants</p>
          <h2 class="empty__title">Nothing to rank yet.</h2>
          <p class="empty__lead">
            Applicants appear here once patents have been recorded.
          </p>
        </div>
      } @else {
        <ol class="board">
          @for (a of ranked(); track a.name) {
            <li class="board__row">
              <span class="board__rank mono">
                {{ ('0' + ($index + 1)).slice(-2) }}
              </span>
              <span class="board__name">{{ a.name }}</span>
              @if (a.country) {
                <span class="pill pill--lime">{{ a.country }}</span>
              }
              <span class="board__bar" aria-hidden="true">
                <span
                  class="board__fill"
                  [style.width.%]="(a.patents / maxPatents()) * 100"
                ></span>
              </span>
              <span class="board__count mono">
                {{ a.patents }}
                {{ a.patents === 1 ? 'patent' : 'patents' }}
              </span>
            </li>
          }
        </ol>
      }
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }

    .head__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.5rem, 5vw, 3.75rem);
      letter-spacing: -0.04em;
      line-height: 1;
      margin: 0.5rem 0 0.75rem;
      color: var(--cream);
    }

    .head__lead {
      font-family: var(--font-mono);
      font-size: var(--text-small);
      color: var(--cream-muted);
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
      padding: 4rem 2rem;
      background: var(--ink-surface);
      border: 1px dashed var(--ink-border);
      border-radius: var(--radius-lg);
      max-width: 36rem;
      margin: 0 auto;
    }

    .empty__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: 2rem;
      letter-spacing: -0.025em;
      margin: 0.25rem 0 0;
    }

    .empty__lead { color: var(--cream-muted); }

    .board {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--ink-border-soft);
    }

    .board__row {
      display: grid;
      grid-template-columns: auto minmax(6rem, 1.4fr) auto minmax(4rem, 1fr) auto;
      align-items: center;
      gap: 1rem;
      padding: 1rem 0.25rem;
      border-bottom: 1px solid var(--ink-border-soft);
    }

    .board__rank {
      font-size: var(--text-caption);
      letter-spacing: 0.12em;
      color: var(--cream-dim);
    }

    .board__name {
      font-size: var(--text-body);
      font-weight: 500;
      color: var(--cream);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .board__bar {
      position: relative;
      height: 0.5rem;
      background: var(--ink-elevated);
      border-radius: var(--radius-pill);
      overflow: hidden;
    }

    .board__fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--accent);
      border-radius: var(--radius-pill);
      transition: width var(--d-3) var(--ease-out);
    }

    .board__count {
      font-size: var(--text-caption);
      color: var(--cream-muted);
      white-space: nowrap;
      text-align: right;
    }

    @media (max-width: 40rem) {
      .board__row {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }
      .board__bar { display: none; }
      .board__count { grid-column: 2 / 4; text-align: left; }
    }
  `,
})
export class ApplicantsList implements OnInit {
  private readonly data = inject(DataService);

  protected readonly ranked = signal<ApplicantRank[]>([]);
  protected readonly loading = signal(true);
  protected readonly maxPatents = signal(1);
  protected readonly skeletonItems = [0, 1, 2, 3, 4, 5];

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const applicants = await this.data.listApplicants();
      const byName = new Map<string, ApplicantRank>();
      for (const a of applicants) {
        const key = a.name;
        const existing = byName.get(key);
        if (existing) {
          existing.patents += 1;
          existing.country ??= a.country;
        } else {
          byName.set(key, {
            name: a.name,
            country: a.country,
            patents: 1,
          });
        }
      }
      const ranked = [...byName.values()].sort(
        (x, y) => y.patents - x.patents || x.name.localeCompare(y.name)
      );
      this.maxPatents.set(Math.max(1, ...ranked.map((r) => r.patents)));
      this.ranked.set(ranked);
    } finally {
      this.loading.set(false);
    }
  }
}
