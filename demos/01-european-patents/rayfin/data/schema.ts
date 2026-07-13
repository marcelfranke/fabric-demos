import {
  entity,
  authenticated,
  uuid,
  text,
  int,
  date,
  set,
  one,
  many,
} from '@microsoft/rayfin-core';

// European Patents domain model. Field names mirror the Fabric semantic model
// (star schema: Patent fact + Applicant / Inventor / Classification bridges).
// See ../../fabric/semantic-model for the source-of-truth column definitions.

@entity()
@authenticated('*')
export class Patent {
  @uuid() id!: string;
  // EP publication number, e.g. "EP1234567". Business key.
  @text({ max: 40 }) patent_number!: string;
  // Publication kind code (A1, A2, B1, ...).
  @text({ max: 8, optional: true }) kind_code?: string;
  // Publication country (usually "EP").
  @text({ max: 4, optional: true }) publication_country?: string;
  // Publication date (B140).
  @date({ optional: true }) publication_date?: Date;
  @text({ max: 40, optional: true }) application_number?: string;
  // Application filing date (B220).
  @date({ optional: true }) filing_date?: Date;
  // Publication language (en/de/fr).
  @text({ max: 8, optional: true }) language?: string;
  // English title where available (B542 EN).
  @text({ max: 1000, optional: true }) title_en?: string;
  // Primary IPC classification symbol.
  @text({ max: 40, optional: true }) main_ipc?: string;
  // First-letter IPC section (A-H).
  @text({ max: 4, optional: true }) ipc_section?: string;
  // Denormalized headline applicant name (B710 first party).
  @text({ max: 300, optional: true }) first_applicant?: string;
  // Denormalized headline applicant country.
  @text({ max: 4, optional: true }) applicant_country?: string;
  @int({ optional: true }) inventor_count?: number;

  @many(() => Applicant) applicants?: Applicant[];
  @many(() => Inventor) inventors?: Inventor[];
  @many(() => Classification) classifications?: Classification[];
}

@entity()
@authenticated('*')
export class Applicant {
  @uuid() id!: string;
  // Applicant / assignee organisation name.
  @text({ max: 300 }) name!: string;
  @text({ max: 4, optional: true }) country?: string;
  // Party sequence within the patent (1 = first applicant).
  @int({ optional: true }) sequence?: number;
  @one(() => Patent) patent!: Patent;
}

@entity()
@authenticated('*')
export class Inventor {
  @uuid() id!: string;
  @text({ max: 300 }) name!: string;
  @text({ max: 4, optional: true }) country?: string;
  @int({ optional: true }) sequence?: number;
  @one(() => Patent) patent!: Patent;
}

@entity()
@authenticated('*')
export class Classification {
  @uuid() id!: string;
  // Classification symbol (e.g. "A61F 2/24").
  @text({ max: 60 }) symbol!: string;
  // Scheme: IPC or CPC.
  @set('IPC', 'CPC') scheme!: 'IPC' | 'CPC';
  // First-letter section (A-H).
  @text({ max: 4, optional: true }) section?: string;
  @one(() => Patent) patent!: Patent;
}

// Singleton config row — see APP_CONFIG_ID in src/app/services/constants.ts.
// Tracks whether the first-launch wizard has run and which mode was picked.
@entity()
@authenticated('*')
export class AppConfig {
  @uuid() id!: string;
  @set('pending', 'empty', 'sample') setup_mode!: 'pending' | 'empty' | 'sample';
  @date({ optional: true }) seeded_at?: Date;
}

export type DashboardSchema = {
  Patent: Patent;
  Applicant: Applicant;
  Inventor: Inventor;
  Classification: Classification;
  AppConfig: AppConfig;
};

export const schema = [Patent, Applicant, Inventor, Classification, AppConfig];
