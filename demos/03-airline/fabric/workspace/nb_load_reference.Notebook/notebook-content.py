# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "11111111-1111-1111-1111-111111111111",
# META       "default_lakehouse_name": "lh_hub",
# META       "default_lakehouse_workspace_id": "22222222-2222-2222-2222-222222222222"
# META     }
# META   }
# META }

# PARAMETERS CELL ********************

# The two GUIDs in the metadata block above are placeholders. fabric/workspace/parameter.yml
# replaces them per environment with the real lakehouse and workspace IDs.
# find_replace is the documented fabric-cicd mechanism for text files such as notebooks:
# https://microsoft.github.io/fabric-cicd/latest/how_to/parameterization/

LANDING_PATH = "Files/landing"
WRITE_MODE = "overwrite"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Discover the Parquet files that scripts/upload_landing.py placed in the landing folder.
# The table names are not listed here on purpose: the set of reference tables is defined
# once in src/hubdemo/models.py (ROW_TABLES) and each file is named after its table.
# notebookutils.fs.ls lists a folder in lakehouse storage:
# https://learn.microsoft.com/fabric/data-engineering/notebookutils/notebookutils-file-system

landing = [
    entry
    for entry in notebookutils.fs.ls(LANDING_PATH)  # noqa: F821 - provided by the Fabric runtime
    if entry.name.endswith(".parquet")
]
landing.sort(key=lambda entry: entry.name)

if not landing:
    raise RuntimeError(
        f"No Parquet files found in {LANDING_PATH}. "
        "Run scripts/upload_landing.py before running this notebook."
    )

print(f"Found {len(landing)} Parquet file(s) in {LANDING_PATH}.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Write one Delta table per file, replacing whatever was there before, then print the row
# count so the run is self-verifying. Re-running the notebook gives the same result, which
# is what rule 9 (idempotent) asks for.

counts = {}

for entry in landing:
    table_name = entry.name[: -len(".parquet")]
    frame = spark.read.parquet(entry.path)  # noqa: F821 - provided by the Fabric runtime
    frame.write.mode(WRITE_MODE).format("delta").saveAsTable(table_name)
    counts[table_name] = frame.count()

for table_name in sorted(counts):
    print(f"{table_name}: {counts[table_name]} rows")

print(f"Loaded {len(counts)} table(s) into the default lakehouse.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
