# Microsoft EP Brand — Power BI report theme

`microsoft-ep-brand-theme.json` is the Power BI / Fabric report theme that
matches the Microsoft **Fluent** brand applied to the Rayfin Angular app in
this demo. Same hexes, same series order — so the workspace report and the
app stay visually identical.

## Palette (identical to the app)

| Token | Hex |
| --- | --- |
| Series 1 (Microsoft Red) | `#F25022` |
| Series 2 (Microsoft Green) | `#7FBA00` |
| Series 3 (Microsoft Blue) | `#00A4EF` |
| Series 4 (Microsoft Yellow) | `#FFB900` |
| Series 5 (Fluent primary blue) | `#0078D4` |
| Series 6 (neutral) | `#605E5C` |
| Foreground / primary text | `#201F1E` |
| Secondary text | `#605E5C` |
| Background | `#FAF9F8` |
| Table accent / primary | `#0078D4` |
| Good | `#107C10` |
| Neutral | `#FFB900` |
| Bad | `#D13438` |
| Font family (all text classes) | Segoe UI |

## How to apply it to the live workspace report (manual — REQUIRED here)

> **Why manual?** This workspace's Git integration is **Commit-only**. We do
> **not** run *Update* (Git → workspace), because the current service ring can
> reject the Report item on Update. There is also no clean public REST endpoint
> to set/import a theme onto an *already-published* service report (themes are
> stored inside the report definition). So the safe, supported path is to apply
> the theme in the service, then **Commit** (workspace → Git).

1. Open the **European Patents** workspace in the Power BI / Fabric service
   (workspace id `5e0747bf-be6c-449b-b0cc-1911bd54577f`).
2. Open the **European Patents** report.
3. Click **Edit** to enter editing mode.
4. On the ribbon go to **View → Themes → Browse for themes**.
5. Select this file: `microsoft-ep-brand-theme.json`.
6. **Save** the report.

## After applying — commit direction only

Once the theme is applied and saved in the service, capture it into Git with a
**Commit (workspace → Git)** from the workspace's *Source control* pane. This
serializes the theme into the report's PBIR definition
(`report.json` → `themeCollection` + a registered resource under
`StaticResources/`).

**Do NOT run *Update* (Git → workspace).** Only Commit (workspace → Git) is
allowed for this workspace.
