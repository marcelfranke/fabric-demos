# Fabric Git Integration — European Patents workspace

How to connect the **European Patents** Fabric workspace to the
`marcelfranke/fabric-demos` GitHub repo so workspace artifacts sync into Git.

> **Design decision:** Fabric Git integration is *opinionated* about layout — it
> writes each artifact as an `<Item>.<Type>/` folder at the **root of the mapped
> folder** and effectively **owns that folder**. To avoid it clobbering the
> hand-curated demo content (`fabric/`, `powerbi/`, `README.md`), we give Fabric
> its **own folder on its own branch**: `workspace-sync/` on branch
> `fabric-sync`. The curated `main` content stays clean; the Fabric-managed truth
> lives separately.

## Target layout

```
demos/01-european-patents/
├── README.md              ← curated narrative (main)
├── fabric/                ← curated, hand-picked artifacts (main)
├── powerbi/               ← curated report (main)
└── workspace-sync/        ← Fabric owns this (branch: fabric-sync)
    ├── eps_lakehouse.Lakehouse/
    ├── European Patents.SemanticModel/
    ├── European Patents.Report/
    └── <notebooks, pipelines, ...>
```

- **Branch:** `fabric-sync` (keeps Fabric's auto-serialized commits off `main`).
- **Mapped folder:** `demos/01-european-patents/workspace-sync`.

## Prerequisites

- Workspace admin/member role on **European Patents**.
- The workspace must be on a **Fabric capacity** (Git integration is not
  available on a Pro/PPU-only workspace).
- GitHub account with write access to `marcelfranke/fabric-demos`.
- Tenant admin setting **"Users can sync workspace items with GitHub repos"**
  enabled (Admin portal → Tenant settings → Git integration).

## One-time: create the branch + folder

Fabric can create the branch on connect, but it's cleaner to seed it yourself so
the folder exists:

```bash
# from a clone of the repo
git checkout main && git pull
git checkout -b fabric-sync
mkdir -p "demos/01-european-patents/workspace-sync"
echo "# Fabric-managed sync folder — do not hand-edit. Owned by the European Patents workspace." \
  > "demos/01-european-patents/workspace-sync/README.md"
git add -A && git commit -m "Seed Fabric Git sync folder for European Patents workspace"
git push -u origin fabric-sync
```

## Connect the workspace (Fabric UI)

1. Open the **European Patents** workspace → **Workspace settings** → **Git
   integration**.
2. **Git provider:** GitHub. Sign in / authorize the GitHub app when prompted.
3. Select:
   - **Repository:** `marcelfranke/fabric-demos`
   - **Branch:** `fabric-sync`
   - **Folder:** `demos/01-european-patents/workspace-sync`
4. Click **Connect and sync**.

## First sync — Commit only (safe)

After connecting, the **Source control** panel shows every workspace item as an
uncommitted change.

- Run **Commit** (workspace → Git). This is a pure *export* and is the safe
  direction. It writes all artifact folders into `workspace-sync/`.
- **Do NOT run *Update* (Git → workspace) yet** — see the caution below.

## ⚠️ Tenant caution (this specific tenant)

This tenant is on an **older Power BI service ring** — the same reason the PBIR
**API import** of the report failed earlier (`version.json` schema "not
compatible with your current version").

- **Commit** (workspace → Git) = export only → **safe** for all item types.
- **Update** (Git → workspace) uses an import path that **may reject the Report**
  item with the same version error. Notebooks, lakehouse, and semantic model
  usually round-trip fine.
- **Recommendation:** treat this integration as **Commit-only** for now (use it
  to back the workspace up into Git). Only try **Update** once you've confirmed
  the Report round-trips, or once the tenant ring has rolled forward.

## Round-trip test (optional, before relying on Update)

1. In Fabric, make a trivial change to a **notebook** (add a comment cell).
2. **Commit** → verify the diff appears on `fabric-sync` in GitHub.
3. Edit that same notebook file in Git (tiny change) → **Update** in Fabric →
   confirm it applies cleanly. If Update fails on the Report specifically, keep
   the Report out of the Update flow (or manage it via Desktop publish as before).

## How this differs from what's already in the repo

- `main` keeps your **curated** demo (`fabric/`, `powerbi/`) — human-readable,
  good for people browsing the demo. Unaffected by Fabric.
- `fabric-sync` holds Fabric's **verbatim serialization** under
  `workspace-sync/` — the source of truth for the live workspace.
- Merge `fabric-sync` → `main` only if you deliberately want the raw Fabric
  layout on `main`. For a demo repo, keeping them separate is cleaner.

## Docs

- [Fabric Git integration overview](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration)
- [Connect and sync (GitHub)](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/git-get-started)
