import { Injectable, inject } from '@angular/core';
import { v5 as uuidv5 } from 'uuid';

import type { RegulatoryItem } from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { AppConfigService } from './app-config.service';
import {
  CATEGORY_LABELS,
  CATEGORY_PROGRAM,
  CDC_DATASETS,
  CDC_NAMESPACE_UUID,
  CDC_ROW_LIMIT,
  SYNC_STALE_MS,
  US_STATE_NAMES,
  type CdcDataset,
  type RegulatoryCategory,
} from './constants';
import { DataService } from './data.service';
import { PricingService } from './pricing.service';
import { ensurePrograms, programId } from './programs';
import { SeedService } from './seed.service';

export interface SyncResult {
  created: number;
  updated: number;
  total: number;
  signals: number;
}

// Raw CDC row (union of standard + summary shapes; all values are strings).
interface CdcRow {
  year?: string;
  quarter?: string;
  locationabbr?: string;
  locationdesc?: string;
  topicdesc?: string;
  provisiondesc?: string;
  provisionvalue?: string;
  citation?: string;
  enacted_date?: string;
  effective_date?: string;
  provisionid?: string;
  measureid?: string;
  // summary-only
  private_worksites?: string;
  restaurants?: string;
  bars?: string;
  type_of_restriction?: string;
  geolocation?:
    | { latitude?: string; longitude?: string }
    | { type: 'Point'; coordinates: [number, number] }
    | null;
}

// Normalized intermediate row before it becomes a RegulatoryItem.
interface NormalizedRow {
  datasetId: string;
  category: RegulatoryCategory;
  state: string;
  provKey: string;
  year: number;
  quarter: number;
  title: string;
  status: RegulatoryItem['status'];
  provision_value?: string;
  citation?: string;
  enacted_date?: Date;
  effective_date?: Date;
  latitude?: string;
  longitude?: string;
}

/** Parse a CDC `M/D/YYYY` date string into a Date (undefined if unparseable). */
function parseUsDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const [, mo, day, yr] = m;
  const d = new Date(Number(yr), Number(mo) - 1, Number(day));
  return isNaN(d.getTime()) ? undefined : d;
}

function extractLatLng(geo: CdcRow['geolocation']): { lat?: string; lng?: string } {
  if (!geo) return {};
  if ('coordinates' in geo && Array.isArray(geo.coordinates)) {
    const [lng, lat] = geo.coordinates;
    return { lat: lat != null ? String(lat) : undefined, lng: lng != null ? String(lng) : undefined };
  }
  if ('latitude' in geo) {
    return { lat: geo.latitude, lng: geo.longitude };
  }
  return {};
}

function isEmptyValue(v?: string): boolean {
  if (!v) return true;
  const t = v.trim().toLowerCase();
  return t === '' || t === 'no provision' || t === 'none' || t === 'n/a';
}

/**
 * Idempotent CDC STATE System sync (mirrors the reference github-sync). Pulls
 * five public, no-key E-Cigarette legislation datasets, normalizes each row to
 * a RegulatoryItem, dedupes to the most-recent quarter per (state, provision),
 * and upserts with a deterministic UUID v5 id so re-syncs converge.
 */
@Injectable({ providedIn: 'root' })
export class CdcStateSyncService {
  private readonly appConfig = inject(AppConfigService);
  private readonly seed = inject(SeedService);
  private readonly pricing = inject(PricingService);
  private readonly data = inject(DataService);

  /** Run sync only if the last sync is older than SYNC_STALE_MS. */
  async maybeAutoSync(): Promise<SyncResult | null> {
    if (!this.appConfig.isSynced()) return null;
    const last = this.appConfig.lastSyncedAt();
    if (last) {
      const lastMs = new Date(last).getTime();
      if (Date.now() - lastMs < SYNC_STALE_MS) return null;
    }
    return this.syncNow();
  }

