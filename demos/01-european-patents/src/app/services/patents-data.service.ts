import { Injectable } from '@angular/core';

import type {
  KpiSummary,
  ListApplicationsInput,
  ListApplicationsResult,
  TopApplicantRow,
  TopInventorRow,
  TopInput,
} from '../../../rayfin/functions/src/types';
import { getRayfinClient } from '../../services/rayfinClient';

/**
 * Read-only access to the live `eps_lakehouse` `gold_` Kimball star, served
 * through the Fabric User Data Functions declared in
 * `rayfin/functions/src/function_app.ts`.
 *
 * Every method is a thin, typed wrapper over
 * `getRayfinClient().functions.<name>.invoke(...)` — the actual SQL runs
 * server-side in the UDF against the lakehouse SQL analytics endpoint (which is
 * inherently read-only). NOTHING here queries the Rayfin data store, so the
 * existing Project/Task/AppConfig app is completely untouched.
 *
 * The `PatentsFunctionsSchema` type parameter on `RayfinClient` makes each
 * `invoke()` fully type-checked against the wire contract in `types.ts`.
 */
@Injectable({ providedIn: 'root' })
export class PatentsDataService {
  /** KPI tiles: total applications, granted, grant-rate %, total publications. */
  kpiSummary(): Promise<KpiSummary> {
    return getRayfinClient().functions.kpiSummary.invoke();
  }

  /** Server-side paged + filtered applications list (joined dims). */
  listApplications(
    input: ListApplicationsInput
  ): Promise<ListApplicationsResult> {
    return getRayfinClient().functions.listApplications.invoke(input);
  }

  /** Top-N applicants via the applicant bridge table. */
  topApplicants(input: TopInput): Promise<TopApplicantRow[]> {
    return getRayfinClient().functions.topApplicants.invoke(input);
  }

  /** Top-N inventors via the inventor bridge table. */
  topInventors(input: TopInput): Promise<TopInventorRow[]> {
    return getRayfinClient().functions.topInventors.invoke(input);
  }
}
