# EP Patents — Angular Dashboard

A customer-facing dashboard built on Rayfin for exploring **European patent
publications** and their applicants, inventors and classifications. It uses an
"Editorial Ink" design system: dark ink palette, acid-lime accent, Fraunces
display serif + DM Sans + JetBrains Mono. Collapsible left rail, sticky frosted
topbar, KPI grid, an IPC-section chart, and editorial-style list + detail views
for patents and applicants.

The data model mirrors the field names of the curated European Patents semantic
model (see [`fabric/`](./fabric)), so the app doubles as a lightweight,
write-enabled front end over the same domain.

## Power BI report

A validated 3-page / 21-visual Power BI report (PBIR) bound to the deployed
Direct Lake semantic model lives in [`powerbi/`](./powerbi). The report passes
validation (0 errors), but this tenant's Power BI ring currently rejects PBIR
**API** import (its `version.json` schema is too new — "edited in a newer
version of Power BI…"). To publish it, open
[`powerbi/European Patents.pbip`](./powerbi/European%20Patents.pbip) in Power BI
Desktop and publish from there. See [`powerbi/README.md`](./powerbi/README.md)
for full details. The Fabric data backend it sits on is documented in
[`fabric/`](./fabric).

## Two starting points, picked on first launch

| Mode | Data | UI writes | Best for |
|---|---|---|---|
| **Sample** | Seeded with ~10 realistic EP publications, each with applicants, inventors and classifications. | All CRUD enabled. | Demoing the dashboard against representative data. |
| **Empty** | You create everything by hand. | All CRUD enabled. | Building your own catalogue on top of the layout. |

## Domain model

| Entity | Grain | Key fields |
|---|---|---|
| **Patent** | One publication | `patent_number`, `kind_code`, `publication_country`, `publication_date`, `application_number`, `filing_date`, `language`, `title_en`, `main_ipc`, `ipc_section`, `first_applicant`, `applicant_country`, `inventor_count` |
| **Applicant** | Many per patent | `name`, `country`, `sequence` |
| **Inventor** | Many per patent | `name`, `country`, `sequence` |
| **Classification** | Many per patent | `symbol`, `scheme` (IPC/CPC), `section` |

`Patent` holds `@many(() => …)` relationships to its three children; each child
holds `@one(() => Patent)`. A singleton `AppConfig` row tracks the chosen
`setup_mode` (`pending | empty | sample`) and `seeded_at`.

## Design system at a glance

- **Palette** — deep ink (`#0a0911`), cream text (`#f4ecdf`), one acid
  accent (`#d4ff3a`). All Material 3 tokens are remapped via CSS custom
  properties in `src/styles.scss`.
- **Type** — Fraunces (variable serif) for headings + numbers, DM Sans
  for UI, JetBrains Mono for captions / data / mono pills.
- **Components** — rounded pills, hairline borders, status dots with
  soft glow, page-enter staggered animation.

## Getting started

```bash
# Deploy to Fabric (or start the local backend) and start the Angular dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), sign in, and you'll land
on the **setup wizard** where you can load the sample patents or start empty.
Local dev uses the mock auth path; deployed, it uses Fabric Entra SSO.

## Stack

- **Angular 21** standalone components, signals, lazy routes.
- **Angular Material 21** + **CDK** as the component foundation (with
  CSS custom-property overrides to keep Material out of the way visually).
- **chart.js** + **ng2-charts** for the dashboard chart.
- **Rayfin** for auth, the data backend, and the `RayfinClient` SDK.
- **uuid** for row ids when seeding sample data.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml                 # Rayfin service config (auth + data)
│   └── data/
│       └── schema.ts              # Patent, Applicant, Inventor, Classification, AppConfig
├── src/
│   ├── main.ts                    # Bootstrap + Rayfin client init
│   ├── services/                  # Framework-agnostic Rayfin client + auth
│   ├── app/
│   │   ├── app.routes.ts          # Lazy routes (/auth, /setup, /, /patents, /applicants, /settings)
│   │   ├── auth.guard.ts          # Auth + no-auth route guards
│   │   ├── setup.guard.ts         # Routes user to /setup on first run
│   │   ├── shell/                 # Top toolbar + collapsible side nav
│   │   ├── services/
│   │   │   ├── data.service.ts    # Patent + child-entity wrapper around the data client
│   │   │   ├── app-config.service.ts  # Singleton-row config + canWrite() signal
│   │   │   ├── seed.service.ts    # Inserts ~10 sample EP patents
│   │   │   ├── auth-state.ts      # Signal-based auth state
│   │   │   └── constants.ts       # APP_CONFIG_ID
│   │   └── pages/
│   │       ├── auth/              # Sign-in page
│   │       ├── setup/             # First-launch wizard (sample vs empty)
│   │       ├── dashboard/         # KPI cards + IPC chart + recent publications
│   │       ├── patents/          # Patents list + detail (with child entities)
│   │       ├── applicants/       # Applicant leaderboard
│   │       └── settings/          # Current mode, re-seed, reset
└── package.json
```

## Views in depth

### Dashboard

KPI cards (Total Patents, Distinct Applicants, Distinct Inventors, Avg
Inventors/Patent), a patents-by-IPC-section bar chart, a recent-publications
list, and a top-applicants strip.

### Patents

Card grid with a **New Patent** dialog and delete (deletes cascade to the
patent's applicants, inventors and classifications). The detail view shows the
publication metadata hero plus the three child lists.

### Applicants

A leaderboard aggregating patents by applicant name.

### Switching modes

Settings → **Reset workspace** wipes every patent (and its children) and
returns you to the setup wizard. **Re-seed** reloads the sample patents.

## Caveats — read this

- **CRUD is UI-level, not a security boundary.** The schema entities are
  annotated `@authenticated('*')`, so the backend accepts mutations from anyone
  signed in. If you need server-enforced restrictions, add a custom
  `@authenticated` policy.

- **Sample data is illustrative.** The seeded patents mirror the semantic-model
  field names but are not a live Direct Lake binding — they're rows created via
  the Rayfin data backend so the dashboard has representative content offline.

## Environment overrides

The setup wizard writes its choice to the `AppConfig` table. You can override
that at boot via `.env`:

```bash
# .env.local
VITE_SETUP_MODE=sample           # 'sample' | 'empty'
```

When `VITE_SETUP_MODE` is set, the wizard is skipped entirely.

## Scripts

```bash
npm run dev      # rayfin up + ng serve --port 5173
npm run build    # production bundle in ./dist/
npm run lint     # eslint
npm test         # karma + jasmine (set CHROME_BIN if needed)
```

## Notes

- Side-menu collapsed state persists in `localStorage` under
  `dashboard.sidenav.collapsed`.
- The singleton `AppConfig` row uses a hardcoded UUID
  (`00000000-0000-0000-0000-000000000001`); concurrent first-creates handle
  the conflict by refetching.
- Schema decorators are TC39 stage-3, so `tsconfig.json` enables
  `ESNext.Decorators` and leaves `experimentalDecorators` off.

## Useful links

- Rayfin docs: <https://aka.ms/rayfin/docs>
- Angular Material: <https://material.angular.dev>
- ng2-charts: <https://valor-software.com/ng2-charts/>
