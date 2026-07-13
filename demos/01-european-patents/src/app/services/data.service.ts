import { Injectable } from '@angular/core';

import type {
  Applicant,
  Classification,
  Inventor,
  Patent,
} from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

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
  // ── Patents ────────────────────────────────────────────────────────────

  listPatents(): Promise<Patent[]> {
    return getRayfinClient()
      .data.Patent.select([...PATENT_FIELDS])
      .orderBy({ publication_date: 'desc' })
      .execute();
  }

  getPatent(id: string): Promise<Patent | null> {
    return getRayfinClient()
      .data.Patent.select([...PATENT_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createPatent(input: PatentCreate): Promise<Patent> {
    const created = await getRayfinClient().data.Patent.create(input);
    // Mutations only echo back the fields you sent; re-read so callers get
    // a fully-hydrated row.
    return (await this.getPatent(created.id)) ?? created;
  }

  async updatePatent(id: string, patch: PatentUpdate): Promise<Patent> {
    await getRayfinClient().data.Patent.update({ id }, patch);
    const reloaded = await this.getPatent(id);
    if (!reloaded) throw new Error(`Patent ${id} not found after update`);
    return reloaded;
  }

  deletePatent(id: string): Promise<Patent> {
    return getRayfinClient().data.Patent.delete({ id });
  }

  // ── Children (applicants / inventors / classifications) ─────────────────

  applicantsForPatent(patentId: string): Promise<Applicant[]> {
    return getRayfinClient()
      .data.Applicant.select([...APPLICANT_FIELDS])
      .where({ patent: { id: { eq: patentId } } })
      .orderBy({ sequence: 'asc' })
      .execute();
  }

  inventorsForPatent(patentId: string): Promise<Inventor[]> {
    return getRayfinClient()
      .data.Inventor.select([...INVENTOR_FIELDS])
      .where({ patent: { id: { eq: patentId } } })
      .orderBy({ sequence: 'asc' })
      .execute();
  }

  classificationsForPatent(patentId: string): Promise<Classification[]> {
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
    return getRayfinClient().data.Applicant.create(input);
  }

  createInventor(input: InventorCreate): Promise<Inventor> {
    return getRayfinClient().data.Inventor.create(input);
  }

  createClassification(input: ClassificationCreate): Promise<Classification> {
    return getRayfinClient().data.Classification.create(input);
  }

  deleteApplicant(id: string): Promise<Applicant> {
    return getRayfinClient().data.Applicant.delete({ id });
  }

  deleteInventor(id: string): Promise<Inventor> {
    return getRayfinClient().data.Inventor.delete({ id });
  }

  deleteClassification(id: string): Promise<Classification> {
    return getRayfinClient().data.Classification.delete({ id });
  }

  // ── Reset (Settings → "Reset workspace") ────────────────────────────────

  /** Delete every child row and every Patent. */
  async wipeAll(): Promise<void> {
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
