import { Injectable, inject } from '@angular/core';

import { AppConfigService } from './app-config.service';
import { DataService } from './data.service';

interface SeedPatent {
  patent_number: string;
  kind_code: string;
  publication_date: string; // ISO date
  filing_date: string;
  application_number: string;
  language: string;
  title_en: string;
  main_ipc: string;
  ipc_section: string;
  applicant_country: string;
  applicants: { name: string; country: string }[];
  inventors: { name: string; country: string }[];
  classifications: { symbol: string; scheme: 'IPC' | 'CPC'; section: string }[];
}

// A representative slice of January 2026 EP publications. Shape mirrors the
// Fabric `gold_patent_summary` / silver bridge tables so the app stays
// faithful to the semantic model even when running on seeded data.
const SAMPLE_PATENTS: SeedPatent[] = [
  {
    patent_number: 'EP4123456',
    kind_code: 'A1',
    publication_date: '2026-01-07',
    filing_date: '2024-06-18',
    application_number: 'EP24179945',
    language: 'en',
    title_en: 'Solid-state battery cell with layered ceramic electrolyte',
    main_ipc: 'H01M 10/0562',
    ipc_section: 'H',
    applicant_country: 'DE',
    applicants: [{ name: 'Volkswagen AG', country: 'DE' }],
    inventors: [
      { name: 'Klaus Bauer', country: 'DE' },
      { name: 'Marta Nowak', country: 'PL' },
    ],
    classifications: [
      { symbol: 'H01M 10/0562', scheme: 'IPC', section: 'H' },
      { symbol: 'H01M 10/052', scheme: 'CPC', section: 'H' },
    ],
  },
  {
    patent_number: 'EP4123457',
    kind_code: 'B1',
    publication_date: '2026-01-07',
    filing_date: '2021-11-03',
    application_number: 'EP21208812',
    language: 'de',
    title_en: 'Method for controlling an electric drive train of a vehicle',
    main_ipc: 'B60L 15/20',
    ipc_section: 'B',
    applicant_country: 'DE',
    applicants: [{ name: 'Robert Bosch GmbH', country: 'DE' }],
    inventors: [{ name: 'Stefan Weber', country: 'DE' }],
    classifications: [{ symbol: 'B60L 15/20', scheme: 'IPC', section: 'B' }],
  },
  {
    patent_number: 'EP4123458',
    kind_code: 'A1',
    publication_date: '2026-01-14',
    filing_date: '2024-07-22',
    application_number: 'EP24188120',
    language: 'en',
    title_en: 'Antibody conjugate for targeted oncology therapy',
    main_ipc: 'A61K 47/68',
    ipc_section: 'A',
    applicant_country: 'CH',
    applicants: [
      { name: 'F. Hoffmann-La Roche AG', country: 'CH' },
      { name: 'Genentech, Inc.', country: 'US' },
    ],
    inventors: [
      { name: 'Sophie Martin', country: 'FR' },
      { name: 'David Chen', country: 'US' },
      { name: 'Anna Rossi', country: 'IT' },
    ],
    classifications: [
      { symbol: 'A61K 47/68', scheme: 'IPC', section: 'A' },
      { symbol: 'A61P 35/00', scheme: 'IPC', section: 'A' },
    ],
  },
  {
    patent_number: 'EP4123459',
    kind_code: 'A1',
    publication_date: '2026-01-14',
    filing_date: '2024-05-30',
    application_number: 'EP24176003',
    language: 'en',
    title_en: 'Neural network accelerator with reconfigurable dataflow',
    main_ipc: 'G06N 3/063',
    ipc_section: 'G',
    applicant_country: 'NL',
    applicants: [{ name: 'ASML Netherlands B.V.', country: 'NL' }],
    inventors: [
      { name: 'Jeroen de Vries', country: 'NL' },
      { name: 'Priya Nair', country: 'IN' },
    ],
    classifications: [
      { symbol: 'G06N 3/063', scheme: 'IPC', section: 'G' },
      { symbol: 'G06F 15/78', scheme: 'CPC', section: 'G' },
    ],
  },
  {
    patent_number: 'EP4123460',
    kind_code: 'B1',
    publication_date: '2026-01-14',
    filing_date: '2020-09-14',
    application_number: 'EP20195870',
    language: 'fr',
    title_en: 'Turbine blade cooling arrangement for a gas turbine engine',
    main_ipc: 'F01D 5/18',
    ipc_section: 'F',
    applicant_country: 'FR',
    applicants: [{ name: 'Safran Aircraft Engines', country: 'FR' }],
    inventors: [
      { name: 'Julien Moreau', country: 'FR' },
      { name: 'Camille Dubois', country: 'FR' },
    ],
    classifications: [{ symbol: 'F01D 5/18', scheme: 'IPC', section: 'F' }],
  },
  {
    patent_number: 'EP4123461',
    kind_code: 'A1',
    publication_date: '2026-01-21',
    filing_date: '2024-08-09',
    application_number: 'EP24192447',
    language: 'en',
    title_en: 'Perovskite tandem solar module with improved stability',
    main_ipc: 'H10K 30/57',
    ipc_section: 'H',
    applicant_country: 'DE',
    applicants: [{ name: 'Siemens Energy Global GmbH & Co. KG', country: 'DE' }],
    inventors: [{ name: 'Lena Fischer', country: 'DE' }],
    classifications: [
      { symbol: 'H10K 30/57', scheme: 'IPC', section: 'H' },
      { symbol: 'H10K 85/50', scheme: 'CPC', section: 'H' },
    ],
  },
  {
    patent_number: 'EP4123462',
    kind_code: 'A1',
    publication_date: '2026-01-21',
    filing_date: '2024-04-11',
    application_number: 'EP24164788',
    language: 'en',
    title_en: 'Biodegradable polymer composition for food packaging films',
    main_ipc: 'C08L 67/04',
    ipc_section: 'C',
    applicant_country: 'FI',
    applicants: [{ name: 'Neste Oyj', country: 'FI' }],
    inventors: [
      { name: 'Aino Virtanen', country: 'FI' },
      { name: 'Oskar Lindqvist', country: 'SE' },
    ],
    classifications: [
      { symbol: 'C08L 67/04', scheme: 'IPC', section: 'C' },
      { symbol: 'C08J 5/18', scheme: 'IPC', section: 'C' },
    ],
  },
  {
    patent_number: 'EP4123463',
    kind_code: 'B1',
    publication_date: '2026-01-21',
    filing_date: '2021-02-26',
    application_number: 'EP21159334',
    language: 'de',
    title_en: 'Surgical robotic instrument with force feedback',
    main_ipc: 'A61B 34/30',
    ipc_section: 'A',
    applicant_country: 'DE',
    applicants: [{ name: 'Siemens Healthineers AG', country: 'DE' }],
    inventors: [{ name: 'Thomas Schmidt', country: 'DE' }],
    classifications: [{ symbol: 'A61B 34/30', scheme: 'IPC', section: 'A' }],
  },
  {
    patent_number: 'EP4123464',
    kind_code: 'A1',
    publication_date: '2026-01-28',
    filing_date: '2024-09-02',
    application_number: 'EP24197781',
    language: 'en',
    title_en: 'Green hydrogen electrolyzer stack with reduced iridium loading',
    main_ipc: 'C25B 9/23',
    ipc_section: 'C',
    applicant_country: 'NO',
    applicants: [
      { name: 'Nel ASA', country: 'NO' },
      { name: 'SINTEF AS', country: 'NO' },
    ],
    inventors: [
      { name: 'Ingrid Haugen', country: 'NO' },
      { name: 'Erik Johansson', country: 'SE' },
    ],
    classifications: [
      { symbol: 'C25B 9/23', scheme: 'IPC', section: 'C' },
      { symbol: 'C25B 1/04', scheme: 'IPC', section: 'C' },
    ],
  },
  {
    patent_number: 'EP4123465',
    kind_code: 'A1',
    publication_date: '2026-01-28',
    filing_date: '2024-03-19',
    application_number: 'EP24160992',
    language: 'en',
    title_en: 'Low-latency beamforming scheme for 6G radio access networks',
    main_ipc: 'H04B 7/06',
    ipc_section: 'H',
    applicant_country: 'SE',
    applicants: [{ name: 'Telefonaktiebolaget LM Ericsson', country: 'SE' }],
    inventors: [
      { name: 'Karl Andersson', country: 'SE' },
      { name: 'Mei Lin', country: 'CN' },
    ],
    classifications: [
      { symbol: 'H04B 7/06', scheme: 'IPC', section: 'H' },
      { symbol: 'H04W 72/04', scheme: 'CPC', section: 'H' },
    ],
  },
];

