import { Injectable } from '@angular/core';

import type {
  Applicant,
  Classification,
  Inventor,
  Patent,
} from '../../../rayfin/data/schema';

/** Aggregate KPI figures (true totals across the whole Fabric model). */
export interface DataStats {
  totalPatents: number;
  distinctApplicants: number;
  distinctInventors: number;
  avgInventors: number;
  /** Patent count per IPC section letter (A–H). */
  sectionCounts: Record<string, number>;
}

/** One row of the applicant leaderboard. */
export interface ApplicantLeader {
  name: string;
  country?: string;
  patents: number;
}

/** Date basis for the trends time-series. */
export type TrendBasis = 'publication' | 'filing';

/** One (period, section, country) count of patents. */
export interface TrendFact {
  /** Month bucket, "YYYY-MM". */
  period: string;
  section: string | null;
  pubCountry: string | null;
  appCountry: string | null;
  count: number;
}

/** One (period, scheme, section) count from the classification bridge. */
export interface SchemeFact {
  period: string;
  scheme: string | null;
  section: string | null;
  count: number;
}

/** The whole trends payload for one date basis. */
export interface TrendSeries {
  facts: TrendFact[];
  scheme: SchemeFact[];
}

/** Full trends dataset (both bases + the sorted list of month periods). */
export interface TrendsData {
  periods: string[];
  publication: TrendSeries;
  filing: TrendSeries;
}

interface LiveChildApplicant {
  name: string | null;
  country: string | null;
  sequence: number | null;
}
interface LiveChildInventor {
  name: string | null;
  country: string | null;
  sequence: number | null;
}
interface LiveChildClassification {
  symbol: string | null;
  scheme: string | null;
  section: string | null;
}
interface LivePatent {
  id: string;
  patent_number: string;
  kind_code: string | null;
  publication_country: string | null;
  publication_date: string | null;
  application_number: string | null;
  filing_date: string | null;
  language: string | null;
  title_en: string | null;
  main_ipc: string | null;
  ipc_section: string | null;
  first_applicant: string | null;
  applicant_country: string | null;
  inventor_count: number | null;
  applicants: LiveChildApplicant[];
  inventors: LiveChildInventor[];
  classifications: LiveChildClassification[];
}

const LIVE_BASE = 'assets/live';

/**
 * Reads the static JSON assets produced by `scripts/sync-fabric.mjs` (real
 * European Patents data pulled from the Fabric semantic model) and shapes them
 * into the same entity types the rest of the app consumes. Used only in
 * `live` mode; everything here is read-only.
 *
 * Each JSON file is fetched at most once and memoised.
 */
@Injectable({ providedIn: 'root' })
export class LiveDataService {
  private statsCache?: Promise<DataStats>;
  private patentsCache?: Promise<LivePatent[]>;
  private leaderboardCache?: Promise<ApplicantLeader[]>;
  private trendsCache?: Promise<TrendsData>;

  async stats(): Promise<DataStats> {
    this.statsCache ??= this.fetchJson<DataStats>('stats.json');
    return this.statsCache;
  }

  /** Time-series facts for the "applications over time" page. */
  async trends(): Promise<TrendsData> {
    this.trendsCache ??= this.fetchJson<TrendsData>('trends.json').then(
      (d) => ({
        periods: d.periods ?? [],
        publication: {
          facts: d.publication?.facts ?? [],
          scheme: d.publication?.scheme ?? [],
        },
        filing: {
          facts: d.filing?.facts ?? [],
          scheme: d.filing?.scheme ?? [],
        },
      })
    );
    return this.trendsCache;
  }

  async listPatents(): Promise<Patent[]> {
    const rows = await this.patents();
    return rows.map((r) => this.toPatent(r));
  }

  async getPatent(id: string): Promise<Patent | null> {
    const rows = await this.patents();
    const row = rows.find((r) => r.id === id || r.patent_number === id);
    return row ? this.toPatent(row) : null;
  }

  async applicantsForPatent(patentId: string): Promise<Applicant[]> {
    const row = await this.findRow(patentId);
    return (row?.applicants ?? []).map((a, i) =>
      this.toApplicant(row!.patent_number, a, i)
    );
  }

  async inventorsForPatent(patentId: string): Promise<Inventor[]> {
    const row = await this.findRow(patentId);
    return (row?.inventors ?? []).map((inv, i) =>
      this.toInventor(row!.patent_number, inv, i)
    );
  }

  async classificationsForPatent(patentId: string): Promise<Classification[]> {
    const row = await this.findRow(patentId);
    return (row?.classifications ?? []).map((c, i) =>
      this.toClassification(row!.patent_number, c, i)
    );
  }

  async leaderboard(limit?: number): Promise<ApplicantLeader[]> {
    this.leaderboardCache ??= this.fetchJson<{
      leaderboard: ApplicantLeader[];
    }>('applicants.json').then((d) => d.leaderboard ?? []);
    const rows = await this.leaderboardCache;
    return typeof limit === 'number' ? rows.slice(0, limit) : rows;
  }

  private async patents(): Promise<LivePatent[]> {
    this.patentsCache ??= this.fetchJson<{ patents: LivePatent[] }>(
      'patents.json'
    ).then((d) => d.patents ?? []);
    return this.patentsCache;
  }

  private async findRow(patentId: string): Promise<LivePatent | undefined> {
    const rows = await this.patents();
    return rows.find((r) => r.id === patentId || r.patent_number === patentId);
  }

  private async fetchJson<T>(name: string): Promise<T> {
    const res = await fetch(`${LIVE_BASE}/${name}`);
    if (!res.ok) {
      throw new Error(
        `Live data asset ${name} could not be loaded (${res.status}). ` +
          'Run `npm run sync:fabric` to generate it.'
      );
    }
    return (await res.json()) as T;
  }

  private toPatent(r: LivePatent): Patent {
    return {
      id: r.id,
      patent_number: r.patent_number,
      kind_code: r.kind_code ?? undefined,
      publication_country: r.publication_country ?? undefined,
      publication_date: r.publication_date
        ? new Date(r.publication_date)
        : undefined,
      application_number: r.application_number ?? undefined,
      filing_date: r.filing_date ? new Date(r.filing_date) : undefined,
      language: r.language ?? undefined,
      title_en: r.title_en ?? undefined,
      main_ipc: r.main_ipc ?? undefined,
      ipc_section: r.ipc_section ?? undefined,
      first_applicant: r.first_applicant ?? undefined,
      applicant_country: r.applicant_country ?? undefined,
      inventor_count: r.inventor_count ?? undefined,
    } as Patent;
  }

  private toApplicant(
    patentNumber: string,
    a: LiveChildApplicant,
    i: number
  ): Applicant {
    return {
      id: `${patentNumber}:applicant:${i}`,
      name: a.name ?? '',
      country: a.country ?? undefined,
      sequence: a.sequence ?? undefined,
    } as Applicant;
  }

  private toInventor(
    patentNumber: string,
    inv: LiveChildInventor,
    i: number
  ): Inventor {
    return {
      id: `${patentNumber}:inventor:${i}`,
      name: inv.name ?? '',
      country: inv.country ?? undefined,
      sequence: inv.sequence ?? undefined,
    } as Inventor;
  }

  private toClassification(
    patentNumber: string,
    c: LiveChildClassification,
    i: number
  ): Classification {
    return {
      id: `${patentNumber}:class:${i}`,
      symbol: c.symbol ?? '',
      scheme: (c.scheme as 'IPC' | 'CPC') ?? 'IPC',
      section: c.section ?? undefined,
    } as Classification;
  }
}
