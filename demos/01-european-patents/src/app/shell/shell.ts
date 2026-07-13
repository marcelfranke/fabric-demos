import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs/operators';

import { AuthState } from '../services/auth-state';
import { ThemeService } from '../services/theme.service';

const STORAGE_KEY = 'dashboard.sidenav.collapsed';

// Static route → label map for the topbar page title. Subroutes fall back
// to their first segment's label (e.g. /patents/abc → "Patents").
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/patents': 'Patents',
  '/applicants': 'Applicants',
  '/settings': 'Settings',
};

@Component({
  selector: 'app-shell',
  imports: [
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  template: `
    <div class="shell" [class.shell--collapsed]="collapsed()">
      <aside class="rail" [class.rail--collapsed]="collapsed()">
        <a routerLink="/" class="brand" aria-label="Dashboard home">
          <span class="brand__mark" aria-hidden="true">
            <mat-icon>article</mat-icon>
          </span>
          <span class="brand__name">EP&nbsp;Patents</span>
        </a>

        <nav class="nav">
          <a
            routerLink="/"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            class="nav__item"
            [matTooltip]="collapsed() ? 'Dashboard' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="nav__icon">dashboard</mat-icon>
            <span class="nav__label">Dashboard</span>
          </a>
          <a
            routerLink="/patents"
            routerLinkActive="active"
            class="nav__item"
            [matTooltip]="collapsed() ? 'Patents' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="nav__icon">description</mat-icon>
            <span class="nav__label">Patents</span>
          </a>
          <a
            routerLink="/applicants"
            routerLinkActive="active"
            class="nav__item"
            [matTooltip]="collapsed() ? 'Applicants' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="nav__icon">domain</mat-icon>
            <span class="nav__label">Applicants</span>
          </a>
        </nav>

        <div class="rail__footer">
          <a
            routerLink="/settings"
            routerLinkActive="active"
            class="nav__item"
            [matTooltip]="collapsed() ? 'Settings' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="nav__icon">settings</mat-icon>
            <span class="nav__label">Settings</span>
          </a>
          <button
            type="button"
            class="rail__collapse"
            (click)="toggleCollapsed()"
            [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'"
            [matTooltip]="collapsed() ? 'Expand' : 'Collapse'"
            matTooltipPosition="right"
          >
            <mat-icon>{{ collapsed() ? 'chevron_right' : 'chevron_left' }}</mat-icon>
          </button>
        </div>
      </aside>

      <div class="frame">
        <header class="topbar">
          <div class="topbar__crumbs">
            <span class="eyebrow">{{ section() }}</span>
            <span class="topbar__sep" aria-hidden="true">/</span>
            <span class="topbar__current">{{ pageTitle() }}</span>
          </div>

          <div class="topbar__actions">
            <button
              type="button"
              class="ghost-btn"
              (click)="theme.toggle()"
              [matTooltip]="
                theme.theme() === 'dark' ? 'Switch to light' : 'Switch to dark'
              "
              aria-label="Toggle theme"
            >
              <mat-icon>
                {{ theme.theme() === 'dark' ? 'light_mode' : 'dark_mode' }}
              </mat-icon>
            </button>
            <button
              type="button"
              class="ghost-btn"
              [matMenuTriggerFor]="userMenu"
              aria-label="Account menu"
            >
              <mat-icon>account_circle</mat-icon>
            </button>
            <mat-menu #userMenu xPosition="before">
              <button mat-menu-item (click)="signOut()">
                <mat-icon>logout</mat-icon>
                <span>Sign out</span>
              </button>
            </mat-menu>
          </div>
        </header>

        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }

    .shell {
      display: grid;
      grid-template-columns: 240px 1fr;
      min-height: 100vh;
      transition: grid-template-columns var(--d-3) var(--ease-out);
    }

    .shell--collapsed {
      grid-template-columns: 64px 1fr;
    }

    /* ── Rail / sidebar (fixed) ──────────────────────────────────── */
    .rail {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 240px;
      box-sizing: border-box;
      z-index: 6;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--ink-border);
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.015),
          transparent 40%
        ),
        var(--ink-bg);
      padding: 1.25rem 0.75rem 1rem;
      gap: 1.5rem;
      overflow-y: auto;
      overflow-x: hidden;
      transition: width var(--d-3) var(--ease-out);
    }

    .shell--collapsed .rail,
    .rail--collapsed {
      width: 64px;
    }

    .rail--collapsed .nav__label {
      width: 0;
      overflow: hidden;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0 0.5rem 0.25rem;
      color: var(--cream);
      transition: color var(--d-1) var(--ease-out);
      white-space: nowrap;
      overflow: hidden;
    }

    .brand:hover {
      color: var(--accent);
    }

    .brand__mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.75rem;
      height: 1.75rem;
      flex-shrink: 0;
      color: var(--lime-on);
      background: var(--lime);
      border-radius: 7px;
      box-shadow: 0 0 0 1px rgba(212, 255, 58, 0.4),
        0 6px 16px -4px var(--accent-glow);
    }

    .brand__mark mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .brand__name {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 50, 'wght' 500;
      font-size: 1.375rem;
      letter-spacing: -0.02em;
      line-height: 1;
      transition: opacity var(--d-2) var(--ease-out);
    }

    .shell--collapsed .brand__name {
      opacity: 0;
      width: 0;
    }

    .nav {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      flex: 1;
    }

    .rail__footer {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      border-top: 1px solid var(--ink-border-soft);
      padding-top: 0.75rem;
    }

    .nav__item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.625rem;
      height: 2.5rem;
      border-radius: var(--radius-sm);
      color: var(--cream-muted);
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 500;
      letter-spacing: -0.005em;
      transition: color var(--d-1) var(--ease-out),
        background var(--d-1) var(--ease-out);
      white-space: nowrap;
      overflow: hidden;
    }

    .nav__item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      height: 0;
      width: 2px;
      background: var(--accent);
      transform: translateY(-50%);
      transition: height var(--d-2) var(--ease-out);
      border-radius: 0 2px 2px 0;
    }

    .nav__item:hover {
      color: var(--cream);
      background: var(--ink-elevated);
    }

    .nav__item.active {
      color: var(--cream);
      background: var(--ink-elevated);
    }

    .nav__item.active::before {
      height: 1.25rem;
    }

    .nav__icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      color: inherit;
    }

    .nav__label {
      transition: opacity var(--d-2) var(--ease-out);
    }

    .shell--collapsed .nav__label {
      opacity: 0;
    }

    .rail__collapse {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 2.25rem;
      background: transparent;
      color: var(--cream-dim);
      border: 1px solid var(--ink-border-soft);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .rail__collapse:hover {
      color: var(--cream);
      border-color: var(--ink-border);
    }

    .rail__collapse mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* ── Frame / topbar ────────────────────────────────────────── */
    .frame {
      grid-column: 2;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      height: 56px;
      padding: 0 2rem;
      background: color-mix(in srgb, var(--ink-bg) 70%, transparent);
      backdrop-filter: blur(20px) saturate(140%);
      -webkit-backdrop-filter: blur(20px) saturate(140%);
      border-bottom: 1px solid var(--ink-border);
    }

    .topbar__crumbs {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-width: 0;
    }

    .topbar__sep {
      color: var(--cream-dim);
      font-family: var(--font-mono);
    }

    .topbar__current {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.125rem;
      letter-spacing: -0.015em;
      color: var(--cream);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .topbar__actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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

    .ghost-btn:hover:not([disabled]) {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .ghost-btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .ghost-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .content {
      flex: 1;
      padding: 2.5rem 2rem 4rem;
      max-width: 100%;
      min-width: 0;
    }

    @media (max-width: 60rem) {
      .shell,
      .shell--collapsed {
        grid-template-columns: 64px 1fr;
      }

      .rail,
      .shell--collapsed .rail {
        width: 64px;
      }

      .brand__name,
      .nav__label {
        opacity: 0;
      }

      .rail__collapse {
        display: none;
      }

      .topbar {
        padding: 0 1rem;
      }

      .content {
        padding: 1.5rem 1rem 3rem;
      }
    }

    @media (max-width: 30rem) {
      .content {
        padding: 1.25rem 0.75rem 2.5rem;
      }

      .topbar__current {
        font-size: 1rem;
      }
    }
  `,
})
export class Shell implements OnInit {
  protected readonly theme = inject(ThemeService);
  private readonly authState = inject(AuthState);
  private readonly router = inject(Router);

  protected readonly collapsed = signal(
    typeof localStorage !== 'undefined' &&
      localStorage.getItem(STORAGE_KEY) === '1'
  );
  protected readonly currentUrl = signal(this.router.url);

  /** Topbar label — first segment lookup, falls back to dash. */
  protected readonly pageTitle = computed(() => {
    const url = this.currentUrl().split('?')[0];
    if (ROUTE_LABELS[url]) return ROUTE_LABELS[url];
    const first = '/' + (url.split('/').filter(Boolean)[0] ?? '');
    return ROUTE_LABELS[first] ?? 'Dashboard';
  });

  /** Static eyebrow label — what's to the left of the slash. */
  protected readonly section = computed(() => 'Workspace');

  ngOnInit(): void {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }

  protected toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore — private mode, full storage, etc.
    }
  }

  protected async signOut(): Promise<void> {
    await this.authState.signOut();
    await this.router.navigate(['/auth']);
  }
}