  /** Full sync across all CDC datasets. */
  async syncNow(): Promise<SyncResult> {
    await ensurePrograms();

    const normalized: NormalizedRow[] = [];
    for (const ds of CDC_DATASETS) {
      const rows = await this.fetchDataset(ds);
      for (const raw of rows) {
        const norm = this.normalize(ds, raw);
        if (norm) normalized.push(norm);
      }
    }

    // Dedupe to the most-recent (year, quarter) per dataset+state+provision.
    const latest = new Map<string, NormalizedRow>();
    for (const r of normalized) {
      const key = `${r.datasetId}#${r.state}#${r.provKey}`;
      const prev = latest.get(key);
      if (!prev || r.year > prev.year || (r.year === prev.year && r.quarter > prev.quarter)) {
        latest.set(key, r);
      }
    }

    const client = getRayfinClient();
    let created = 0;
    let updated = 0;
    let total = 0;

    for (const r of latest.values()) {
      const id = uuidv5(
        `${r.datasetId}#${r.state}#${r.provKey}#${r.year}Q${r.quarter}`,
        CDC_NAMESPACE_UUID
      );
      const payload = {
        title: r.title,
        state: r.state,
        state_name: US_STATE_NAMES[r.state] ?? r.state,
        category: r.category,
        status: r.status,
        provision_value: r.provision_value,
        citation: r.citation,
        enacted_date: r.enacted_date,
        effective_date: r.effective_date,
        latitude: r.latitude,
        longitude: r.longitude,
        labels_json: JSON.stringify([
          CATEGORY_LABELS[r.category],
          `${r.year} Q${r.quarter}`,
        ]),
        created_at: new Date(),
        updated_at: new Date(),
        program: { id: programId(CATEGORY_PROGRAM[r.category]) },
      };
      // Track create-vs-update for the result counter. Native upsert is
      // race-safe because deterministic ids converge across concurrent runs.
      const existed = await client.data.RegulatoryItem.findById(id);
      await client.data.RegulatoryItem.upsert({ id }, { id, ...payload }, payload);
      if (existed) updated++;
      else created++;
      total++;
    }

    await this.appConfig.patch({ last_synced_at: new Date() });

    // Merge the curated facts CDC lacks (statewide flavor bans, PMTA registry
    // laws, FDA milestones) — WITHOUT the curated tax sample, since live CDC
    // already supplies the tax dimension.
    await this.seed.seedCuratedFacts({ includeTaxSample: false });

    // Compute + persist the Gold Pricing Signals from the full (CDC + curated)
    // RegulatoryItem set so the pricing UI reads a fresh signal table.
    const all = await this.data.listItems();
    const { signals } = await this.pricing.recompute(all);

    return { created, updated, total, signals };
  }

  /** Fetch one dataset's JSON from the Socrata SODA endpoint (no API key). */
  private async fetchDataset(ds: CdcDataset): Promise<CdcRow[]> {
    const url = `https://data.cdc.gov/resource/${ds.id}.json?$limit=${CDC_ROW_LIMIT}&$order=year DESC`;
    const res = await fetch(url, {
      // Browsers forbid setting User-Agent, so identification falls back to the
      // default. The endpoint is public and needs no API key.
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('CDC SODA rate limit hit. Wait a moment and sync again.');
      }
      throw new Error(`CDC API error ${res.status} on ${ds.label}: ${res.statusText}`);
    }
    return (await res.json()) as CdcRow[];
  }

  /** Normalize a raw CDC row → NormalizedRow, or null to drop it. */
  private normalize(ds: CdcDataset, raw: CdcRow): NormalizedRow | null {
    const state = raw.locationabbr?.trim().toUpperCase();
    if (!state || !(state in US_STATE_NAMES)) return null; // drop territories + US national

    const year = Number(raw.year);
    const quarter = Number(raw.quarter);
    if (!Number.isFinite(year)) return null;

    const { lat, lng } = extractLatLng(raw.geolocation);
    const locationdesc = raw.locationdesc?.trim() || US_STATE_NAMES[state];
    const title = `${locationdesc} · ${CATEGORY_LABELS[ds.category]}`;
    const provKey = raw.provisionid || raw.measureid || raw.topicdesc || ds.id;

    if (ds.shape === 'summary') {
      const banned = [raw.private_worksites, raw.restaurants, raw.bars].some(
        (v) => v?.trim().toLowerCase() === 'banned'
      );
      return {
        datasetId: ds.id,
        category: ds.category,
        state,
        provKey,
        year,
        quarter: Number.isFinite(quarter) ? quarter : 0,
        title,
        status: banned ? 'enacted' : 'no_provision',
        provision_value: raw.type_of_restriction?.trim() || undefined,
        latitude: lat,
        longitude: lng,
      };
    }

    // standard shape
    const rawValue = raw.provisionvalue?.trim();
    const empty = isEmptyValue(rawValue);
    let provisionValue = empty ? undefined : rawValue;
    // Percent-value tax rows read better as a percentage.
    if (!empty && ds.category === 'tax' && /^\d+(\.\d+)?$/.test(rawValue ?? '')) {
      provisionValue = `${rawValue}%`;
    }
    return {
      datasetId: ds.id,
      category: ds.category,
      state,
      provKey,
      year,
      quarter: Number.isFinite(quarter) ? quarter : 0,
      title,
      status: empty ? 'no_provision' : 'enacted',
      provision_value: provisionValue,
      citation: raw.citation?.trim() || undefined,
      enacted_date: parseUsDate(raw.enacted_date),
      effective_date: parseUsDate(raw.effective_date),
      latitude: lat,
      longitude: lng,
    };
  }
}
