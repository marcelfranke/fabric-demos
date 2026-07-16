import { Injectable, inject } from '@angular/core';

import type {
  PricingSignal,
  Program,
  RegulatoryItem,
} from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { AppConfigService } from './app-config.service';
import type { ProductCode } from './constants';

type ProgramCreate = Omit<Program, 'id' | 'items'> & { id?: string };
type ProgramUpdate = Partial<Omit<Program, 'items'>>;
type RegulatoryItemCreate = Omit<RegulatoryItem, 'id' | 'program'> & {
  id?: string;
  program: { id: string };
};
type RegulatoryItemUpdate = Partial<Omit<RegulatoryItem, 'program'>> & {
  program?: { id: string };
};

// The SDK's default field selection only returns the primary key, so we have
// to spell out which columns to load on every read query.
const PROGRAM_FIELDS = [
  'id',
  'name',
  'description',
  'product_code',
  'created_at',
] as const;
const ITEM_FIELDS = [
  'id',
  'title',
  'state',
  'state_name',
  'category',
  'status',
  'provision_value',
  'citation',
  'enacted_date',
  'effective_date',
  'source_url',
  'latitude',
  'longitude',
  'labels_json',
  'created_at',
  'updated_at',
  'program.id',
] as const;
const SIGNAL_FIELDS = [
  'id',
  'state',
  'state_name',
  'product_code',
  'sellable',
  'tax_burden',
  'pricing_action',
  'recommendation',
  'flavor_banned',
  'registry_gated',
  'has_pending',
  'effective_date',
  'updated_at',
  'program.id',
] as const;

/**
 * Thin wrapper around the Rayfin data client for Program + RegulatoryItem.
 * Exists so components don't reach into the raw client and so write paths can
 * refuse to fire when the app is in live CDC-sync mode (defense in depth on top
 * of UI gating).
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly appConfig = inject(AppConfigService);

  // ── Programs ─────────────────────────────────────────────────────────────

  listPrograms(): Promise<Program[]> {
    return getRayfinClient()
      .data.Program.select([...PROGRAM_FIELDS])
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  getProgram(id: string): Promise<Program | null> {
    return getRayfinClient()
      .data.Program.select([...PROGRAM_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createProgram(input: ProgramCreate): Promise<Program> {
    this.assertWritable();
    const created = await getRayfinClient().data.Program.create(input);
    // Mutations only echo back the fields you sent; re-read so callers get
    // a fully-hydrated row.
    return (await this.getProgram(created.id)) ?? created;
  }

  async updateProgram(id: string, patch: ProgramUpdate): Promise<Program> {
    this.assertWritable();
    await getRayfinClient().data.Program.update({ id }, patch);
    const reloaded = await this.getProgram(id);
    if (!reloaded) throw new Error(`Program ${id} not found after update`);
    return reloaded;
  }

  deleteProgram(id: string): Promise<Program> {
    this.assertWritable();
    return getRayfinClient().data.Program.delete({ id });
  }

  // ── Regulatory items ─────────────────────────────────────────────────────

  listItems(): Promise<RegulatoryItem[]> {
    return getRayfinClient()
      .data.RegulatoryItem.select([...ITEM_FIELDS])
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  listItemsForProgram(programId: string): Promise<RegulatoryItem[]> {
    return getRayfinClient()
      .data.RegulatoryItem.select([...ITEM_FIELDS])
      .where({ program: { id: { eq: programId } } })
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  getItem(id: string): Promise<RegulatoryItem | null> {
    return getRayfinClient()
      .data.RegulatoryItem.select([...ITEM_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createItem(input: RegulatoryItemCreate): Promise<RegulatoryItem> {
    this.assertWritable();
    const created = await getRayfinClient().data.RegulatoryItem.create(input);
    return (await this.getItem(created.id)) ?? created;
  }

  async updateItem(id: string, patch: RegulatoryItemUpdate): Promise<RegulatoryItem> {
    this.assertWritable();
    await getRayfinClient().data.RegulatoryItem.update({ id }, patch);
    const reloaded = await this.getItem(id);
    if (!reloaded) throw new Error(`RegulatoryItem ${id} not found after update`);
    return reloaded;
  }

  deleteItem(id: string): Promise<RegulatoryItem> {
    this.assertWritable();
    return getRayfinClient().data.RegulatoryItem.delete({ id });
  }

  /** Evidence laws behind one state's signal (optionally scoped to a program). */
  listItemsForState(state: string, programId?: string): Promise<RegulatoryItem[]> {
    const where = programId
      ? { state: { eq: state }, program: { id: { eq: programId } } }
      : { state: { eq: state } };
    return getRayfinClient()
      .data.RegulatoryItem.select([...ITEM_FIELDS])
      .where(where)
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  // ── Pricing signals (Gold serving table) ─────────────────────────────────

  listSignals(): Promise<PricingSignal[]> {
    return getRayfinClient()
      .data.PricingSignal.select([...SIGNAL_FIELDS])
      .orderBy({ state: 'asc' })
      .execute();
  }

  listSignalsForProgram(programId: string): Promise<PricingSignal[]> {
    return getRayfinClient()
      .data.PricingSignal.select([...SIGNAL_FIELDS])
      .where({ program: { id: { eq: programId } } })
      .orderBy({ state: 'asc' })
      .execute();
  }

  listSignalsForProduct(product: ProductCode): Promise<PricingSignal[]> {
    return getRayfinClient()
      .data.PricingSignal.select([...SIGNAL_FIELDS])
      .where({ product_code: { eq: product } })
      .orderBy({ state: 'asc' })
      .execute();
  }

  getSignal(id: string): Promise<PricingSignal | null> {
    return getRayfinClient()
      .data.PricingSignal.select([...SIGNAL_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  // ── Reset (Settings → "Reset to setup") ───────────────────────────────────

  /** Delete every PricingSignal + RegulatoryItem + Program. Caller flips `sync_mode` separately. */
  async wipeAll(): Promise<void> {
    const client = getRayfinClient();
    const signals = await client.data.PricingSignal.findMany();
    for (const s of signals) await client.data.PricingSignal.delete({ id: s.id });
    const items = await client.data.RegulatoryItem.findMany(); // id-only is enough here
    for (const t of items) await client.data.RegulatoryItem.delete({ id: t.id });
    const programs = await client.data.Program.findMany();
    for (const p of programs) await client.data.Program.delete({ id: p.id });
  }

  private assertWritable(): void {
    if (!this.appConfig.canWrite()) {
      throw new Error(
        'This monitor is in live CDC-sync mode (read-only). Switch to the seeded snapshot in Settings.'
      );
    }
  }
}
