# Fabric notebook source

# METADATA ********************

# META {
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "e3c9f128-9200-4963-890d-26c5f76bf81a",
# META       "default_lakehouse_name": "pmi_lakehouse",
# META       "default_lakehouse_workspace_id": "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05"
# META     }
# META   }
# META }

# PARAMETERS CELL ********************

# PMI dynamic-pricing medallion — ingestion parameters
# CDC STATE System E-Cigarette datasets (Socrata SODA, public, NO API key).
CDC_ROW_LIMIT = 1000             # rows per dataset (demo-fast, polite to Socrata)
WRITE_MODE = "overwrite"         # 'overwrite' (fresh) or 'append' (backfill)
HIGH_TAX_THRESHOLD = 20.0        # tax_burden % above this trips adjust_for_tax
ASSUMED_ML_PER_PACK = 5.0        # $/mL -> % conversion reference package
ASSUMED_RETAIL_PRICE_USD = 20.0  # documented demo assumption (NOT PMI data)


# CELL ********************

# PMI State Regulatory Monitor — dynamic-pricing medallion (Bronze -> Silver -> Gold).
# Faithfully ports the Angular app's cdc-state-sync.service.ts (normalize) and
# pricing.service.ts (computeSignals) so the Lakehouse numbers MATCH the app.
import json, re, time, traceback, urllib.request
from datetime import datetime, date, timedelta
from pyspark.sql import Row
from pyspark.sql import functions as F
from pyspark.sql.types import (StructType, StructField, StringType, IntegerType,
                               DoubleType, BooleanType, DateType, TimestampType)

# CDC datasets (Socrata SODA). The summary dataset i8t6-whzd is DROPPED (its
# provision fields come back empty); the non-summary wan8-w4er is used for
# smokefree indoor air instead. Tax + flavor_ban + registry are the pricing
# drivers; youth/licensure/preemption/smokefree are context.
CDC_DATASETS = [
    ("kwbr-syv2", "tax",           "E-Cigarette Excise Tax"),
    ("8zea-kwnt", "youth_access",  "E-Cigarette Youth Access"),
    ("ne52-uraz", "licensure",     "E-Cigarette Licensure"),
    ("piju-vf3p", "preemption",    "E-Cigarette Preemption"),
    ("wan8-w4er", "smokefree_air", "E-Cigarette Smokefree Indoor Air"),
]
# All CDC vapor legislation defaults to the VEEV product line (single lookup so
# the mapping is trivial to change).
CATEGORY_PROGRAM = {"tax":"VEEV","youth_access":"VEEV","licensure":"VEEV",
                    "smokefree_air":"VEEV","preemption":"VEEV",
                    "flavor_ban":"VEEV","pmta_registry":"VEEV"}
CATEGORY_LABELS = {"tax":"Excise tax","youth_access":"Youth access",
    "licensure":"Licensure","smokefree_air":"Smokefree air","preemption":"Preemption",
    "flavor_ban":"Flavor ban","pmta_registry":"PMTA registry"}
CDC_USER_AGENT = "fabric-demos/pmi-state-regulatory-monitor (+https://github.com/marcelfranke/fabric-demos)"

# USPS 2-letter -> full state name (50 states + DC). CDC territories + the US
# national row are dropped.
US_STATE_NAMES = {
 "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
 "CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia",
 "FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois",
 "IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
 "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota",
 "MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada",
 "NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York",
 "NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon",
 "PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
 "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia",
 "WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
}

