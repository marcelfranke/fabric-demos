# Fabric Demos

A monorepo collecting standalone demo applications. Each demo lives in its own
folder under [`demos/`](./demos) and is self-contained with its own dependencies
and instructions.

## Demos

| # | Demo | Description |
|---|------|-------------|
| 01 | [European Patents](./demos/01-european-patents) | Microsoft Fabric OneLake + Direct Lake Power BI semantic model over EPO patent data, with an Angular dashboard frontend. |
| 02 | [PMI State Regulatory Monitor](./demos/02-pmi-state-regulatory-monitor) | State-by-state US dynamic-pricing screening dashboard for Philip Morris International's smoke-free lines (ZYN, VEEV, IQOS) — turns live CDC STATE System tax + flavor-ban + registry law into a per-state Pricing Signal on an action-colored US choropleth map. |

## Getting started

Pick a demo from the table above and follow the README inside its folder. For
example, to run the European Patents demo:

```bash
cd demos/01-european-patents
npm install
npm run dev
```
