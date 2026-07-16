import { Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'dashboard.theme';
const ATTR = 'data-theme';
const DEFAULT_THEME: Theme = 'light';

/**
 * Signal-based theme store.
 *
 * Resolution order:
 *   1. Attribute already set on `<html>` by the inline boot script.
 *   2. Manual override stored in `localStorage[dashboard.theme]`.
 *   3. Light (PMI brand) as the unconditional default.
 *
 * Light PMI is the brand identity, so the app ALWAYS opens light unless the
 * user has explicitly stored a manual preference. The OS `prefers-color-scheme`
 * is intentionally NOT consulted — a dark-mode machine still opens in light
 * PMI branding. The manual dark toggle still works and persists to
 * `localStorage`; there is no automatic OS follow.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(readInitial());
  readonly theme = this._theme.asReadonly();

  /** Flip dark ↔ light. The choice persists to `localStorage`. */
  toggle(): void {
    this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this._theme.set(theme);
    applyAttr(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore — private mode, full storage, etc.
    }
  }

  /** Forget the manual preference and snap back to the light PMI default. */
  resetToDefault(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
    this._theme.set(DEFAULT_THEME);
    applyAttr(DEFAULT_THEME);
  }
}

function readInitial(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute(ATTR);
    if (attr === 'light' || attr === 'dark') return attr;
  }
  const stored = manualOverride();
  if (stored) return stored;
  return DEFAULT_THEME;
}

function manualOverride(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Ignore.
  }
  return null;
}

function applyAttr(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(ATTR, theme);
}
