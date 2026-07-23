/**
 * Unit tests for the pure patents query builders + mappers.
 *
 * Runs on plain Node (`node --test`) against the compiled `dist/` output — no
 * Fabric endpoint, no SDK. Proves the three guarantees the app depends on:
 *   1. every generated statement is read-only (SELECT only),
 *   2. all user values are bound as @parameters (never concatenated),
 *   3. page size / limit are clamped, and mappers produce the wire shapes.
 *
 * Build first: `npm run build` (or `tsc --build`), then `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReadOnly,
  buildKpiSummary,
  buildListApplications,
  buildTopApplicants,
  buildTopInventors,
  clampLimit,
  clampPageSize,
  mapKpiSummary,
  mapListApplications,
  mapTopApplicants,
  mapTopInventors,
} from './dist/queries.js';

const isSelectOnly = (sql) => /^\s*select\b/i.test(sql);

test('kpiSummary: read-only, no params, computes grant rate', () => {
  const q = buildKpiSummary();
  assert.ok(isSelectOnly(q.text));
  assert.doesNotThrow(() => assertReadOnly(q.text));
  assert.equal(q.params.length, 0);
  assert.match(q.text, /gold_fact_application/);

  const kpi = mapKpiSummary({
    totalApplications: 390751,
    granted: 122653,
    totalPublications: 420844,
  });
  assert.deepEqual(kpi, {
    totalApplications: 390751,
    granted: 122653,
    grantRatePct: 31.4,
    totalPublications: 420844,
  });
});

test('listApplications: filters are parameterized, not concatenated', () => {
  const q = buildListApplications({
    page: 2,
    pageSize: 10,
    country: "US'; DROP TABLE x--",
    techArea: 'Biotechnology',
    granted: true,
  });
  assert.ok(isSelectOnly(q.text));
  // The malicious value must appear ONLY as a bound param, never in the SQL text.
  assert.ok(!q.text.includes('DROP TABLE'));
  const names = q.params.map((p) => p.name).sort();
  assert.deepEqual(names, ['country', 'granted', 'limit', 'offset', 'techArea']);
  const byName = Object.fromEntries(q.params.map((p) => [p.name, p.value]));
  assert.equal(byName.offset, 10); // (page 2 - 1) * pageSize 10
  assert.equal(byName.limit, 10);
  assert.equal(byName.granted, 1);
  assert.equal(byName.country, "US'; DROP TABLE x--");
  assert.match(q.text, /OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
});

test('listApplications: page size is clamped to the max', () => {
  const q = buildListApplications({ page: 1, pageSize: 100000 });
  const limit = q.params.find((p) => p.name === 'limit').value;
  assert.equal(limit, 100); // LIMITS.applicationsMaxPageSize
  assert.equal(clampPageSize(0), 25); // default
  assert.equal(clampPageSize(9999), 100);
});

test('listApplications: mapper shapes rows + reads window total', () => {
  const res = mapListApplications(
    [
      {
        applicationNumber: 'EP12345678',
        title: 'A widget',
        filingDate: '2010-05-01',
        countryCode: 'DE',
        countryName: 'Germany',
        techArea: 'Electrical machinery',
        granted: 1,
        publicationCount: 3,
        totalRows: 42,
      },
    ],
    { page: 1, pageSize: 25 }
  );
  assert.equal(res.total, 42);
  assert.equal(res.page, 1);
  assert.equal(res.pageSize, 25);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].granted, true);
  assert.equal(res.rows[0].publicationCount, 3);
  assert.equal(res.rows[0].applicationNumber, 'EP12345678');
});

test('topApplicants / topInventors: clamped, parameterized, read-only', () => {
  const a = buildTopApplicants({ limit: 999 });
  assert.ok(isSelectOnly(a.text));
  assert.equal(a.params[0].name, 'limit');
  assert.equal(a.params[0].value, 50); // LIMITS.topMaxLimit
  assert.match(a.text, /gold_bridge_application_applicant/);

  const i = buildTopInventors({});
  assert.equal(i.params[0].value, 10); // default
  assert.match(i.text, /gold_bridge_application_inventor/);
  assert.equal(clampLimit(-5), 10);

  assert.deepEqual(mapTopApplicants([{ applicant: 'Siemens', applicationCount: 5 }]), [
    { applicant: 'Siemens', applicationCount: 5 },
  ]);
  assert.deepEqual(mapTopInventors([{ inventor: 'Ada L.', applicationCount: 7 }]), [
    { inventor: 'Ada L.', applicationCount: 7 },
  ]);
});

test('assertReadOnly rejects mutating SQL', () => {
  assert.throws(() => assertReadOnly('DELETE FROM gold_fact_application'));
  assert.throws(() => assertReadOnly('update gold_dim_country set x=1'));
  assert.doesNotThrow(() => assertReadOnly('SELECT 1'));
});
