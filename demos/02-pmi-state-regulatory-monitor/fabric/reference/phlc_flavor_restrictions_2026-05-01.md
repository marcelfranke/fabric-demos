# PHLC Flavor-Restriction Source — Spike Findings

**Source:** Public Health Law Center — *U.S. Sales Restrictions on Flavored Tobacco Products Map*
<https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map>
**Current as of:** May 1, 2026 · **Retrieved:** July 16, 2026 · **Spike source — now a committed reference artifact.**

## How the data was pulled (and a gotcha worth recording)
The task assumed a browser `User-Agent` would defeat the site's 403. **It did not, from this environment.**
`publichealthlawcenter.org` sits behind an nginx caching proxy (signature headers `host-header: <hash>` +
`x-proxy-cache-info: DT:1`) that returns a **cached 403 to this datacenter's egress IP on every path** (even `/`),
regardless of a full browser header set, `curl.exe`, or a cookie warm-up. It is an IP/range block, not a JS/WAF
challenge. **Node's built-in `fetch` and `curl` both fail; only the `web_fetch` tool succeeds** (different infra/IP).
`scratch/phlc/pull.mjs` (the Node fetcher) is therefore inert from here — kept for reference; the live data below came
via `web_fetch`.

**Classification method (authoritative):** every jurisdiction has a detail page `.../map/<code>`. A **red**
(restricted) state returns an HTML table; a **gray** state returns **HTTP 404**. I probed **all 50 states + DC (51
pages)** → 16 tables, 35 × 404. On each table, a `State Policy` row (or the full state/district name) ⇒ **STATEWIDE**;
only cities/counties ⇒ **LOCAL-ONLY**.

## The 16 red jurisdictions (complete, confirmed live)
`CA, CO, DC, IL, MA, MD, ME, MN, MT, NJ, NY, OH, OR, PA, RI, UT` — exactly matches the expected ~16.

| Code | Scope | Local jurisdictions listed | Notes |
|------|-------|----------------------------|-------|
| CA | **statewide** | 40+ cities/counties | `State Policy` + long city list (table truncated at fetch cap) |
| DC | **statewide** | — (Washington D.C.) | district-wide |
| MA | **statewide** | 9 (Boston, Cambridge, Somerville, Worcester…) | `State Policy` + cities |
| MD | **statewide** | 1 (Montgomery County) | `State Policy` + county |
| ME | **statewide** | 0 | `State Policy` only |
| NY | **statewide** | 5 (NYC, Yonkers, Nassau County…) | `State Policy` + cities |
| RI | **statewide** | 1 (Providence) | `State Policy` + city |
| UT | **statewide** | 0 | `State Policy` only |
| CO | local_only | 2 (Boulder, Denver) | no `State Policy` row |
| IL | local_only | 2 (Chicago, Evanston) | |
| MN | local_only | 7 (Minneapolis, Saint Paul, Duluth, Hennepin County…) | |
| MT | local_only | 1 (Missoula) | |
| NJ | local_only | 2 (Jersey City, Paterson) | ⚠️ see conflict below |
| OH | local_only | 2 (Columbus, Toledo) | |
| OR | local_only | 2 (Multnomah County, Washington County) | |
| PA | local_only | 1 (Philadelphia) | |

**Statewide (8):** CA · DC · MA · MD · ME · NY · RI · UT
**Local-only (8):** CO · IL · MN · MT · NJ · OH · OR · PA

## Diff vs our current curated 6 (`FLAVOR_BAN_STATES = {CA, MA, NJ, NY, RI, UT}`)
- **5 of 6 confirmed STATEWIDE by PHLC:** CA, MA, NY, RI, UT ✅
- **1 conflict — NJ:** PHLC lists **only Jersey City + Paterson (local-only)**, no `State Policy` row. But NJ **did**
  enact a **statewide** flavored e-cigarette sales ban in 2020 (P.L.2019 c.462, eff. Apr 2020). Most likely a
  **methodology gap**: this PHLC map tracks *flavored tobacco* broadly (incl. menthol/combustibles); NJ's ban is
  e-cig-only, so it doesn't surface as a statewide "flavored tobacco" State Policy here. **PHLC is not authoritative
  for NJ's vape flavor ban** — keep NJ if the demo's scope is vapor/pouch.
- **10 extra red states we don't currently list:** CO, DC, IL, MD, ME, MN, MT, OH, OR, PA
  - **would add as STATEWIDE:** **DC, MD, ME**
  - local-only (would NOT add as a statewide ban): CO, IL, MN, MT, OH, OR, PA

### If we adopted PHLC "statewide" as the flavor-ban criterion
Statewide set becomes **{CA, DC, MA, MD, ME, NY, RI, UT}** (8) — i.e. **+DC, +MD, +ME** and **−NJ** vs our current 6.
That is the core decision: gain 3 genuine statewide bans, but lose NJ (a real vape ban PHLC undercounts). Recommended:
adopt PHLC statewide list **and keep NJ** as a curated override, dated to the retrieval (May 1, 2026).

## Raw parser evidence
**CO — expected local-only (Boulder + Denver):**
```
The following jurisdictions have a population of at least 75,000 and have enacted a flavor restriction:
| Jurisdiction | Flavor prohibited? | Menthol prohibited? | ... |
| Boulder      |                    |                     |     |
| Denver       |                    |                     |     |
```
**CA — expected statewide (`State Policy` present):**
```
The following jurisdictions have a population of at least 75,000 and have enacted a flavor restriction:
| Jurisdiction        | Flavor prohibited? | ... |
| State Policy        |                    |     |
| Alameda             |                    |     |
| Alameda County      |                    |     |
| ... (Berkeley, Los Angeles, Oakland, San Francisco, San Jose, San Diego, ... 40+)
```

## Honest caveats
- The per-column booleans (`Flavor prohibited?`, `Menthol prohibited?`, `All tobacco products?`, `Covers all
  retailers?`, `Case law?`) render as **icons, not text**, so they come through **empty** in the extracted markdown —
  `flavor_prohibited` / `menthol_prohibited` are **not determinable** from this pull and are left `null`. Confirming
  them would need the live SVG/icon layer or the linked PDF resource.
- "Statewide" here = a `State Policy` row exists; it does **not** distinguish menthol-only vs all-flavors vs e-cig-only
  scope. NJ shows exactly why that nuance matters.
- Data is "current as of May 1, 2026" and updated periodically — treat any adopted list as a **dated point-in-time
  snapshot**.
- Live pull only works via the `web_fetch` path from this environment; a browser-side or datacenter Node/curl sync
  would be **403-blocked**. If wired into the notebook/app, fetch server-side from an un-blocked IP (or cache the
  snapshot) — do **not** assume a UA header is enough.
