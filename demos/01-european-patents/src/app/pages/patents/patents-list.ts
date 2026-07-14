import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import type { Patent } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';

export interface PatentDialogData {
  patent?: Patent;
}

export interface PatentFormResult {
  patent_number: string;
  title_en?: string;
  main_ipc?: string;
  first_applicant?: string;
  applicant_country?: string;
  kind_code?: string;
  publication_date?: Date;
}

@Component({
  selector: 'app-patent-form-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="dlg">
      <p class="eyebrow">{{ isEdit ? 'Edit patent' : 'New patent' }}</p>
      <h2 class="dlg__title">
        {{ isEdit ? 'Update the details.' : 'Record a publication.' }}
      </h2>
      <mat-dialog-content class="dlg__body">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Publication number</mat-label>
          <input
            matInput
            [(ngModel)]="patentNumber"
            required
            maxlength="40"
            placeholder="EP1234567"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Title (EN)</mat-label>
          <textarea
            matInput
            [(ngModel)]="titleEn"
            rows="2"
            maxlength="1000"
          ></textarea>
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Main IPC</mat-label>
            <input matInput [(ngModel)]="mainIpc" maxlength="40" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Kind code</mat-label>
            <input matInput [(ngModel)]="kindCode" maxlength="8" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>First applicant</mat-label>
            <input matInput [(ngModel)]="firstApplicant" maxlength="300" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Applicant country</mat-label>
            <input matInput [(ngModel)]="applicantCountry" maxlength="4" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Publication date</mat-label>
          <input matInput type="date" [(ngModel)]="publicationDate" />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="dlg__actions">
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          type="button"
          class="dlg__cta"
          [disabled]="!patentNumber.trim()"
          (click)="save()"
        >
          {{ isEdit ? 'Save changes' : 'Create patent' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: `
    .dlg {
      padding: 1.5rem 1.75rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .dlg__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 400;
      font-size: 1.75rem;
      letter-spacing: -0.025em;
      margin: 0 0 0.25rem;
      color: var(--cream);
    }
    .dlg__body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem 0 0 !important;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .dlg__actions { padding: 0 !important; gap: 0.5rem; }
    .dlg__cta {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      height: 2.5rem;
      padding: 0 1rem;
      background: var(--accent);
      color: var(--ink-bg);
      border: 1px solid var(--accent);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      letter-spacing: -0.005em;
      transition: transform var(--d-1) var(--ease-out),
        box-shadow var(--d-1) var(--ease-out);
    }
    .dlg__cta:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 10px 26px -10px var(--accent-glow);
    }
    .dlg__cta[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .full { width: 100%; }
  `,
})
export class PatentFormDialog {
  private readonly dialogRef =
    inject(MatDialogRef<PatentFormDialog, PatentFormResult>);
  private readonly data =
    inject<PatentDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  protected readonly isEdit = !!this.data.patent;
  protected patentNumber = this.data.patent?.patent_number ?? '';
  protected titleEn = this.data.patent?.title_en ?? '';
  protected mainIpc = this.data.patent?.main_ipc ?? '';
  protected kindCode = this.data.patent?.kind_code ?? '';
  protected firstApplicant = this.data.patent?.first_applicant ?? '';
  protected applicantCountry = this.data.patent?.applicant_country ?? '';
  protected publicationDate = this.data.patent?.publication_date
    ? new Date(this.data.patent.publication_date).toISOString().slice(0, 10)
    : '';

  protected save(): void {
    const ipc = this.mainIpc.trim();
    this.dialogRef.close({
      patent_number: this.patentNumber.trim(),
      title_en: this.titleEn.trim() || undefined,
      main_ipc: ipc || undefined,
      first_applicant: this.firstApplicant.trim() || undefined,
      applicant_country: this.applicantCountry.trim().toUpperCase() || undefined,
      kind_code: this.kindCode.trim() || undefined,
      publication_date: this.publicationDate
        ? new Date(this.publicationDate)
        : undefined,
    });
  }
}

@Component({
  selector: 'app-patents-list',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">Workspace</p>
          <h1 class="head__title">Patents.</h1>
          <p class="head__lead">
            {{ patents().length }}
            {{ patents().length === 1 ? 'publication' : 'publications' }}
          </p>
        </div>
        @if (appConfig.canWrite()) {
          <button type="button" class="primary-btn" (click)="newPatent()">
            <mat-icon>add</mat-icon>
            <span>New patent</span>
          </button>
        }
      </header>

      @if (loading()) {
        <div class="cards">
          @for (n of skeletonItems; track n) {
            <div class="skeleton skeleton--card"></div>
          }
        </div>
      } @else if (patents().length === 0) {
        <div class="empty">
          <p class="eyebrow">No patents</p>
          <h2 class="empty__title">A blank register.</h2>
          <p class="empty__lead">
            Record European patent publications with their applicants,
            inventors and classifications.
          </p>
          @if (appConfig.canWrite()) {
            <button type="button" class="primary-btn" (click)="newPatent()">
              <mat-icon>add</mat-icon>
              <span>Add a patent</span>
            </button>
          }
        </div>
      } @else {
        <div class="cards">
          @for (p of patents(); track p.id) {
            <a class="card" [routerLink]="['/patents', p.id]">
              <div class="card__head">
                <span class="card__num mono">{{ p.patent_number }}</span>
                @if (p.ipc_section) {
                  <span class="pill pill--lime">{{ p.ipc_section }}</span>
                }
              </div>
              <h3 class="card__title">
                {{ p.title_en || '(untitled publication)' }}
              </h3>
              <div class="card__meta">
                @if (p.first_applicant) {
                  <span class="mono dim">{{ p.first_applicant }}</span>
                }
                @if (p.main_ipc) {
                  <span class="pill pill--amber">{{ p.main_ipc }}</span>
                }
              </div>
              <footer class="card__foot">
                <span class="mono dim">
                  @if (p.publication_date) {
                    Published {{ formatDate(p.publication_date) }}
                  } @else {
                    {{ p.kind_code || 'EP' }}
                  }
                </span>
                <span class="card__arrow">
                  <mat-icon>north_east</mat-icon>
                </span>
              </footer>
              @if (appConfig.canWrite()) {
                <button
                  type="button"
                  class="card__delete"
                  (click)="remove($event, p)"
                  aria-label="Delete patent"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }

    .head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
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

    .primary-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      height: 2.75rem;
      padding: 0 1.125rem;
      background: var(--accent);
      color: var(--ink-bg);
      border: 1px solid var(--accent);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      letter-spacing: -0.005em;
      transition: transform var(--d-1) var(--ease-out),
        box-shadow var(--d-1) var(--ease-out);
    }

    .primary-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 36px -12px rgba(212, 255, 58, 0.5);
    }

    .primary-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
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

    .empty__lead {
      color: var(--cream-muted);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
      gap: 1rem;
    }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      padding: 1.5rem;
      min-width: 0;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      color: var(--cream);
      min-height: 14rem;
      transition: border-color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out);
    }

    .card:hover {
      border-color: var(--accent-border);
      transform: translateY(-2px);
      color: var(--cream);
    }

    .card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .card__num {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.06em;
      color: var(--cream-dim);
    }

    .card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.35rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
      line-height: 1.2;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card__meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      min-width: 0;
    }

    .card__meta .mono {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: auto;
      padding-top: 0.75rem;
      border-top: 1px solid var(--ink-border-soft);
      min-width: 0;
    }

    .card__foot .mono {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card__arrow {
      color: var(--cream-dim);
      transition: color var(--d-1) var(--ease-out),
        transform var(--d-1) var(--ease-out);
    }

    .card:hover .card__arrow {
      color: var(--accent);
      transform: translate(2px, -2px);
    }

    .card__arrow mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .card__delete {
      position: absolute;
      top: 0.875rem;
      right: 0.875rem;
      width: 1.75rem;
      height: 1.75rem;
      background: transparent;
      color: var(--cream-dim);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--d-1) var(--ease-out),
        color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .card:hover .card__delete {
      opacity: 1;
    }

    .card__delete:hover {
      color: var(--rose);
      border-color: rgba(251, 113, 133, 0.25);
    }

    .card__delete mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `,
})
export class PatentsList implements OnInit {
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly patents = signal<Patent[]>([]);
  protected readonly loading = signal(true);
  protected readonly skeletonItems = [0, 1, 2, 3, 4, 5];

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.patents.set(await this.data.listPatents());
    } finally {
      this.loading.set(false);
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

  protected ipcSection(ipc: string | undefined): string | undefined {
    return ipc?.trim().charAt(0).toUpperCase() || undefined;
  }

  protected newPatent(): void {
    const ref = this.dialog.open(PatentFormDialog, {
      width: '34rem',
      panelClass: 'atelier-dialog',
    });
    ref.afterClosed().subscribe(async (result: PatentFormResult | undefined) => {
      if (!result) return;
      try {
        await this.data.createPatent({
          ...result,
          publication_country: 'EP',
          ipc_section: this.ipcSection(result.main_ipc),
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

  protected async remove(ev: Event, p: Patent): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm(`Delete patent "${p.patent_number}" and all its parties?`))
      return;
    try {
      const [applicants, inventors, classifications] = await Promise.all([
        this.data.applicantsForPatent(p.id),
        this.data.inventorsForPatent(p.id),
        this.data.classificationsForPatent(p.id),
      ]);
      for (const a of applicants) await this.data.deleteApplicant(a.id);
      for (const i of inventors) await this.data.deleteInventor(i.id);
      for (const c of classifications)
        await this.data.deleteClassification(c.id);
      await this.data.deletePatent(p.id);
      await this.refresh();
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 5000 }
      );
    }
  }
}
