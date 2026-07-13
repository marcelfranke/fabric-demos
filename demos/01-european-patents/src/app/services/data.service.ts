import { Injectable, inject } from '@angular/core';

import type {
  Applicant,
  Classification,
  Inventor,
  Patent,
} from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { AppConfigService } from './app-config.service';
import {
  type ApplicantLeader,
  type DataStats,
  LiveDataService,
} from './live-data.service';

export type { ApplicantLeader, DataStats } from './live-data.service';

type PatentCreate = Omit<
  Patent,
  'id' | 'applicants' | 'inventors' | 'classifications'
> & { id?: string };
type PatentUpdate = Partial<
  Omit<Patent, 'applicants' | 'inventors' | 'classifications'>
>;

type ApplicantCreate = Omit<Applicant, 'id' | 'patent'> & {
  id?: string;
  patent: { id: string };
};
type InventorCreate = Omit<Inventor, 'id' | 'patent'> & {
  id?: string;
  patent: { id: string };
};
type ClassificationCreate = Omit<Classification, 'id' | 'patent'> & {
  id?: string;
  patent: { id: string };
};

// The SDK's default field selection only returns the primary key, so we have
// to spell out which columns to load on every read query.
const PATENT_FIELDS = [
  'id',
  'patent_number',
  'kind_code',
  'publication_country',
  'publication_date',
  'application_number',
  'filing_date',
  'language',
  'title_en',
  'main_ipc',
  'ipc_section',
  'first_applicant',
  'applicant_country',
  'inventor_count',
] as const;
const APPLICANT_FIELDS = ['id', 'name', 'country', 'sequence', 'patent.id'] as const;
const INVENTOR_FIELDS = ['id', 'name', 'country', 'sequence', 'patent.id'] as const;
const CLASSIFICATION_FIELDS = [
  'id',
  'symbol',
  'scheme',
  'section',
  'patent.id',
] as const;

