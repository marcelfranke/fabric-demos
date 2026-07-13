import { Injectable, inject } from '@angular/core';

import { AppConfigService } from './app-config.service';
import { DataService } from './data.service';
import {
  type SchemeFact,
  type TrendFact,
  type TrendsData,
  LiveDataService,
} from './live-data.service';

export type {
  SchemeFact,
  TrendBasis,
  TrendFact,
  TrendsData,
} from './live-data.service';

/** Time bucket granularity for the trends chart. */
export type Granularity = 'month' | 'quarter' | 'year';

/**
 * Loads the "applications over time" facts, from the Fabric-synced
 * `trends.json` in live mode, or derived in-memory from the seeded Patent
 * rows in sample/empty mode — so the page works offline for `npm run dev`.
 *
 * All read-only; nothing here writes.
 */
@Injectable({ providedIn: 'root' })
export class TrendsService {
  private readonly appConfig = inject(AppConfigService);
  private readonly live = inject(LiveDataService);
  private readonly data = inject(DataService);

  private cache?: Promise<TrendsData>;

  load(): Promise<TrendsData> {
    this.cache ??= this.appConfig.mode() === 'live'
      ? this.live.trends()
      : this.deriveFromSeed();
    return this.cache;
  }

  /** Build the same fact shape from the ~handful of seeded patents. */
  private async deriveFromSeed(): Promise<TrendsData> {
    const patents = await this.data.listPatents();
    const pubFacts = new Map<string, TrendFact>();
    const filFacts = new Map<string, TrendFact>();
    const pubScheme = new Map<string, SchemeFact>();
    const filScheme = new Map<string, SchemeFact>();

    for (const p of patents) {
      const pubPeriod = monthOf(p.publication_date);
      const filPeriod = monthOf(p.filing_date);
      const section = p.ipc_section?.trim().charAt(0).toUpperCase() || null;
      const pubCountry = p.publication_country ?? null;
      const appCountry = p.applicant_country ?? null;

      if (pubPeriod)
        addFact(pubFacts, pubPeriod, section, pubCountry, appCountry);
      if (filPeriod)
        addFact(filFacts, filPeriod, section, pubCountry, appCountry);

      const classifications = await this.data.classificationsForPatent(p.id);
      for (const c of classifications) {
        const scheme = c.scheme ?? null;
        const cSection = c.section?.trim().charAt(0).toUpperCase() || null;
        if (pubPeriod) addScheme(pubScheme, pubPeriod, scheme, cSection);
        if (filPeriod) addScheme(filScheme, filPeriod, scheme, cSection);
      }
    }

    const periods = [
      ...new Set([...pubFacts.values(), ...filFacts.values()].map((f) => f.period)),
    ].sort();

    return {
      periods,
      publication: {
        facts: [...pubFacts.values()],
        scheme: [...pubScheme.values()],
      },
      filing: {
        facts: [...filFacts.values()],
        scheme: [...filScheme.values()],
      },
    };
  }
}

function monthOf(v: Date | string | undefined | null): string | null {
  if (!v) return null;
  const s = typeof v === 'string' ? v : v.toISOString();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}` : null;
}

function addFact(
  map: Map<string, TrendFact>,
  period: string,
  section: string | null,
  pubCountry: string | null,
  appCountry: string | null
): void {
  const key = `${period}|${section ?? ''}|${pubCountry ?? ''}|${appCountry ?? ''}`;
  const existing = map.get(key);
  if (existing) existing.count += 1;
  else map.set(key, { period, section, pubCountry, appCountry, count: 1 });
}

function addScheme(
  map: Map<string, SchemeFact>,
  period: string,
  scheme: string | null,
  section: string | null
): void {
  const key = `${period}|${scheme ?? ''}|${section ?? ''}`;
  const existing = map.get(key);
  if (existing) existing.count += 1;
  else map.set(key, { period, scheme, section, count: 1 });
}

/** Roll a "YYYY-MM" month bucket up to the requested granularity. */
export function bucketOf(month: string, gran: Granularity): string {
  if (gran === 'year') return month.slice(0, 4);
  if (gran === 'quarter') {
    const y = month.slice(0, 4);
    const m = Number(month.slice(5, 7));
    return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  }
  return month;
}
