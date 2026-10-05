# fabric

Fabric item definitions and the scripts that deploy them.

The lakehouse, the eventhouse, the SQL database, the pipelines, the ontology, the
user data functions, the Activator rule and the data agent.

Item definitions are source. Deployment is a script in here, not a click path. If
something cannot be deployed from here, it goes in `docs/manual-steps.md` with the
reason and the documentation link.

Workspace and item identifiers are parameters or resolved at run time. No GUIDs in
the files.