# Curated seed layer (mirrors the app's constants.ts).
HERO_PROGRAMS = {"ZYN","VEEV"}
PROGRAM_SEEDS = [
    ("IQOS","IQOS","Heated tobacco system (heat-not-burn)."),
    ("ZYN","ZYN","Oral nicotine pouches."),
    ("VEEV","VEEV","Vapor / e-cigarette product line."),
]
# Statewide flavor-ban states (source-upgraded 2026-07-16). Same table shape and
# ZYN+VEEV seed loop as before — only the state list + provenance changed.
#
# HOW THIS LIST WAS DERIVED (provenance):
#  * Primary source: Public Health Law Center "U.S. Sales Restrictions on Flavored
#    Tobacco Products" interactive map — STATE POLICY rows only (= statewide, as
#    opposed to city/county local-only). Retrieved 2026-07-16; PHLC current-as-of
#    2026-05-01. Reproducible snapshot committed at
#    fabric/reference/phlc_flavor_restrictions_2026-05-01.json (+ .md).
#    PHLC statewide set = {CA, DC, MA, MD, ME, NY, RI, UT}.
#  * Cross-validated against JAMA Network Open 2025 (Cheng et al., article
#    2836918), which independently confirms statewide e-cig flavor bans in
#    MA, MD, NJ, NY, RI, UT.
#  * NJ = curated override -> NOT PHLC's /nj page (that page lists only Jersey
#    City + Paterson, i.e. local-only, and would misrepresent NJ). NJ enacted a
#    real STATEWIDE e-cigarette flavor ban in 2020 (P.L.2019 c.462). PHLC's
#    tobacco-broad lens classifies NJ as local-only, so PHLC is not authoritative
#    for NJ's vape ban; JAMA confirms it. -> use NJ's statute page.
#  * CA, DC = PHLC statewide; JAMA notes the bans are real but excluded them from
#    its analysis for insufficient post-policy survey data (CA effective Dec 2022).
#  * ME = PHLC-only (statewide State Policy row present); JAMA did not measure ME.
#  * LIMITATION (flagged): "statewide" here means a PHLC State Policy row exists;
#    product/menthol scope (menthol-only vs all-flavor vs e-cig-only) is NOT
#    modeled in this version. That column-extension is deferred.
FLAVOR_BAN_STATES = {
 "CA":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/ca",
 "DC":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/dc",
 "MA":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/ma",
 "MD":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/md",
 "ME":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/me",
 "NJ":"https://www.njleg.state.nj.us/bill-search/2018/A5922",  # NJ P.L.2019 c.462 (statewide e-cig flavor ban)
 "NY":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/ny",
 "RI":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/ri",
 "UT":"https://www.publichealthlawcenter.org/us-sales-restrictions-flavored-tobacco-products-map/ut",
}
PMTA_REGISTRY_ENACTED = ["AL","FL","KY","LA","NC","OK","VA","WI","MS"]
PMTA_REGISTRY_PENDING = ["IA","UT"]  # court-challenged
PMTA_REGISTRY_URL = "https://www.fda.gov/tobacco-products/products-guidance-regulations/tobacco-product-marketing-orders"
# Curated illustrative excise sample — SEEDED MODE ONLY. In the live (CDC) flow
# the tax dimension comes from kwbr-syv2, so this sample is written as a table
# for reference but is NOT fed into the Gold signal computation (matching the
# app's cdc flow: seedCuratedFacts includeTaxSample=false).
CURATED_TAX_SAMPLE = [("CO","62%"),("MN","95%"),("VT","92%"),("PA","40%"),
    ("NV","30%"),("WA","$0.27/ml"),("CT","$0.40/ml"),("DE","$0.05/ml"),
    ("KS","$0.05/ml"),("LA","$0.15/ml")]
# Federal FDA authorizations -> Program milestones (state = 'US', excluded from
# state pricing signals).
FDA_MILESTONES = [
 ("IQOS","enacted","FDA MRTP exposure-modification order — IQOS 2.4","Modified-risk (reduced exposure) order","2020-07-07","https://www.fda.gov/news-events/press-announcements/fda-authorizes-marketing-iqos-tobacco-heating-system-reduced-exposure-information"),
 ("IQOS","enacted","FDA marketing order — IQOS 3 heated tobacco system","PMTA marketing authorization","2022-01-01","https://www.fda.gov/tobacco-products/products-guidance-regulations/tobacco-product-marketing-orders"),
 ("ZYN","enacted","FDA PMTA marketing order — ZYN nicotine pouches (10 flavors)","PMTA marketing authorization","2025-01-16","https://www.fda.gov/news-events/press-announcements/fda-authorizes-marketing-20-zyn-nicotine-pouch-products"),
 ("ZYN","pending","ZYN modified-risk (MRTP) application — 20 SKUs under review","MRTP application pending",None,"https://www.fda.gov/tobacco-products/advertising-and-promotion/modified-risk-tobacco-products"),
]
print("datasets:", [d[0] for d in CDC_DATASETS], "| row cap:", CDC_ROW_LIMIT, "| mode:", WRITE_MODE)


