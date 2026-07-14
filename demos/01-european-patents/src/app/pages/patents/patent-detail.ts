import { Component, OnInit, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import type {
  Applicant,
  Classification,
  Inventor,
  Patent,
} from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';
import {
  PatentDialogData,
  PatentFormDialog,
  PatentFormResult,
} from './patents-list';

@Component({
  selector: 'app-patent-detail',
  imports: [MatIconModule, MatTooltipModule, RouterLink],
  template: `
    @if (loading()) {
      <div class="page page-enter">
        <div class="skeleton skeleton--card" style="height: 8rem"></div>
        <div class="skeleton skeleton--card" style="height: 12rem"></div>
      </div>
    } @else if (patent(); as p) {
      <article class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/patents" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All patents</span>
          </a>
        </nav>

        <header class="hero">
          <p class="eyebrow">Patent · {{ p.patent_number }}</p>
          <div class="hero__row">
            <h1 class="hero__title">
              {{ p.title_en || '(untitled publication)' }}
            </h1>
            @if (appConfig.canWrite()) {
              <div class="hero__actions">
                <button
                  type="button"
                  class="ghost-btn"
                  (click)="editPatent(p)"
                  matTooltip="Edit patent"
                  aria-label="Edit patent"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  type="button"
                  class="ghost-btn ghost-btn--danger"
                  (click)="deletePatent(p)"
                  matTooltip="Delete patent"
                  aria-label="Delete patent"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            }
          </div>
          <dl class="meta">
            @if (p.kind_code) {
              <div class="meta__group">
                <dt>Kind</dt>
                <dd class="mono">{{ p.kind_code }}</dd>
              </div>
            }
            @if (p.publication_date) {
              <div class="meta__group">
                <dt>Published</dt>
                <dd class="mono">{{ formatDate(p.publication_date) }}</dd>
              </div>
            }
            @if (p.filing_date) {
              <div class="meta__group">
                <dt>Filed</dt>
                <dd class="mono">{{ formatDate(p.filing_date) }}</dd>
              </div>
            }
            @if (p.application_number) {
              <div class="meta__group">
                <dt>Application</dt>
                <dd class="mono">{{ p.application_number }}</dd>
              </div>
            }
            @if (p.main_ipc) {
              <div class="meta__group">
                <dt>Main IPC</dt>
                <dd class="mono">{{ p.main_ipc }}</dd>
              </div>
            }
            @if (p.language) {
              <div class="meta__group">
                <dt>Language</dt>
                <dd class="mono">{{ p.language }}</dd>
              </div>
            }
          </dl>
        </header>

        <section class="party">
          <header class="party__head">
            <h3 class="section-title">Applicants</h3>
            <span class="count mono">{{ applicants().length }}</span>
          </header>
          @if (applicants().length === 0) {
            <p class="empty">No applicants recorded.</p>
          } @else {
            <ol class="row-list">
              @for (a of applicants(); track a.id) {
                <li class="row">
                  <span class="row__seq mono">
                    {{ ('0' + (a.sequence ?? $index + 1)).slice(-2) }}
                  </span>
                  <span class="row__title">{{ a.name }}</span>
                  @if (a.country) {
                    <span class="pill pill--lime">{{ a.country }}</span>
                  }
                </li>
              }
            </ol>
          }
        </section>

        <section class="party">
          <header class="party__head">
            <h3 class="section-title">Inventors</h3>
            <span class="count mono">{{ inventors().length }}</span>
          </header>
          @if (inventors().length === 0) {
            <p class="empty">No inventors recorded.</p>
          } @else {
            <ol class="row-list">
              @for (inv of inventors(); track inv.id) {
                <li class="row">
                  <span class="row__seq mono">
                    {{ ('0' + (inv.sequence ?? $index + 1)).slice(-2) }}
                  </span>
                  <span class="row__title">{{ inv.name }}</span>
                  @if (inv.country) {
                    <span class="pill">{{ inv.country }}</span>
                  }
                </li>
              }
            </ol>
          }
        </section>

        <section class="party">
          <header class="party__head">
            <h3 class="section-title">Classifications</h3>
            <span class="count mono">{{ classifications().length }}</span>
          </header>
          @if (classifications().length === 0) {
            <p class="empty">No classifications recorded.</p>
          } @else {
            <ul class="chips">
              @for (c of classifications(); track c.id) {
                <li class="chip">
                  <span class="chip__symbol mono">{{ c.symbol }}</span>
                  <span class="pill pill--amber">{{ c.scheme }}</span>
                </li>
              }
            </ul>
          }
        </section>
      </article>
    } @else {
      <div class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/patents" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All patents</span>
          </a>
        </nav>
        <div class="empty">
          <p class="eyebrow">404</p>
          <h2 class="section-title">Patent not found.</h2>
          <p class="muted">
            It may have been deleted or you may have followed a broken link.
          </p>
        </div>
      </div>
    }
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
      max-width: 56rem;
    }

    .crumbs { display: flex; align-items: center; }

    .crumbs__back {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-muted);
      transition: color var(--d-1) var(--ease-out);
    }

    .crumbs__back mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: transform var(--d-1) var(--ease-out);
    }

    .crumbs__back:hover { color: var(--accent); }
    .crumbs__back:hover mat-icon { transform: translateX(-2px); }

    .hero {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .hero__row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(1.875rem, 4vw, 2.75rem);
      letter-spacing: -0.035em;
      line-height: 1.05;
      color: var(--cream);
      margin: 0;
      flex: 1 1 auto;
      min-width: 0;
    }

    .hero__actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .ghost-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      background: transparent;
      color: var(--cream-muted);
      border: 1px solid var(--ink-border-soft);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .ghost-btn:hover {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .ghost-btn--danger:hover {
      color: var(--rose);
      border-color: rgba(251, 113, 133, 0.35);
    }

    .ghost-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--ink-border-soft);
      margin: 0;
    }

    .meta__group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .meta dt {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .meta dd {
      margin: 0;
      color: var(--cream);
      font-size: 0.9375rem;
    }

    .party {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .party__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
    }

    .count { color: var(--cream-dim); }

    .section-title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .empty {
      color: var(--cream-muted);
      padding: 0.5rem 0;
    }

    .muted { color: var(--cream-muted); }

    .row-list {
      list-style: none;
      padding: 0;
      margin: 0;
      border-top: 1px solid var(--ink-border-soft);
    }

    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 0.25rem;
      border-bottom: 1px solid var(--ink-border-soft);
    }

    .row__seq {
      font-size: var(--text-caption);
      letter-spacing: 0.12em;
      color: var(--cream-dim);
    }

    .row__title {
      font-size: var(--text-body);
      color: var(--cream);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.625rem;
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
    }

    .chip__symbol {
      font-size: var(--text-small);
      color: var(--cream);
    }
  `,
})
export class PatentDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly patent = signal<Patent | null>(null);
  protected readonly applicants = signal<Applicant[]>([]);
  protected readonly inventors = signal<Inventor[]>([]);
  protected readonly classifications = signal<Classification[]>([]);
  protected readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const [patent, applicants, inventors, classifications] =
        await Promise.all([
          this.data.getPatent(id),
          this.data.applicantsForPatent(id),
          this.data.inventorsForPatent(id),
          this.data.classificationsForPatent(id),
        ]);
      this.patent.set(patent);
      this.applicants.set(applicants);
      this.inventors.set(inventors);
      this.classifications.set(classifications);
    } finally {
      this.loading.set(false);
    }
  }

  protected editPatent(p: Patent): void {
    const ref = this.dialog.open<
      PatentFormDialog,
      PatentDialogData,
      PatentFormResult
    >(PatentFormDialog, { width: '34rem', data: { patent: p } });
    ref.afterClosed().subscribe(async (result) => {
      if (!result) return;
      try {
        await this.data.updatePatent(p.id, {
          ...result,
          ipc_section:
            result.main_ipc?.trim().charAt(0).toUpperCase() || undefined,
        });
        await this.refresh();
      } catch (err) {
        this.snack.open(
          err instanceof Error ? err.message : String(err),
          'Dismiss',
          { duration: 5000 }
        );
      }
    });
  }

  protected async deletePatent(p: Patent): Promise<void> {
    if (!confirm(`Delete patent "${p.patent_number}" and all its parties?`))
      return;
    try {
      for (const a of this.applicants()) await this.data.deleteApplicant(a.id);
      for (const i of this.inventors()) await this.data.deleteInventor(i.id);
      for (const c of this.classifications())
        await this.data.deleteClassification(c.id);
      await this.data.deletePatent(p.id);
      await this.router.navigate(['/patents']);
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 5000 }
      );
    }
  }

  protected formatDate(d: Date | string | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
