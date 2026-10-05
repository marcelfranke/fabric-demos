---
description: "Phase 6: Ontology"
---
# Phase 6: Ontology

Before you start, read `.github/copilot-instructions.md`, `docs/demo-spec.md` and `scenario/qr004.yaml`. Work on this phase only. Look up every platform API with the Microsoft Learn tools before you use it.

**Goal.** The shared context: entity types, relationships, bindings and rules, deployed from a definition in the repository.

## Task

Build the ontology as a TMDL definition (new experience). Fetch the full ontology definition article, the data binding article and the business rules article first, and follow their syntax exactly. PREVIEW: ontology.

1. `fabric/workspace/HubOntology.Ontology/` with:
   - entity types `Flight`, `Passenger`, `Member`, `Connection`, `Bag`, `Gate`, `CargoShipment`, each with a key and the properties from section 2.1 of `docs/demo-spec.md`. Leave `passport_no` and `contact_phone` out of the ontology.
   - relationships: Passenger holds Connection; Connection arrives on Flight; Connection departs on Flight; Passenger is Member; Bag belongs to Passenger; Bag transfers to Flight; Flight uses Gate; CargoShipment transfers to Flight.
   - bindings to the lakehouse tables. Bind the arrival time updates of a flight as time series data from the eventhouse; the binding article documents eventhouse and lakehouse sources. If the TMDL definition cannot express that binding, bind to the lakehouse copy of the events and note it in `docs/status.md`.
   - business rules in natural language, one per rule in section 3 and 4 of the specification, each linked to the entity types it mentions. Generate the rule texts at deployment time from the scenario file so the numbers are not typed twice.
2. `fabric/deploy_ontology.py --env <name> [--dry-run]`: creates or updates the item through the item definition API, reads the definition back and reports any difference outside the platform-owned parts.
3. `docs/ontology.md`: a diagram of the entity types and relationships, and the list of rules.
4. A fallback that is documented, not automated: build the ontology with the ontology agent in the portal, then export it with `getDefinition` into the repository.

## Done when

- The deployment script runs twice and the read-back shows no differences in the parts you supplied.
- The ontology opens in the portal and shows seven entity types with data.

## Steps for a person

Do not try to automate these. Write them into `docs/manual-steps.md` with the documentation link and a way to check the result.

- Coordinate with the delivery partner before this phase if they model the same business domain in their proof of value. One ontology per domain, not two.
- Review the ontology in the portal once. Check that each entity type shows instances.
- Publish the ontology if the portal asks for it; unpublished items cannot be reached by agents.

## Documentation to fetch first

- [Ontology definition (TMDL, new experience)](https://learn.microsoft.com/rest/api/fabric/articles/item-management/definitions/ontology-definition)
- [Data binding in ontology](https://learn.microsoft.com/fabric/iq/ontology/how-to-bind-data)
- [Business rules in ontology](https://learn.microsoft.com/fabric/iq/ontology/how-to-use-rules)
- [Ontology agent](https://learn.microsoft.com/fabric/iq/ontology/how-to-use-ontology-agent)
- [Ontology overview](https://learn.microsoft.com/fabric/iq/ontology/overview)

## When you finish

1. Run `ruff check .` and `pytest -q` and fix what fails.
2. Update `docs/status.md` for this phase: what was built, what was verified and how, what is open.
3. Close or update the entries in `docs/verify-list.md` that this phase touched. Add new ones for anything you could not confirm in documentation.
4. Report the files you created, the checks you ran with their results, and everything you could not do. Then stop. Do not start the next phase.