# CELL ********************

# === Helper functions (module scope): fetch, normalize, tax parse, pricing ===
def http_get_json(url, retries=4, timeout=90):
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": CDC_USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return json.loads(r.read().decode("utf-8", "replace"))
                last = f"HTTP {r.status}"
        except Exception as e:
            last = str(e)
        time.sleep(2 ** a)
    raise RuntimeError(f"GET failed {url}: {last}")

def is_empty(v):
    if v is None: return True
    t = str(v).strip().lower()
    return t in ("", "no provision", "none", "n/a")

def parse_us_date(s):
    if not s: return None
    s = str(s).strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    try:
        if m: return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        return datetime.fromisoformat(s[:10]).date()
    except Exception:
        return None

def extract_latlng(geo):
    if not geo or not isinstance(geo, dict): return (None, None)
    if "coordinates" in geo and isinstance(geo["coordinates"], list) and len(geo["coordinates"]) >= 2:
        lng, lat = geo["coordinates"][0], geo["coordinates"][1]
        return (str(lat) if lat is not None else None, str(lng) if lng is not None else None)
    if "latitude" in geo:
        return (geo.get("latitude"), geo.get("longitude"))
    return (None, None)

def mk(dataset_id, category, state, prov_key, status, title, provision_value, source_url,
       product_code, year=2020, quarter=0):
    return dict(dataset_id=dataset_id, category=category, state=state, prov_key=prov_key,
        year=year, quarter=quarter, title=title, status=status, provision_value=provision_value,
        citation=None, enacted_date=None, effective_date=None, source_url=source_url,
        latitude=None, longitude=None, product_code=product_code, state_name=US_STATE_NAMES[state])

def round1(n):
    return round(n * 10) / 10

def parse_tax_burden(value):
    if not value: return None
    v = str(value).strip()
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", v)                       # "62%"
    if m: return round1(float(m.group(1)))
    m = re.search(r"\$?\s*(\d+(?:\.\d+)?)\s*(?:/|per)\s*m?l\b", v, re.I)  # "$0.40/ml"
    if m: return round1(float(m.group(1)) * ASSUMED_ML_PER_PACK / ASSUMED_RETAIL_PRICE_USD * 100)
    m = re.match(r"^(\d+(?:\.\d+)?)$", v)                            # bare number -> percent
    if m: return round1(float(m.group(1)))
    return None

def derive_action(flavor_banned, registry_gated, has_pending, tax_burden):
    if flavor_banned: return "delist_banned"            # precedence: most -> least restrictive
    if registry_gated: return "restricted_assortment"
    if has_pending: return "watch_pending"
    if tax_burden is not None and tax_burden > HIGH_TAX_THRESHOLD: return "adjust_for_tax"
    return "price_freely"

def recommend(action, product, state_name, tax_burden):
    if action == "delist_banned": return f"Delist: {product} flavored SKUs banned in {state_name}"
    if action == "restricted_assortment": return f"Restricted assortment: sell only FDA-listed SKUs ({state_name} registry law)"
    if action == "watch_pending": return f"Watch: pending bill in {state_name} — hold price"
    if action == "adjust_for_tax": return f"Adjust for tax: {tax_burden}% excise — raise price to protect margin"
    return f"Price freely: no blocking rules in {state_name}"