/**
 * Thin wrapper around the Rayfin data client for the European Patents model
 * (Patent + Applicant / Inventor / Classification children). Exists so
 * components don't reach into the raw client directly.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly appConfig = inject(AppConfigService);
  private readonly live = inject(LiveDataService);

  /** Live mode reads from the Fabric-synced JSON assets and blocks writes. */
  private get isLive(): boolean {
    return this.appConfig.mode() === 'live';
  }

  private assertWritable(): void {
    if (this.isLive) {
      throw new Error(
        'This workspace is in live (read-only) mode — data is synced from ' +
          'Fabric and cannot be edited here.'
      );
    }
  }

  // ── Patents ────────────────────────────────────────────────────────────

  listPatents(): Promise<Patent[]> {
    if (this.isLive) return this.live.listPatents();
    return getRayfinClient()
      .data.Patent.select([...PATENT_FIELDS])
      .orderBy({ publication_date: 'desc' })
      .execute();
  }

  getPatent(id: string): Promise<Patent | null> {
    if (this.isLive) return this.live.getPatent(id);
    return getRayfinClient()
      .data.Patent.select([...PATENT_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createPatent(input: PatentCreate): Promise<Patent> {
    this.assertWritable();
    const created = await getRayfinClient().data.Patent.create(input);
    // Mutations only echo back the fields you sent; re-read so callers get
    // a fully-hydrated row.
    return (await this.getPatent(created.id)) ?? created;
  }

  async updatePatent(id: string, patch: PatentUpdate): Promise<Patent> {
    this.assertWritable();
    await getRayfinClient().data.Patent.update({ id }, patch);
    const reloaded = await this.getPatent(id);
    if (!reloaded) throw new Error(`Patent ${id} not found after update`);
    return reloaded;
  }

  deletePatent(id: string): Promise<Patent> {
    this.assertWritable();
    return getRayfinClient().data.Patent.delete({ id });
  }

  // ── Aggregate stats & leaderboard (all modes) ───────────────────────────

  /**
   * True KPI totals. In live mode these come from the Fabric model's own
   * measures (via the sync), so the dashboard shows the full 23k-patent
   * figures rather than the size of the loaded slice.
   */
  async getStats(): Promise<DataStats> {
    if (this.isLive) return this.live.stats();
    const [patents, applicants, inventors] = await Promise.all([
      this.listPatents(),
      this.listApplicants(),
      this.listInventors(),
    ]);
    const applicantNames = new Set(applicants.map((a) => a.name));
    const inventorKeys = new Set(
      inventors.map((i) => `${i.name}\u0000${i.country ?? ''}`)
    );
    const totalInventors = patents.reduce(
      (sum, p) => sum + (p.inventor_count ?? 0),
      0
    );
    const sectionCounts: Record<string, number> = {};
    for (const p of patents) {
      const s = p.ipc_section?.trim().charAt(0).toUpperCase();
      if (s) sectionCounts[s] = (sectionCounts[s] ?? 0) + 1;
    }
    return {
      totalPatents: patents.length,
      distinctApplicants: applicantNames.size,
      distinctInventors: inventorKeys.size,
      avgInventors: patents.length ? totalInventors / patents.length : 0,
      sectionCounts,
    };
  }

  /** Top applicants ranked by number of patents. */
  async applicantLeaderboard(limit?: number): Promise<ApplicantLeader[]> {
    if (this.isLive) return this.live.leaderboard(limit);
    const applicants = await this.listApplicants();
    const byName = new Map<string, ApplicantLeader>();
    for (const a of applicants) {
      const existing = byName.get(a.name);
      if (existing) {
        existing.patents += 1;
        existing.country ??= a.country;
      } else {
        byName.set(a.name, { name: a.name, country: a.country, patents: 1 });
      }
    }
    const ranked = [...byName.values()].sort(
      (x, y) => y.patents - x.patents || x.name.localeCompare(y.name)
    );
    return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
  }

  // ── Children (applicants / inventors / classifications) ─────────────────

  applicantsForPatent(patentId: string): Promise<Applicant[]> {
    if (this.isLive) return this.live.applicantsForPatent(patentId);
    return getRayfinClient()
      .data.Applicant.select([...APPLICANT_FIELDS])
      .where({ patent: { id: { eq: patentId } } })
      .orderBy({ sequence: 'asc' })
      .execute();
  }

  inventorsForPatent(patentId: string): Promise<Inventor[]> {
    if (this.isLive) return this.live.inventorsForPatent(patentId);
    return getRayfinClient()
      .data.Inventor.select([...INVENTOR_FIELDS])
      .where({ patent: { id: { eq: patentId } } })
      .orderBy({ sequence: 'asc' })
      .execute();
  }

  classificationsForPatent(patentId: string): Promise<Classification[]> {
    if (this.isLive) return this.live.classificationsForPatent(patentId);
    return getRayfinClient()
      .data.Classification.select([...CLASSIFICATION_FIELDS])
      .where({ patent: { id: { eq: patentId } } })
      .execute();
  }

  /** Every applicant row — used by the Applicants leaderboard. */
  listApplicants(): Promise<Applicant[]> {
    return getRayfinClient()
      .data.Applicant.select([...APPLICANT_FIELDS])
      .execute();
  }

  /** Every inventor row — used by the dashboard KPIs. */
  listInventors(): Promise<Inventor[]> {
    return getRayfinClient()
      .data.Inventor.select([...INVENTOR_FIELDS])
      .execute();
  }

  createApplicant(input: ApplicantCreate): Promise<Applicant> {
    this.assertWritable();
    return getRayfinClient().data.Applicant.create(input);
  }

  createInventor(input: InventorCreate): Promise<Inventor> {
    this.assertWritable();
    return getRayfinClient().data.Inventor.create(input);
  }

  createClassification(input: ClassificationCreate): Promise<Classification> {
    this.assertWritable();
    return getRayfinClient().data.Classification.create(input);
  }

  deleteApplicant(id: string): Promise<Applicant> {
    this.assertWritable();
    return getRayfinClient().data.Applicant.delete({ id });
  }

  deleteInventor(id: string): Promise<Inventor> {
    this.assertWritable();
    return getRayfinClient().data.Inventor.delete({ id });
  }

  deleteClassification(id: string): Promise<Classification> {
    this.assertWritable();
    return getRayfinClient().data.Classification.delete({ id });
  }

  // ── Reset (Settings → "Reset workspace") ────────────────────────────────

  /** Delete every child row and every Patent. */
  async wipeAll(): Promise<void> {
    this.assertWritable();
    const client = getRayfinClient();
    const applicants = await client.data.Applicant.findMany();
    for (const a of applicants) await client.data.Applicant.delete({ id: a.id });
    const inventors = await client.data.Inventor.findMany();
    for (const i of inventors) await client.data.Inventor.delete({ id: i.id });
    const classifications = await client.data.Classification.findMany();
    for (const c of classifications)
      await client.data.Classification.delete({ id: c.id });
    const patents = await client.data.Patent.findMany();
    for (const p of patents) await client.data.Patent.delete({ id: p.id });
  }
}
