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

# MAGIC %%sql
# MAGIC 
# MAGIC update fact_sales_daily
# MAGIC set sku_code = 'IQOS-BB'
# MAGIC where sku_code = 'VEEV-BB'

# METADATA ********************

# META {
# META   "language": "sparksql",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# MAGIC %%sql
# MAGIC SELECT * FROM gold_pricing_signal

# METADATA ********************

# META {
# META   "language": "sparksql",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
