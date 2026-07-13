# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "adcba2df-ba38-48dd-a5b4-07dbde1a01ee",
# META       "default_lakehouse_name": "eps_lakehouse",
# META       "default_lakehouse_workspace_id": "5e0747bf-be6c-449b-b0cc-1911bd54577f"
# META     }
# META   }
# META }

# PARAMETERS CELL ********************

# EPS 2026 ingestion parameters
# Weekly publication dates to load (YYYYMMDD). Default: January 2026 (4 weeks).
DATES = ["20260107", "20260114", "20260121", "20260128"]
# Number of Spark partitions for parallel HTTP fetch (controls polite concurrency).
FETCH_PARTITIONS = 24
# Write mode for bronze/silver/gold tables: 'overwrite' (fresh) or 'append' (backfill).
WRITE_MODE = "overwrite"


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# European Publication Server (EPS) - Medallion ingestion
# Bronze -> Silver -> Gold Delta tables in the attached lakehouse (eps_lakehouse).
import time
from pyspark.sql import Row
from pyspark.sql import functions as F
from pyspark.sql.types import (StructType, StructField, StringType, ArrayType)

BASE = "https://data.epo.org/publication-server/rest/v1.2"
print("Loading dates:", DATES, "| partitions:", FETCH_PARTITIONS, "| mode:", WRITE_MODE)


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === BRONZE 1/2: weekly patent lists ===
import re, urllib.request
def http_get(url, retries=4, timeout=60):
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fabric-eps-demo"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return r.read().decode("utf-8", "replace")
                last = f"HTTP {r.status}"
        except Exception as e:
            last = str(e)
        time.sleep(2 ** a)
    raise RuntimeError(f"GET failed {url}: {last}")

rows = []
for d in DATES:
    html = http_get(f"{BASE}/publication-dates/{d}/patents")
    nums = sorted(set(re.findall(r'patents/([A-Z0-9]+)"', html)))
    print(f"{d}: {len(nums)} patents")
    for n in nums:
        rows.append((d, n))

weekly = spark.createDataFrame(rows, ["publication_date", "patent_number"]).dropDuplicates()
weekly.write.format("delta").mode(WRITE_MODE).saveAsTable("bronze_weekly_lists")
print("bronze_weekly_lists rows:", weekly.count())


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === BRONZE 2/2: download each patent XML, keep the SDOBI biblio block ===
def fetch_partition(part):
    import urllib.request, time as _t
    for r in part:
        d = r["publication_date"]; num = r["patent_number"]
        url = f"{BASE}/patents/{num}/document.xml"
        xml = None; err = None
        for a in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "fabric-eps-demo"})
                with urllib.request.urlopen(req, timeout=90) as resp:
                    if resp.status == 200:
                        xml = resp.read().decode("utf-8", "replace"); break
                    else:
                        err = f"HTTP {resp.status}"
            except Exception as e:
                err = str(e)
            _t.sleep(2 ** a)
        sdobi = None
        if xml:
            i = xml.find("<SDOBI"); j = xml.find("</SDOBI>")
            if i >= 0 and j >= 0:
                sdobi = xml[i:j + 8]
        yield Row(publication_date=d, patent_number=num, sdobi_xml=sdobi, error=err)

schema = StructType([
    StructField("publication_date", StringType()),
    StructField("patent_number", StringType()),
    StructField("sdobi_xml", StringType()),
    StructField("error", StringType()),
])
src = spark.table("bronze_weekly_lists").repartition(FETCH_PARTITIONS)
raw = spark.createDataFrame(src.rdd.mapPartitions(fetch_partition), schema)
raw.write.format("delta").mode(WRITE_MODE).saveAsTable("bronze_patent_sdobi")
ok = spark.table("bronze_patent_sdobi").filter("sdobi_xml is not null").count()
bad = spark.table("bronze_patent_sdobi").filter("sdobi_xml is null").count()
print(f"bronze_patent_sdobi -> ok={ok} failed={bad}")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === SILVER: parse SDOBI into a normalized struct, then explode ===
from pyspark.sql.types import StructType, StructField, StringType, ArrayType

