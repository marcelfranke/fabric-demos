# Fabric Demos

A monorepo collecting standalone demo applications. Each demo lives in its own
folder under [`demos/`](./demos) and is self-contained with its own dependencies
and instructions.

## Demos

| # | Demo | Description |
|---|------|-------------|
| 01 | [Angular Dashboard (Atelier)](./demos/01-angular-dashboard) | A customer-facing Angular dashboard built on Rayfin with an "Editorial Ink" design system — collapsible rail, frosted topbar, KPI grid, chart, and editorial list/detail views. Runs in Scratch or GitHub-sync mode. |

## Getting started

Pick a demo from the table above and follow the README inside its folder. For
example, to run the Angular Dashboard demo:

```bash
cd demos/01-angular-dashboard
npm install
npm run dev
```
