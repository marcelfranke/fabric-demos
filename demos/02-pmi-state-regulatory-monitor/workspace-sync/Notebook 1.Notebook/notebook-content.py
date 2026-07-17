# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "e3c9f128-9200-4963-890d-26c5f76bf81a",
# META       "default_lakehouse_name": "pmi_lakehouse",
# META       "default_lakehouse_workspace_id": "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05",
# META       "known_lakehouses": [
# META         {
# META           "id": "e3c9f128-9200-4963-890d-26c5f76bf81a"
# META         }
# META       ]
# META     }
# META   }
# META }

# CELL ********************

# Welcome to your new notebook
# Type here in the cell editor to add code!

sql_query = """
select
fs.*,
s.id as state_id,
p.id as program_id
from fact_sales_daily fs 
inner join gold_dim_state s on fs.state = s.state
inner join gold_dim_program p on fs.program = p.name
"""

# 2. Führt die Abfrage aus und speichert das Ergebnis in einem DataFrame
df = spark.sql(sql_query)

# 3. Schreibt das Ergebnis als neue Delta-Tabelle in Ihr Lakehouse
df.write.format("delta").mode("overwrite").saveAsTable("fact_sales_daily_2")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