party = StructType([StructField("name", StringType()), StructField("country", StringType()),
                    StructField("iid", StringType()), StructField("seq", StringType())])
prio = StructType([StructField("number", StringType()), StructField("date", StringType()),
                   StructField("country", StringType())])
title = StructType([StructField("lang", StringType()), StructField("text", StringType())])
parse_schema = StructType([
    StructField("patent_number", StringType()),
    StructField("doc_number", StringType()),
    StructField("kind_code", StringType()),
    StructField("country", StringType()),
    StructField("publication_date", StringType()),
    StructField("application_number", StringType()),
    StructField("filing_date", StringType()),
    StructField("language", StringType()),
    StructField("titles", ArrayType(title)),
    StructField("ipc", ArrayType(StringType())),
    StructField("cpc", ArrayType(StringType())),
    StructField("applicants", ArrayType(party)),
    StructField("inventors", ArrayType(party)),
    StructField("priorities", ArrayType(prio)),
])

def parse_partition(part):
    from lxml import etree
    def clean_symbol(t):
        if not t: return None
        parts = t.split()
        if len(parts) >= 2:
            return (parts[0] + " " + parts[1]).strip()
        return parts[0].strip() if parts else None
    for r in part:
        num = r["patent_number"]; xml = r["sdobi_xml"]
        if not xml:
            continue
        try:
            root = etree.fromstring(xml.encode("utf-8"))
        except Exception:
            continue
        def one(xp):
            el = root.find(xp)
            return el.text.strip() if el is not None and el.text else None
        titles = []
        b540 = root.find(".//B540")
        if b540 is not None:
            langs = [e.text for e in b540.findall("B541")]
            texts = [e.text for e in b540.findall("B542")]
            for lg, tx in zip(langs, texts):
                if tx: titles.append(Row(lang=(lg or None), text=tx.strip()))
        ipc = []
        for e in root.findall(".//B510EP/classification-ipcr/text"):
            s = clean_symbol(e.text)
            if s: ipc.append(s)
        cpc = []
        for e in root.findall(".//B520EP/classifications-cpc/classification-cpc/text"):
            s = clean_symbol(e.text)
            if s: cpc.append(s)
        applicants = []
        for i, b in enumerate(root.findall(".//B730/B731")):
            nm = b.findtext("snm"); ct = b.findtext("adr/ctry"); iid = b.findtext("iid")
            if nm: applicants.append(Row(name=nm.strip(), country=(ct or None),
                                         iid=(iid or None), seq=str(i+1)))
        inventors = []
        for i, b in enumerate(root.findall(".//B720/B721")):
            nm = b.findtext("snm"); ct = b.findtext("adr/ctry")
            if nm: inventors.append(Row(name=nm.strip(), country=(ct or None),
                                        iid=None, seq=str(i+1)))
        priorities = []
        b300 = root.find(".//B300")
        if b300 is not None:
            b310 = [e.text for e in b300.findall("B310")]
            b320 = [e.findtext("date") for e in b300.findall("B320")]
            b330 = [e.findtext("ctry") for e in b300.findall("B330")]
            for k in range(max(len(b310), len(b320), len(b330))):
                priorities.append(Row(
                    number=(b310[k].strip() if k < len(b310) and b310[k] else None),
                    date=(b320[k] if k < len(b320) else None),
                    country=(b330[k] if k < len(b330) else None)))
        yield Row(
            patent_number=num,
            doc_number=one(".//B110"),
            kind_code=one(".//B130"),
            country=one(".//B190"),
            publication_date=one(".//B140/date") or r["publication_date"],
            application_number=one(".//B210"),
            filing_date=one(".//B220/date"),
            language=one(".//B250"),
            titles=titles, ipc=ipc, cpc=cpc,
            applicants=applicants, inventors=inventors, priorities=priorities)

