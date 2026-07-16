import { Injectable, computed, signal } from '@angular/core';

import type { AppConfig } from '../../../rayfin/data/schema';
import { envVar } from '../../services/env';
import { getRayfinClient } from '../../services/rayfinClient';

import { APP_CONFIG_ID } from './constants';

type SyncMode = 'pending' | 'seeded' | 'cdc';

// The SDK's `findById` / default field selection only returns the primary
// key, so we have to be explicit about which columns to load.
const APP_CONFIG_FIELDS = ['id', 'sync_mode', 'last_synced_at'] as const;

/** Singleton-row configuration store. */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly _config = signal<AppConfig | null>(null);
  private readonly _loaded = signal(false);

  readonly config = this._config.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * Effective sync mode, honouring the optional `.env` override
   * (`VITE_SYNC_MODE`) over the DB row.
   * - `seeded` = curated point-in-time snapshot (editable).
   * - `cdc`    = live CDC STATE System sync (read-only).
   */
  readonly mode = computed<SyncMode>(() => {
    const envOverride = envVar(
      () => import.meta.env.VITE_SYNC_MODE
    )?.toLowerCase();
    if (envOverride === 'seeded' || envOverride === 'cdc') return envOverride;
    return this._config()?.sync_mode ?? 'pending';
  });

  /** True when the UI may show create/edit/delete affordances. */
  readonly canWrite = computed(() => this.mode() === 'seeded');

  /** True when synced live from the CDC STATE System. */
  readonly isSynced = computed(() => this.mode() === 'cdc');

  /** Last successful sync timestamp (DB-truth; never overridden by env). */
  readonly lastSyncedAt = computed(() => this._config()?.last_synced_at ?? null);

  async load(force = false): Promise<void> {
    if (this._loaded() && !force) return;
    this._config.set(await this.fetchSingleton());
    this._loaded.set(true);
  }

  /**
   * Set sync mode. Creates the singleton row on first call; tolerates a
   * concurrent first-create race by falling through to update. Optimistically
   * updates the local cache so the next route resolution doesn't bounce back
   * to /setup even if the refetch is slow or fails.
   */
  async setMode(mode: 'seeded' | 'cdc'): Promise<void> {
    const client = getRayfinClient();
    const existing = this._config();
    if (existing) {
      await client.data.AppConfig.update({ id: APP_CONFIG_ID }, { sync_mode: mode });
    } else {
      try {
        await client.data.AppConfig.create({ id: APP_CONFIG_ID, sync_mode: mode });
      } catch {
        await client.data.AppConfig.update({ id: APP_CONFIG_ID }, { sync_mode: mode });
      }
    }
    // Optimistic write: ensure the in-memory cache reflects the new mode
    // immediately so the very next setupGuard run doesn't redirect back to
    // /setup just because the refetch was slow / empty.
    this._config.set({
      ...(existing ?? { id: APP_CONFIG_ID }),
      sync_mode: mode,
    });
    this._loaded.set(true);
    // Then reconcile with the server so other fields (last_synced_at) come
    // along too. A failed refetch is non-fatal — we already have a usable
    // local copy.
    try {
      const fresh = await this.fetchSingleton();
      if (fresh) this._config.set(fresh);
    } catch (err) {
      if (err instanceof Error)
        console.warn('AppConfig refetch after setMode failed:', err.message);
    }
  }

  /** Patch fields on the singleton row in-place. */
  async patch(patch: Partial<Pick<AppConfig, 'last_synced_at'>>): Promise<void> {
    const client = getRayfinClient();
    await client.data.AppConfig.update({ id: APP_CONFIG_ID }, patch);
    this._config.set(await this.fetchSingleton());
  }

  /** Wipe local cache (used by tests). */
  _resetForTest(): void {
    this._config.set(null);
    this._loaded.set(false);
  }

  /**
   * Fetch the singleton row with all fields populated. Returns null when
   * the row does not exist yet (first launch).
   */
  private async fetchSingleton(): Promise<AppConfig | null> {
    return getRayfinClient()
      .data.AppConfig.select([...APP_CONFIG_FIELDS])
      .where({ id: { eq: APP_CONFIG_ID } })
      .findFirst();
  }
}
