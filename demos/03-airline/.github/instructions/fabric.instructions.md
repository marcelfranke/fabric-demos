---
applyTo: "fabric/**"
---

# Fabric items

- Each item is a folder named `<DisplayName>.<ItemType>` with its definition parts, as produced by Fabric Git integration. Fetch the definition article for the item type on Microsoft Learn before writing a definition by hand, and keep the link in a `README.md` next to the item.
- Ontology item names start with a letter and contain only letters, numbers and underscores. Use the TMDL definition (new experience), not the old JSON one.
- Deploy with `fabric/deploy.py` (fabric-cicd). Environment-specific IDs are replaced through `fabric/parameter.yml`; never commit workspace or item GUIDs into definitions.
- After a deployment, read the definition back with `getDefinition` and compare it with the repository copy. Report differences instead of overwriting.
- KQL and T-SQL scripts are idempotent (`.create-merge`, `.create-or-alter`, `IF NOT EXISTS`).
- A feature that only works in the portal goes into `docs/manual-steps.md` with the exact clicks.