/**
 * Seeds the workspace with a representative slice of European patents so the
 * dashboard isn't empty on first paint. Pure client-side inserts through the
 * Rayfin data client — no shell scripts, cross-platform by construction.
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private readonly data = inject(DataService);
  private readonly appConfig = inject(AppConfigService);

  async seedSampleData(): Promise<number> {
    for (const p of SAMPLE_PATENTS) {
      const patent = await this.data.createPatent({
        patent_number: p.patent_number,
        kind_code: p.kind_code,
        publication_country: 'EP',
        publication_date: new Date(p.publication_date),
        application_number: p.application_number,
        filing_date: new Date(p.filing_date),
        language: p.language,
        title_en: p.title_en,
        main_ipc: p.main_ipc,
        ipc_section: p.ipc_section,
        first_applicant: p.applicants[0]?.name,
        applicant_country: p.applicant_country,
        inventor_count: p.inventors.length,
      });

      let seq = 1;
      for (const a of p.applicants) {
        await this.data.createApplicant({
          name: a.name,
          country: a.country,
          sequence: seq++,
          patent: { id: patent.id },
        });
      }
      seq = 1;
      for (const inv of p.inventors) {
        await this.data.createInventor({
          name: inv.name,
          country: inv.country,
          sequence: seq++,
          patent: { id: patent.id },
        });
      }
      for (const c of p.classifications) {
        await this.data.createClassification({
          symbol: c.symbol,
          scheme: c.scheme,
          section: c.section,
          patent: { id: patent.id },
        });
      }
    }

    await this.appConfig.patch({ seeded_at: new Date() });
    return SAMPLE_PATENTS.length;
  }
}