src = spark.table("bronze_patent_sdobi").filter("sdobi_xml is not null")
parsed = spark.createDataFrame(src.rdd.mapPartitions(parse_partition), parse_schema).cache()
print("parsed patents:", parsed.count())


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === SILVER: write normalized tables ===
title_en = F.expr("filter(titles, x -> x.lang = 'en')")
patents = (parsed
    .withColumn("title_en", F.element_at(title_en, 1)["text"])
    .withColumn("main_ipc", F.when(F.size("ipc") > 0, F.col("ipc")[0]))
    .withColumn("ipc_section", F.when(F.size("ipc") > 0, F.substring(F.col("ipc")[0], 1, 1)))
    .withColumn("publication_date", F.to_date("publication_date", "yyyyMMdd"))
    .withColumn("filing_date", F.to_date("filing_date", "yyyyMMdd"))
    .select("patent_number", "doc_number", "kind_code", "country",
            "publication_date", "application_number", "filing_date", "language",
            "title_en", "main_ipc", "ipc_section"))
patents.write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_patents")

def explode_write(colname, table, cols):
    (parsed.select("patent_number", F.explode(colname).alias("x"))
        .select(["patent_number"] + [F.col("x." + c).alias(c) for c in cols])
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable(table))

explode_write("titles", "silver_patent_titles", ["lang", "text"])
explode_write("applicants", "silver_patent_applicants", ["name", "country", "iid", "seq"])
explode_write("inventors", "silver_patent_inventors", ["name", "country", "seq"])
explode_write("priorities", "silver_patent_priorities", ["number", "date", "country"])

ipc_df = parsed.select("patent_number", F.explode("ipc").alias("symbol")).withColumn("scheme", F.lit("IPC"))
cpc_df = parsed.select("patent_number", F.explode("cpc").alias("symbol")).withColumn("scheme", F.lit("CPC"))
(ipc_df.unionByName(cpc_df).withColumn("section", F.substring("symbol",1,1))
    .write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable("silver_patent_classifications"))
print("Silver tables written.")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === GOLD: analytics-ready tables for the dashboard ===
p = spark.table("silver_patents")
appl = spark.table("silver_patent_applicants")
inv = spark.table("silver_patent_inventors")

first_appl = (appl.filter("seq = '1'")
    .select("patent_number", F.col("name").alias("first_applicant"),
            F.col("country").alias("applicant_country")))
inv_cnt = inv.groupBy("patent_number").agg(F.count("*").alias("inventor_count"))

summary = (p.join(first_appl, "patent_number", "left")
             .join(inv_cnt, "patent_number", "left")
             .fillna({"inventor_count": 0}))
summary.write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable("gold_patent_summary")

(summary.groupBy("publication_date").agg(F.count("*").alias("patent_count"))
    .orderBy("publication_date")
    .write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable("gold_publications_by_week"))
(summary.groupBy("applicant_country").agg(F.count("*").alias("patent_count"))
    .orderBy(F.desc("patent_count"))
    .write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable("gold_publications_by_country"))
(summary.groupBy("ipc_section").agg(F.count("*").alias("patent_count"))
    .orderBy("ipc_section")
    .write.format("delta").mode(WRITE_MODE).option("overwriteSchema","true").saveAsTable("gold_publications_by_ipc_section"))
print("Gold tables written.")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# === Summary ===
for t in ["bronze_weekly_lists","bronze_patent_sdobi","silver_patents",
          "silver_patent_titles","silver_patent_classifications","silver_patent_applicants",
          "silver_patent_inventors","silver_patent_priorities","gold_patent_summary",
          "gold_publications_by_week","gold_publications_by_country","gold_publications_by_ipc_section"]:
    try:
        print(f"{t:38s} {spark.table(t).count():>10,} rows")
    except Exception as e:
        print(f"{t:38s} ERROR {e}")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
