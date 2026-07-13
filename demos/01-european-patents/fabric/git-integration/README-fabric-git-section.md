## Fabric Git integration (optional)

The curated artifacts in `fabric/` and `powerbi/` are a **hand-picked snapshot**
of the workspace. If you'd rather have Fabric keep Git in sync **automatically**,
connect the **European Patents** workspace to this repo.

To avoid Fabric's opinionated layout overwriting the curated folders, it gets its
**own folder on its own branch**:

- **Branch:** `fabric-sync`
- **Mapped folder:** `demos/01-european-patents/workspace-sync/`

`main` stays curated and human-readable; `fabric-sync` holds Fabric's verbatim
serialization of the live workspace.

> ⚠️ **This tenant is on an older Power BI service ring.** Use **Commit**
> (workspace → Git, a safe export) freely; be cautious with **Update**
> (Git → workspace) — it may reject the Report item with a version-compatibility
> error, the same one that blocked the report's API import.

See **[`FABRIC-GIT-INTEGRATION.md`](./FABRIC-GIT-INTEGRATION.md)** for the full
setup: prerequisites, branch/folder seed commands, the connect flow, and a
round-trip test.
