# Fabric Demos

A monorepo collecting standalone demo applications. Each demo lives in its own
folder under [`demos/`](./demos) and is self-contained with its own dependencies
and instructions.

## Demos

| # | Demo | Description |
|---|------|-------------|
| 01 | [European Patents](./demos/European%20Patents) | Microsoft Fabric OneLake + Direct Lake Power BI semantic model over EPO patent data, with an Angular dashboard frontend. |

## Getting started

Pick a demo from the table above and follow the README inside its folder. For
example, to run the European Patents demo:

```bash
cd "demos/European Patents"
npm install
npm run dev
```
