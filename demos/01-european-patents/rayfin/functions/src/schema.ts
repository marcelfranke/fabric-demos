/**
 * Physical names of the `eps_lakehouse` gold Kimball star, in ONE place.
 *
 * WHY THIS FILE EXISTS — READ BEFORE EDITING SQL
 * ------------------------------------------------------------------
 * The live lakehouse serves an **application-grain** star (`gold_fact_application`
 * + dims + bridges). That star was rewired in the Fabric service; its DDL is NOT
 * committed to this repo branch (the committed ingestion notebook still builds the
 * *older* publication-grain star — see `fabric/README.md`). So the exact column
 * names below cannot be lifted from the repo and MUST be reconciled against the
 * live SQL analytics endpoint after the function is deployed.
 *
 * Reconcile step (run once against the endpoint, then fix any mismatch here):
 *
 *   SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
 *   FROM INFORMATION_SCHEMA.COLUMNS
 *   WHERE TABLE_NAME LIKE 'gold\_%' ESCAPE '\'
 *      OR TABLE_NAME = 'silver_applicant_dim'
 *   ORDER BY TABLE_NAME, ORDINAL_POSITION;
 *
 * Everything downstream (queries.ts) references these constants only — never a
 * hard-coded table/column name — so reconciliation is a single-file edit.
 *
 * All identifiers are emitted through {@link qid} (bracket-quoted) so they are
 * treated as identifiers, never interpolated user input. User-supplied *values*
 * are ALWAYS bound as `@parameters`, never concatenated.
 */

/** Schema the gold/silver tables live under on the SQL analytics endpoint. */
export const SCHEMA = 'dbo';

export const TABLES = {
  factApplication: 'gold_fact_application',
  dimApplication: 'gold_dim_application',
  dimPublication: 'gold_dim_publication',
  dimCountry: 'gold_dim_country',
  dimTechArea: 'gold_dim_tech_area',
  dimInventor: 'gold_dim_inventor',
  bridgeApplicant: 'gold_bridge_application_applicant',
  bridgeInventor: 'gold_bridge_application_inventor',
  dimApplicant: 'silver_applicant_dim',
} as const;

/**
 * Column names per table. Grouped so a reconcile edit is obvious. Names follow
 * the repo's stated convention: deterministic BIGINT surrogate keys named
 * `<entity>_key`, the natural application key `application_number`, and measure
 * columns `is_granted` / `publication_count` proven in the model.
 */
export const COLUMNS = {
  factApplication: {
    applicationKey: 'application_key',
    applicationNumber: 'application_number',
    countryKey: 'country_key',
    techAreaKey: 'tech_area_key',
    isGranted: 'is_granted',
    publicationCount: 'publication_count',
  },
  dimApplication: {
    applicationKey: 'application_key',
    title: 'title',
    filingDate: 'filing_date',
  },
  dimCountry: {
    countryKey: 'country_key',
    countryCode: 'country_code',
    countryName: 'country_name',
  },
  dimTechArea: {
    techAreaKey: 'tech_area_key',
    label: 'tech_area_label',
  },
  dimInventor: {
    inventorKey: 'inventor_key',
    name: 'inventor_name',
  },
  bridgeApplicant: {
    applicationKey: 'application_key',
    applicantKey: 'applicant_key',
  },
  bridgeInventor: {
    applicationKey: 'application_key',
    inventorKey: 'inventor_key',
  },
  dimApplicant: {
    applicantKey: 'applicant_key',
    name: 'applicant_name',
  },
} as const;

/** Server-side clamps — hard upper bounds so a caller can never pull unbounded rows. */
export const LIMITS = {
  applicationsMaxPageSize: 100,
  applicationsDefaultPageSize: 25,
  topDefaultLimit: 10,
  topMaxLimit: 50,
} as const;

/** Bracket-quote a SQL identifier (defends against stray metacharacters). */
export function qid(identifier: string): string {
  return `[${identifier.replace(/]/g, ']]')}]`;
}

/** Fully-qualified, bracket-quoted `[schema].[table]`. */
export function qtable(table: string): string {
  return `${qid(SCHEMA)}.${qid(table)}`;
}