ITEM_SCHEMA = StructType([
    StructField("dataset_id", StringType()), StructField("category", StringType()),
    StructField("state", StringType()), StructField("prov_key", StringType()),
    StructField("year", IntegerType()), StructField("quarter", IntegerType()),
    StructField("title", StringType()), StructField("status", StringType()),
    StructField("provision_value", StringType()), StructField("citation", StringType()),
    StructField("enacted_date", DateType()), StructField("effective_date", DateType()),
    StructField("source_url", StringType()), StructField("latitude", StringType()),
    StructField("longitude", StringType()), StructField("product_code", StringType()),
    StructField("state_name", StringType()),
])
ITEM_FIELDS = [f.name for f in ITEM_SCHEMA.fields]
SIG_SCHEMA = StructType([
    StructField("state", StringType()), StructField("state_name", StringType()),
    StructField("product_code", StringType()), StructField("sellable", BooleanType()),
    StructField("tax_burden", DoubleType()), StructField("pricing_action", StringType()),
    StructField("recommendation", StringType()), StructField("flavor_banned", BooleanType()),
    StructField("registry_gated", BooleanType()), StructField("has_pending", BooleanType()),
    StructField("reporting_year", IntegerType()), StructField("reporting_quarter", IntegerType()),
    StructField("effective_date", DateType()),
])
BRONZE_SCHEMA = StructType([StructField("dataset_id", StringType()),
    StructField("category", StringType()), StructField("raw_json", StringType())])
print("helpers ready")


# CELL ********************

