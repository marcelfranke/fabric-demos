import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import type { Program, RegulatoryItem } from '../../../../rayfin/data/schema';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-programs-list',
  imports: [MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Product lines</p>
        <h1 class="title">Programs</h1>
        <p class="lead">
          PMI's smoke-free product lines and the state regulation each faces.
        </p>
      </header>

      @if (loading()) {
        <div class="grid">
          <div class="skeleton skeleton--card" style="height: 12rem"></div>
          <div class="skeleton skeleton--card" style="height: 12rem"></div>
          <div class="skeleton skeleton--card" style="height: 12rem"></div>
        </div>
      } @else {
        <div class="grid">
          @for (p of programs(); track p.id) {
            <a class="card" [routerLink]="['/programs', p.id]">
              <header class="card__top">
                <span class="badge">{{ p.product_code }}</span>
                <span class="card__count">{{ count(p.id) }} items</span>
              </header>
              <h2 class="card__title">{{ p.name }}</h2>
              @if (p.description) {
                <p class="card__desc">{{ p.description }}</p>
              }
              <span class="card__arrow"><mat-icon>north_east</mat-icon></span>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 2rem; }
    .head { display: flex; flex-direction: column; gap: 0.6rem; max-width: 44rem; }
    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1;
      letter-spacing: -0.035em;
      color: var(--cream);
      margin: 0;
    }
    .lead { color: var(--cream-muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: 1rem;
    }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1.75rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      text-decoration: none;
      transition: border-color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out);
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: var(--accent-border);
    }
    .card__top { display: flex; align-items: center; justify-content: space-between; }
    .badge {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.1em;
      padding: 0.25rem 0.55rem;
      border: 1px solid var(--accent-border);
      border-radius: var(--radius-pill);
      color: var(--accent);
    }
    .card__count {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--cream-dim);
    }
    .card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: 1.75rem;
      color: var(--cream);
      margin: 0;
    }
    .card__desc { color: var(--cream-muted); font-size: var(--text-small); }
    .card__arrow { color: var(--cream-dim); margin-top: auto; }
    .card:hover .card__arrow { color: var(--accent); }
    .card__arrow mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class ProgramsList implements OnInit {
  private readonly data = inject(DataService);

  protected readonly programs = signal<Program[]>([]);
  protected readonly items = signal<RegulatoryItem[]>([]);
  protected readonly loading = signal(true);

  protected readonly countByProgram = computed(() => {
    const map: Record<string, number> = {};
    for (const t of this.items()) {
      const id = t.program?.id;
      if (id) map[id] = (map[id] ?? 0) + 1;
    }
    return map;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [programs, items] = await Promise.all([
        this.data.listPrograms(),
        this.data.listItems(),
      ]);
      this.programs.set(programs);
      this.items.set(items);
    } finally {
      this.loading.set(false);
    }
  }

  protected count(programId: string): number {
    return this.countByProgram()[programId] ?? 0;
  }
}
