import { Injectable, inject } from '@angular/core';
import { v5 as uuidv5 } from 'uuid';

import { getRayfinClient } from '../../services/rayfinClient';

import {
  FDA_MILESTONES,
  SEED_BASELINE_ITEMS,
  SEED_ITEMS,
  SEED_NAMESPACE_UUID,
  SEED_TAX_ITEMS,
  US_STATE_NAMES,
  type SeedItem,
} from './constants';
import { DataService } from './data.service';
import { PricingService } from './pricing.service';
import { ensurePrograms, programId } from './programs';

export interface SeedResult {
  programs: number;
  items: number;
  signals: number;
}

/**
 * Curated snapshot loader. The curated **facts** (statewide flavor bans, PMTA
 * registry laws, and federal FDA milestones) have no clean public API, so they
 * are hardcoded and loaded in BOTH modes — seeded mode and live CDC mode — so
 * the Pricing Signal always has its ban/registry dimensions. Seeded mode ALSO
 * loads a curated tax sample (in CDC mode the live tax dataset supplies that).
 * Deterministic UUID v5 ids keep re-seeds idempotent.
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private readonly data = inject(DataService);
  private readonly pricing = inject(PricingService);

  /** Seeded-mode entry point: curated facts + tax sample, then compute signals. */
  async seedAll(): Promise<SeedResult> {
    const items = await this.seedCuratedFacts({ includeTaxSample: true });
    const all = await this.data.listItems();
    const { signals } = await this.pricing.recompute(all);
    return { programs: 3, items, signals };
  }

  /**
   * Seed the three Programs + the curated facts (flavor bans, PMTA registry,
   * FDA milestones). Shared by seeded mode and the CDC sync. Returns the number
   * of curated RegulatoryItem rows written. Does NOT compute Pricing Signals —
   * the caller does that after any additional (e.g. CDC) rows are loaded.
   */
  async seedCuratedFacts(opts: { includeTaxSample: boolean }): Promise<number> {
    await ensurePrograms();
    const client = getRayfinClient();
    let items = 0;

    const stateSeeds: readonly SeedItem[] = opts.includeTaxSample
      ? [...SEED_ITEMS, ...SEED_TAX_ITEMS, ...SEED_BASELINE_ITEMS]
      : SEED_ITEMS;

    // Curated state provisions (flavor bans, PMTA registry laws, tax sample).
    for (const seed of stateSeeds) {
      for (const program of seed.programs) {
        const id = uuidv5(
          `${seed.category}#${seed.state}#${program}#${seed.slug}`,
          SEED_NAMESPACE_UUID
        );
        const payload = {
          title: seed.title,
          state: seed.state,
          state_name: US_STATE_NAMES[seed.state] ?? seed.state,
          category: seed.category,
          status: seed.status,
          provision_value: seed.provision_value,
          effective_date: seed.effective_date
            ? new Date(seed.effective_date)
            : undefined,
          source_url: seed.source_url,
          labels_json: JSON.stringify(['Curated', program]),
          created_at: new Date(),
          updated_at: new Date(),
          program: { id: programId(program) },
        };
        await client.data.RegulatoryItem.upsert({ id }, { id, ...payload }, payload);
        items++;
      }
    }

    // Federal FDA milestone rows (Program-level, state = 'US').
    for (const m of FDA_MILESTONES) {
      const id = uuidv5(`fda#${m.program}#${m.slug}`, SEED_NAMESPACE_UUID);
      const payload = {
        title: m.title,
        state: 'US',
        state_name: 'United States',
        category: 'pmta_registry' as const,
        status: m.status,
        provision_value: m.provision_value,
        source_url: m.source_url,
        enacted_date: m.enacted_date ? new Date(m.enacted_date) : undefined,
        labels_json: JSON.stringify(['Federal', 'FDA', m.program]),
        created_at: new Date(),
        updated_at: new Date(),
        program: { id: programId(m.program) },
      };
      await client.data.RegulatoryItem.upsert({ id }, { id, ...payload }, payload);
      items++;
    }

    return items;
  }
}