# === run_pipeline(): Bronze -> Silver -> Gold, returns a reconciliation summary ==
def run_pipeline():
    # ---- BRONZE: pull each CDC dataset (Socrata SODA JSON, no key) into raw Delta
    bronze_raw = {}
    for ds_id, category, label in CDC_DATASETS:
        url = f"https://data.cdc.gov/resource/{ds_id}.json?$limit={CDC_ROW_LIMIT}&$order=year%20DESC"
        rows = http_get_json(url)
        bronze_raw[ds_id] = rows
        tbl = "bronze_cdc_" + ds_id.replace("-", "_")
        df = spark.createDataFrame([(ds_id, category, json.dumps(x)) for x in rows], BRONZE_SCHEMA)
        df.write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable(tbl)
        print(f"{tbl:28s} {len(rows):>6,} rows")

    # ---- SILVER: normalize CDC rows (faithful port of cdc-state-sync.service.ts)
    norm = []
    for ds_id, category, label in CDC_DATASETS:
        for raw in bronze_raw[ds_id]:
            state = (raw.get("locationabbr") or "").strip().upper()
            if not state or state not in US_STATE_NAMES:  # drop territories + US national
                continue
            try:
                year = int(raw.get("year"))
            except Exception:
                continue
            try:
                quarter = int(raw.get("quarter"))
            except Exception:
                quarter = 0
            prov_key = raw.get("provisionid") or raw.get("measureid") or raw.get("topicdesc") or ds_id
            raw_val = (raw.get("provisionvalue") or "").strip()
            empty = is_empty(raw_val)
            pv = None if empty else raw_val
            if (not empty) and category == "tax" and re.match(r"^\d+(\.\d+)?$", raw_val or ""):
                pv = raw_val + "%"
            lat, lng = extract_latlng(raw.get("geolocation"))
            loc = (raw.get("locationdesc") or US_STATE_NAMES[state]).strip()
            norm.append(dict(
                dataset_id=ds_id, category=category, state=state, prov_key=str(prov_key),
                year=year, quarter=quarter,
                title=f"{loc} · {CATEGORY_LABELS[category]}",
                status=("no_provision" if empty else "enacted"),
                provision_value=pv, citation=(raw.get("citation") or None),
                enacted_date=parse_us_date(raw.get("enacted_date")),
                effective_date=parse_us_date(raw.get("effective_date")),
                source_url=None, latitude=lat, longitude=lng,
                product_code=CATEGORY_PROGRAM[category], state_name=US_STATE_NAMES[state]))
    best = {}
    for r in norm:
        k = (r["dataset_id"], r["state"], r["prov_key"]); yq = r["year"] * 10 + r["quarter"]
        if k not in best or yq > best[k][0]:
            best[k] = (yq, r)
    cdc_rows = [v[1] for v in best.values()]
    print("CDC rows normalized (deduped, 50 states + DC):", len(cdc_rows))

    # ---- SILVER: curated seed layer, then write silver_regulatory_item
    seed_rows = []
    for st, url in FLAVOR_BAN_STATES.items():
        for prog in ("ZYN", "VEEV"):  # pouches often included -> ZYN + VEEV
            seed_rows.append(mk("seed", "flavor_ban", st, "flavor-ban", "enacted",
                f"Statewide flavor ban — {US_STATE_NAMES[st]}", "Flavored sales prohibited", url, prog))
    for st in PMTA_REGISTRY_ENACTED:
        seed_rows.append(mk("seed", "pmta_registry", st, "pmta-registry", "enacted",
            "PMTA registry / directory law — enacted", "FDA order or pending PMTA required",
            PMTA_REGISTRY_URL, "VEEV"))
    for st in PMTA_REGISTRY_PENDING:
        seed_rows.append(mk("seed", "pmta_registry", st, "pmta-registry", "pending",
            "PMTA registry / directory law — court-challenged (pending)",
            "FDA order or pending PMTA required", PMTA_REGISTRY_URL, "VEEV"))
    items = cdc_rows + seed_rows  # the Silver "evidence" grain that feeds Gold
    print(f"silver_regulatory_item rows: {len(items)} (CDC {len(cdc_rows)} + seed {len(seed_rows)})")

    si = spark.createDataFrame([tuple(r[f] for f in ITEM_FIELDS) for r in items], ITEM_SCHEMA)
    si = si.withColumn("id", F.xxhash64(F.concat_ws("|", "dataset_id", "state", "prov_key",
            F.col("year").cast("string"), F.col("quarter").cast("string"), "product_code", "category")))
    si.write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_regulatory_item")

    spark.createDataFrame([(c, n, d) for c, n, d in PROGRAM_SEEDS],
            StructType([StructField("product_code", StringType()), StructField("name", StringType()), StructField("description", StringType())])) \
        .withColumn("id", F.xxhash64(F.col("product_code"))) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_program")
    spark.createDataFrame([(s, US_STATE_NAMES[s], u) for s, u in FLAVOR_BAN_STATES.items()],
            StructType([StructField("state", StringType()), StructField("state_name", StringType()), StructField("source_url", StringType())])) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_flavor_ban")
    spark.createDataFrame(
            [(s, "enacted") for s in PMTA_REGISTRY_ENACTED] + [(s, "pending") for s in PMTA_REGISTRY_PENDING],
            StructType([StructField("state", StringType()), StructField("status", StringType())])) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_pmta_registry")
    spark.createDataFrame([(s, v, "VEEV") for s, v in CURATED_TAX_SAMPLE],
            StructType([StructField("state", StringType()), StructField("provision_value", StringType()), StructField("product_code", StringType())])) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_tax_sample")
    spark.createDataFrame([(p, st, t, pv, (parse_us_date(ed) if ed else None), u)
            for p, st, t, pv, ed, u in FDA_MILESTONES],
            StructType([StructField("program", StringType()), StructField("status", StringType()),
                        StructField("title", StringType()), StructField("provision_value", StringType()),
                        StructField("enacted_date", DateType()), StructField("source_url", StringType())])) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("silver_fda_milestones")
    print("Silver tables written.")

    # ---- GOLD: compute Pricing Signals (faithful port of pricing.service.ts)
    groups = {}
    for it in items:
        if it["state"] == "US": continue
        p = it["product_code"]
        if p not in ("IQOS", "ZYN", "VEEV"): continue
        groups.setdefault((it["state"], p), []).append(it)

    signals = []
    for (state, product), g in groups.items():
        state_name = US_STATE_NAMES.get(state, state)
        flavor_banned = (product in HERO_PROGRAMS) and any(
            i["category"] == "flavor_ban" and i["status"] == "enacted" for i in g)  # IQOS exempt
        registry_gated = any(i["category"] == "pmta_registry" and i["status"] == "enacted" for i in g)
        has_pending = any(i["status"] == "pending" for i in g)
        tax_burden = None
        tax_prov = None
        for i in g:
            if i["category"] != "tax": continue
            t = parse_tax_burden(i.get("provision_value"))
            if t is not None:
                tax_burden = t; tax_prov = i; break
        # CDC-ONLY date connection: carry the reporting period + effective date from the
        # tax provision that supplied tax_burden — but ONLY when it is a real CDC row
        # (dataset_id != "seed"). Seed-driven flavor-ban / PMTA signals stay NULL by design,
        # so only CDC-sourced signals join the Date dimension in the semantic model.
        reporting_year = None; reporting_quarter = None; eff_date = None
        if tax_prov is not None and tax_prov.get("dataset_id") != "seed":
            ry = tax_prov.get("year"); rq = tax_prov.get("quarter")
            reporting_year = int(ry) if ry is not None else None
            reporting_quarter = int(rq) if (rq is not None and rq != 0) else None
            eff_date = tax_prov.get("effective_date")  # a datetime.date or None
        action = derive_action(flavor_banned, registry_gated, has_pending, tax_burden)
        sellable = not (flavor_banned or registry_gated)
        signals.append(dict(state=state, state_name=state_name, product_code=product,
            sellable=sellable, tax_burden=(float(tax_burden) if tax_burden is not None else None),
            pricing_action=action, recommendation=recommend(action, product, state_name, tax_burden),
            flavor_banned=flavor_banned, registry_gated=registry_gated, has_pending=has_pending,
            reporting_year=reporting_year, reporting_quarter=reporting_quarter, effective_date=eff_date))
    signals.sort(key=lambda s: (s["product_code"], s["state"]))
    print("pricing signals computed:", len(signals))

    gold = (spark.createDataFrame([tuple(s[f.name] for f in SIG_SCHEMA.fields) for s in signals], SIG_SCHEMA)
        .withColumn("id", F.xxhash64(F.concat_ws("|", "state", "product_code")))
        .withColumn("updated_at", F.current_timestamp()))
    gold.write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_pricing_signal")

    (gold.groupBy("pricing_action").agg(F.count("*").alias("signal_count")).orderBy("pricing_action")
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_signals_by_action"))
    (gold.groupBy("product_code").agg(F.count("*").alias("signal_count"))
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_signals_by_program"))
    (gold.filter("tax_burden is not null").select("state", "state_name", "product_code", "tax_burden").orderBy(F.desc("tax_burden"))
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_state_tax_burden"))

    geo = {}
    for r in cdc_rows:
        if r["state"] not in geo and r["latitude"] and r["longitude"]:
            geo[r["state"]] = (r["latitude"], r["longitude"])
    dim_state = spark.createDataFrame([
        (s, n, (float(geo[s][0]) if s in geo else None), (float(geo[s][1]) if s in geo else None))
        for s, n in US_STATE_NAMES.items()],
        StructType([StructField("state", StringType()), StructField("state_name", StringType()),
                    StructField("latitude", DoubleType()), StructField("longitude", DoubleType())]))
    dim_state.withColumn("id", F.xxhash64(F.col("state"))) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_dim_state")
    spark.createDataFrame([(c, n, d) for c, n, d in PROGRAM_SEEDS],
            StructType([StructField("product_code", StringType()), StructField("name", StringType()), StructField("description", StringType())])) \
        .withColumn("id", F.xxhash64(F.col("product_code"))) \
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_dim_program")

    # ---- GOLD: calendar date dimension over the REAL dates present in the CDC data
    # (effective/enacted dates + reporting-period quarter starts; quarter 0/annual -> Jan 1).
    # Daily grain. Only CDC-sourced signals carry an Effective Date, so only they join it.
    _QMONTH = {1: 1, 2: 4, 3: 7, 4: 10}
    real_dates = set()
    for r in cdc_rows:
        for dk in ("effective_date", "enacted_date"):
            d = r.get(dk)
            if d is not None:
                real_dates.add(d)
        y = r.get("year")
        if y:
            q = r.get("quarter") or 0
            real_dates.add(date(int(y), _QMONTH.get(q, 1), 1))
    real_dates = {d for d in real_dates if 2000 <= d.year <= 2035}  # guard vs pathological outliers
    dmin, dmax = min(real_dates), max(real_dates)
    cal, n = [], 0
    while True:
        d = dmin + timedelta(days=n)
        if d > dmax: break
        q = (d.month - 1) // 3 + 1
        cal.append((d, d.year, q, f"{d.year}-Q{q}", d.month, d.strftime("%B"),
                    date(d.year, (q - 1) * 3 + 1, 1)))
        n += 1
    DATE_SCHEMA = StructType([
        StructField("date", DateType()), StructField("year", IntegerType()),
        StructField("quarter", IntegerType()), StructField("quarter_label", StringType()),
        StructField("month", IntegerType()), StructField("month_name", StringType()),
        StructField("month_start", DateType())])
    (spark.createDataFrame(cal, DATE_SCHEMA)
        .withColumn("id", F.xxhash64(F.col("date").cast("string")))
        .write.format("delta").mode(WRITE_MODE).option("overwriteSchema", "true").saveAsTable("gold_dim_date"))
    print(f"gold_dim_date rows: {len(cal)} ({dmin} -> {dmax})")
    print("Gold tables written.")

    # ---- VALIDATION GATE: row counts + reconciliation with the app's live numbers
    tables = ["bronze_cdc_kwbr_syv2","bronze_cdc_8zea_kwnt","bronze_cdc_ne52_uraz",
        "bronze_cdc_piju_vf3p","bronze_cdc_wan8_w4er","silver_regulatory_item","silver_program",
        "silver_flavor_ban","silver_pmta_registry","silver_tax_sample","silver_fda_milestones",
        "gold_pricing_signal","gold_signals_by_action","gold_signals_by_program",
        "gold_state_tax_burden","gold_dim_state","gold_dim_program","gold_dim_date"]
    counts = {}
    for t in tables:
        counts[t] = spark.table(t).count()
    sig = spark.table("gold_pricing_signal")
    dd = spark.table("gold_dim_date")
    dist = {r["pricing_action"]: r["count"] for r in sig.groupBy("pricing_action").count().collect()}
    per_prog = {r["product_code"]: r["count"] for r in sig.groupBy("product_code").count().collect()}
    taxed = sig.filter("tax_burden is not null")
    integrity = {}
    for t in ["silver_regulatory_item", "gold_pricing_signal", "gold_dim_state", "gold_dim_program"]:
        d = spark.table(t)
        integrity[t] = {"count_eq_distinct": bool(d.count() == d.select("id").distinct().count()),
                        "null_ids": d.filter(F.col("id").isNull()).count()}
    summary = {
        "table_counts": counts,
        "distinct_states": sig.select("state").distinct().count(),
        "total_signals": sig.count(),
        "action_distribution": dist,
        "per_program": per_prog,
        "taxed_states": taxed.select("state").distinct().count(),
        "avg_tax_burden": taxed.agg(F.round(F.avg("tax_burden"), 1)).first()[0],
        "key_integrity": integrity,
        "date_dim": {
            "rows": dd.count(),
            "min": dd.agg(F.min("date")).first()[0],
            "max": dd.agg(F.max("date")).first()[0],
            "distinct_years": dd.select("year").distinct().count(),
        },
        "signals_with_reporting_year": sig.filter(F.col("reporting_year").isNotNull()).count(),
        "signals_with_effective_date": sig.filter(F.col("effective_date").isNotNull()).count(),
        "reporting_year_by_action": {r["pricing_action"]: r["c"] for r in
            sig.filter(F.col("reporting_year").isNotNull())
               .groupBy("pricing_action").agg(F.count("*").alias("c")).collect()},
        "effective_date_by_action": {r["pricing_action"]: r["c"] for r in
            sig.filter(F.col("effective_date").isNotNull())
               .groupBy("pricing_action").agg(F.count("*").alias("c")).collect()},
        "seed_signals_null_date": sig.filter(
            F.col("reporting_year").isNull() & F.col("effective_date").isNull()).count(),
    }
    return summary
print("run_pipeline defined")


# CELL ********************

# === DRIVER: run the pipeline, persist a machine-readable summary / traceback ===
# Writes Files/_run/summary.json on success or Files/_run/error.txt on failure so
# the outcome can be read headlessly via the OneLake DFS API (the Jobs API does
# not surface cell output). Re-raises on error so the job status reflects reality.
def _put(path, content):
    try:
        notebookutils.fs.put(path, content, True)
    except Exception:
        mssparkutils.fs.put(path, content, True)

try:
    summary = run_pipeline()
    payload = json.dumps(summary, indent=2, default=str)
    print(payload)
    _put("Files/_run/summary.json", payload)
    print("PIPELINE_OK rows_gold_pricing_signal =", summary["total_signals"])
except Exception as e:
    tb = traceback.format_exc()
    print(tb)
    try:
        _put("Files/_run/error.txt", tb)
    except Exception as e2:
        print("could not persist error.txt:", e2)
    raise

