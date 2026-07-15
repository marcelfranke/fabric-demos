/**
 * Wire contract for the patents User Data Functions.
 *
 * IMPORTANT: this file is imported by BOTH the Node/Fabric function runtime AND
 * the browser Angular app (to type `RayfinClient<DashboardSchema,
 * PatentsFunctionsSchema>`). It MUST stay free of any Node / SDK imports — pure
 * TypeScript types only — or the frontend bundle will break.
 */

// ── kpiSummary ────────────────────────────────────────────────────────────
export interface KpiSummary {
  totalApplications: number;
  granted: number;
  /** granted / totalApplications * 100, rounded to 1 decimal. */
  grantRatePct: number;
  totalPublications: number;
}

// ── listApplications ──────────────────────────────────────────────────────
export interface ListApplicationsInput {
  /** 1-based page number. Clamped to >= 1. */
  page?: number;
  /** Rows per page. Clamped to 1..LIMITS.applicationsMaxPageSize. */
  pageSize?: number;
  /** Filter by country code (exact match), bound as a parameter. */
  country?: string;
  /** Filter by technology-area label (exact match), bound as a parameter. */
  techArea?: string;
  /** Filter by grant status. */
  granted?: boolean;
}

export interface ApplicationRow {
  applicationNumber: string;
  title: string | null;
  filingDate: string | null;
  countryCode: string | null;
  countryName: string | null;
  techArea: string | null;
  granted: boolean;
  publicationCount: number;
}

export interface ListApplicationsResult {
  rows: ApplicationRow[];
  page: number;
  pageSize: number;
  /** Total rows matching the filter (for pager UIs). */
  total: number;
}

// ── topApplicants / topInventors ──────────────────────────────────────────
export interface TopInput {
  /** Number of rows. Clamped to 1..LIMITS.topMaxLimit. */
  limit?: number;
}

export interface TopApplicantRow {
  applicant: string;
  applicationCount: number;
}

export interface TopInventorRow {
  inventor: string;
  applicationCount: number;
}

/**
 * The functions schema handed to `RayfinClient` as its 2nd type parameter.
 * Each entry maps a function name → `{ input; output }`, matching the
 * `@microsoft/rayfin-functions` `FunctionsSchema` shape so
 * `client.functions.<name>.invoke(input)` is fully typed on the frontend.
 */
export type PatentsFunctionsSchema = {
  kpiSummary: { input: void; output: KpiSummary };
  listApplications: { input: ListApplicationsInput; output: ListApplicationsResult };
  topApplicants: { input: TopInput; output: TopApplicantRow[] };
  topInventors: { input: TopInput; output: TopInventorRow[] };
};
