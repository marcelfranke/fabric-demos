// Builds the PMI synthetic SALES + DEMAND-FORECAST + REVENUE-SIMULATION notebook and
// UPSERT-deploys it to the "Dynamic Pricing" Fabric workspace via the Fabric REST API.
//
// This is an ADDITIVE backend extension of the PMI State Regulatory Monitor demo. It
// creates a SEPARATE notebook (02_pmi_sales_forecast) that reads the existing gold
// tables (gold_pricing_signal, gold_dim_date) and produces synthetic-but-realistic
// sales facts, a monthly aggregate, a demand forecast and program rollups. It does NOT
// modify the proven 02_pmi_pricing_medallion notebook or its export.
//
// Sales are SYNTHETIC — generated deterministically (hash-seeded Poisson demand), NOT
// real PMI point-of-sale data. The coupling to the regulatory signal (ban cliffs,
// revenue-at-risk, tax price uplift) is the whole point of the demo.
//
// Auth is performed at runtime via the Azure CLI (az account get-access-token) — NO
// credentials are stored in this repo. Workspace / lakehouse ids are Azure resource
// identifiers, not secrets.
//
//   node fabric/notebooks/build_sales_notebook.mjs          # deploy + write export
//   SKIP_DEPLOY=1 node fabric/notebooks/build_sales_notebook.mjs   # export only
//
// Requires Node 18+ (global fetch) and an authenticated `az login` against the target
// tenant. It also (re)writes the Git-synced export at
//   workspace-sync/02_pmi_sales_forecast.Notebook/notebook-content.py
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05"; // "Dynamic Pricing"
const LH_ID = process.env.FABRIC_LAKEHOUSE_ID || "e3c9f128-9200-4963-890d-26c5f76bf81a";
const LH_NAME = "pmi_lakehouse";
const NB_NAME = "02_pmi_sales_forecast";
const NB_DESC = "PMI synthetic sales + demand forecast + revenue-at-risk, coupled to the regulatory pricing signal";

function token() {
  return execSync(
    `az account get-access-token --resource "https://api.fabric.microsoft.com" --tenant ${TENANT} --query accessToken -o tsv`,
    { encoding: "utf8", shell: "powershell.exe" }
  ).trim();
}

// ── Notebook cells: [sourceString, isParametersCell] ──────────────────────
const cells = [];

// ── CELL 0: parameters ────────────────────────────────────────────────────
cells.push([`# PMI synthetic sales + demand-forecast — parameters
# NOTE: sales are SYNTHETIC (deterministic, hash-seeded). No real PMI point-of-sale
# data is used. Volumes/prices are coupled to the regulatory pricing signal so the
# demo shows ban cliffs, revenue-at-risk and tax-driven pricing on real effective dates.
START_DATE = "2018-01-01"      # sales window start (spans all flavor-ban effective dates)
END_DATE = "2026-06-30"        # sales window end (mid-year, so forecast horizon is visible)
FORECAST_HORIZON = 12          # months to forecast beyond the last actual month
LAMBDA_BASE = 17.0             # base monthly demand intensity (primary row-count tuning knob)
TAPER_DAYS = 45                # ban-cliff taper length in days, ending at the effective_date
TAX_PASSTHROUGH = 0.5          # fraction of a state's tax burden passed into unit price
TREND_ANNUAL = 0.06            # mild yearly demand uptrend
WRITE_MODE = "overwrite"       # 'overwrite' rebuilds tables; per-year facts use replaceWhere
YEARS = ""                     # optional CSV of years to (re)build (e.g. "2018,2019"); "" = full window
FORCE_REPROCESS = False        # rebuild listed years even if ctl_sales_years marks them done
`, true]);

// ── CELL 1: constants (cities, shops, SKUs, channel stocking) ──────────────
cells.push([`# ── Static reference data (deterministic; no external calls) ──────────────
# Postal-code keyed cities with a relative population weight (1..10). Weights drive
# both how many shops a city gets and its baseline demand multiplier.
STATE_CITIES = {
    "AL": [("Birmingham", 5), ("Montgomery", 3)],
    "AK": [("Anchorage", 3), ("Fairbanks", 1)],
    "AZ": [("Phoenix", 8), ("Tucson", 5), ("Mesa", 4)],
    "AR": [("Little Rock", 4), ("Fayetteville", 2)],
    "CA": [("Los Angeles", 10), ("San Francisco", 8), ("San Diego", 7)],
    "CO": [("Denver", 7), ("Colorado Springs", 4)],
    "CT": [("Hartford", 4), ("New Haven", 4)],
    "DE": [("Wilmington", 3), ("Dover", 1)],
    "DC": [("Washington", 6), ("Georgetown", 2)],
    "FL": [("Miami", 9), ("Orlando", 6), ("Tampa", 6)],
    "GA": [("Atlanta", 8), ("Savannah", 3)],
    "HI": [("Honolulu", 3), ("Hilo", 1)],
    "ID": [("Boise", 4), ("Nampa", 2)],
    "IL": [("Chicago", 9), ("Springfield", 3), ("Naperville", 4)],
    "IN": [("Indianapolis", 6), ("Fort Wayne", 3)],
    "IA": [("Des Moines", 4), ("Cedar Rapids", 2)],
    "KS": [("Wichita", 4), ("Overland Park", 3)],
    "KY": [("Louisville", 5), ("Lexington", 3)],
    "LA": [("New Orleans", 5), ("Baton Rouge", 4)],
    "ME": [("Portland", 3), ("Bangor", 1)],
    "MD": [("Baltimore", 6), ("Rockville", 4)],
    "MA": [("Boston", 8), ("Worcester", 4), ("Cambridge", 4)],
    "MI": [("Detroit", 7), ("Grand Rapids", 4)],
    "MN": [("Minneapolis", 6), ("Saint Paul", 5)],
    "MS": [("Jackson", 3), ("Gulfport", 2)],
    "MO": [("Kansas City", 6), ("Saint Louis", 6)],
    "MT": [("Billings", 2), ("Missoula", 1)],
    "NE": [("Omaha", 4), ("Lincoln", 3)],
    "NV": [("Las Vegas", 6), ("Reno", 3)],
    "NH": [("Manchester", 3), ("Nashua", 2)],
    "NJ": [("Newark", 6), ("Jersey City", 5)],
    "NM": [("Albuquerque", 4), ("Santa Fe", 2)],
    "NY": [("New York", 10), ("Buffalo", 5), ("Rochester", 4)],
    "NC": [("Charlotte", 7), ("Raleigh", 6)],
    "ND": [("Fargo", 2), ("Bismarck", 1)],
    "OH": [("Columbus", 7), ("Cleveland", 6), ("Cincinnati", 5)],
    "OK": [("Oklahoma City", 5), ("Tulsa", 4)],
    "OR": [("Portland", 6), ("Eugene", 3)],
    "PA": [("Philadelphia", 8), ("Pittsburgh", 6)],
    "RI": [("Providence", 4), ("Warwick", 2)],
    "SC": [("Columbia", 4), ("Charleston", 4)],
    "SD": [("Sioux Falls", 2), ("Rapid City", 1)],
    "TN": [("Nashville", 6), ("Memphis", 6)],
    "TX": [("Houston", 10), ("Dallas", 9), ("Austin", 8)],
    "UT": [("Salt Lake City", 5), ("Provo", 3)],
    "VT": [("Burlington", 2), ("Montpelier", 1)],
    "VA": [("Virginia Beach", 6), ("Richmond", 5)],
    "WA": [("Seattle", 8), ("Spokane", 4)],
    "WV": [("Charleston", 2), ("Huntington", 2)],
    "WI": [("Milwaukee", 6), ("Madison", 4)],
    "WY": [("Cheyenne", 2), ("Casper", 1)],
}

# SKUs — ONLY the two heroes already modelled (ZYN pouches + VEEV pods). No IQOS sales.
# (sku_code, program, flavor, pack, base_price)
SKUS = [
    ("ZYN-CM", "ZYN", "Cool Mint",       "6mg Can",  5.99),
    ("ZYN-CT", "ZYN", "Citrus",          "6mg Can",  5.99),
    ("ZYN-CF", "ZYN", "Coffee",          "3mg Can",  5.49),
    ("ZYN-WG", "ZYN", "Wintergreen",     "6mg Can",  5.99),
    ("VEEV-CL", "VEEV", "Classic Tobacco", "Pod 2pk", 11.99),
    ("VEEV-FM", "VEEV", "Fresh Mint",      "Pod 2pk", 11.99),
    ("VEEV-BB", "VEEV", "Berry Blend",     "Pod 2pk", 12.49),
    ("VEEV-YE", "VEEV", "Yellow Edition",  "Pod 2pk", 12.49),
]

# Which SKUs each retail channel stocks (fewer SKUs in grocery, full range in tobacco).
CHANNELS = ["convenience", "tobacco", "grocery"]
CHANNEL_STOCK = {
    "convenience": ["ZYN-CM", "ZYN-CT", "VEEV-CL", "VEEV-FM", "VEEV-BB", "VEEV-YE"],
    "tobacco":     ["ZYN-CM", "ZYN-CT", "ZYN-CF", "ZYN-WG", "VEEV-CL", "VEEV-FM", "VEEV-BB", "VEEV-YE"],
    "grocery":     ["ZYN-CM", "VEEV-CL", "VEEV-FM"],
}
# Channel effects on demand intensity and shelf price.
CHANNEL_LAMBDA = {"convenience": 1.0, "tobacco": 1.3, "grocery": 0.7}
CHANNEL_PRICE  = {"convenience": 1.05, "tobacco": 1.00, "grocery": 0.98}
PROGRAM_LAMBDA = {"ZYN": 1.15, "VEEV": 1.0}   # ZYN pouches slightly higher velocity
`, false]);

// ── CELL 2: imports, helpers, and ALL pipeline function definitions ────────
cells.push([`# ── Imports + deterministic demand kernel + pipeline definitions ──────────
import json, math, traceback, datetime as dt
import numpy as np
import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.types import (StructType, StructField, StringType, LongType,
                               IntegerType, DoubleType, DateType, BooleanType)
from pyspark.sql.functions import pandas_udf

np.random.seed(42)  # belt-and-braces determinism (no random draws are actually used)
spark.conf.set("spark.sql.shuffle.partitions", "64")

WINDOW_START = dt.date.fromisoformat(START_DATE)
WINDOW_END = dt.date.fromisoformat(END_DATE)
ALL_YEARS = list(range(WINDOW_START.year, WINDOW_END.year + 1))

def run_years():
    if YEARS.strip():
        return [int(y) for y in YEARS.split(",") if y.strip()]
    return ALL_YEARS

def _put(path, content):
    # Durable write to the lakehouse Files/ area (notebookutils with mssparkutils fallback).
    try:
        notebookutils.fs.put(path, content, True)
    except Exception:
        mssparkutils.fs.put(path, content, True)

# Vectorised inverse-CDF Poisson sampler: k = smallest k with F(k) >= u. Deterministic
# in u (no RNG), so the same (shop, sku, date) hash always yields the same demand.
def poisson_ppf(u, lam):
    u = np.asarray(u, dtype=np.float64)
    lam = np.clip(np.asarray(lam, dtype=np.float64), 0.0, None)
    n = u.shape[0]
    k = np.zeros(n, dtype=np.int64)
    p = np.exp(-lam)          # pmf(0)
    cdf = p.copy()            # F(0)
    not_done = u > cdf
    kk = 0
    while not_done.any() and kk < 400:
        kk += 1
        p = p * lam / kk      # pmf(kk)
        cdf = cdf + p         # F(kk)
        k = k + not_done.astype(np.int64)
        not_done = u > cdf
    return k

_SAMPLE_SCHEMA = StructType([
    StructField("baseline", LongType(), True),
    StructField("actual", LongType(), True),
])

@pandas_udf(_SAMPLE_SCHEMA)
def sample_demand(u: pd.Series, lam_base: pd.Series, lam_eff: pd.Series) -> pd.DataFrame:
    uu = u.to_numpy(dtype=np.float64)
    baseline = poisson_ppf(uu, lam_base.to_numpy(dtype=np.float64))
    actual = poisson_ppf(uu, lam_eff.to_numpy(dtype=np.float64))
    return pd.DataFrame({"baseline": baseline, "actual": actual})

def seasonality(month):
    if month in (6, 7, 8):
        return 1.15      # summer lift
    if month == 12:
        return 1.10      # holiday lift
    if month == 1:
        return 0.92      # post-holiday dip
    return 1.0

# Deterministic uniform in (0,1) from a stable (shop,sku,date) hash. Prime modulus < 2^53
# keeps it exactly representable as a double.
U_EXPR = ("(pmod(xxhash64(concat_ws('|', cast(shop_id as string), cast(sku_id as string), "
          "cast(date as string))), 9007199254740881) + 0.5) / 9007199254740881.0")

# ── Dimensions + coupling + (shop x sku) universe ─────────────────────────
def build_dims_and_pairs():
    # Coupling source: the EXISTING gold_pricing_signal. product_code == program (ZYN/VEEV).
    # VEEV carries a signal in every state; ZYN only where a flavor ban was detected.
    sig = spark.table("gold_pricing_signal")
    eff_col = "effective_date" if "effective_date" in sig.columns else None
    signal_map = (sig
        .select(
            F.col("state").alias("state"),
            F.col("product_code").alias("program"),
            F.col("pricing_action").alias("pricing_action"),
            F.col("flavor_banned").cast("boolean").alias("flavor_banned"),
            F.col("tax_burden").cast("double").alias("tax_burden"),
            (F.col(eff_col).cast("date") if eff_col else F.lit(None).cast("date")).alias("effective_date"),
        )
        .dropDuplicates(["state", "program"]))

    # dim_city
    city_rows = [(st, city, float(w)) for st in sorted(STATE_CITIES) for (city, w) in STATE_CITIES[st]]
    dim_city = (spark.createDataFrame(city_rows, "state string, city string, population_weight double")
        .withColumn("id", F.xxhash64(F.concat_ws("|", F.col("state"), F.col("city"))))
        .select("id", "state", "city", "population_weight"))
    dim_city.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable("dim_city")

    # dim_shop (1..3 shops per city by weight; channel cycles deterministically)
    shop_rows = []
    gi = 0
    for st in sorted(STATE_CITIES):
        for (city, w) in STATE_CITIES[st]:
            n_shops = 1 + (1 if w >= 6 else 0) + (1 if w >= 9 else 0)
            for s in range(n_shops):
                channel = CHANNELS[gi % 3]
                gi += 1
                shop_code = f"{st}-{city.replace(' ', '')[:6].upper()}-{s+1}"
                shop_name = f"{city} {channel.capitalize()} #{s+1}"
                demand_factor = 0.6 + 0.8 * (w / 10.0)
                shop_rows.append((st, city, shop_code, shop_name, channel, float(demand_factor), float(w)))
    dim_shop = (spark.createDataFrame(
            shop_rows,
            "state string, city string, shop_code string, shop_name string, channel string, demand_factor double, population_weight double")
        .withColumn("id", F.xxhash64(F.col("shop_code")))
        .withColumn("city_id", F.xxhash64(F.concat_ws("|", F.col("state"), F.col("city"))))
        .select("id", "shop_code", "shop_name", "city", "state", "channel", "demand_factor", "population_weight", "city_id"))
    dim_shop.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable("dim_shop")

    # dim_sku
    sku_df = (spark.createDataFrame(
            SKUS, "sku_code string, program string, flavor string, pack string, base_price double")
        .withColumn("id", F.xxhash64(F.col("sku_code")))
        .select("id", "sku_code", "program", "flavor", "pack", "base_price"))
    sku_df.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable("dim_sku")

    # (shop x sku) stocked pairs, joined to the coupling signal
    stock_rows = [(ch, code) for ch, codes in CHANNEL_STOCK.items() for code in codes]
    stock_df = spark.createDataFrame(stock_rows, "channel string, sku_code string")
    pairs = (spark.table("dim_shop").alias("sh")
        .join(stock_df.alias("stk"), "channel")
        .join(spark.table("dim_sku").alias("sk"), F.col("stk.sku_code") == F.col("sk.sku_code"))
        .join(F.broadcast(signal_map).alias("sg"),
              (F.col("sh.state") == F.col("sg.state")) & (F.col("sk.program") == F.col("sg.program")), "left")
        .select(
            F.col("sh.id").alias("shop_id"), F.col("sh.shop_name"), F.col("sh.city"),
            F.col("sh.state"), F.col("channel"), F.col("sh.demand_factor"),
            F.col("sk.id").alias("sku_id"), F.col("sk.sku_code"), F.col("sk.program"),
            F.col("sk.flavor"), F.col("sk.pack"), F.col("sk.base_price"),
            F.col("sg.pricing_action"), F.coalesce(F.col("sg.flavor_banned"), F.lit(False)).alias("flavor_banned"),
            F.col("sg.tax_burden"), F.col("sg.effective_date")))
    pairs.cache()
    counts = {"cities": spark.table("dim_city").count(), "shops": spark.table("dim_shop").count(),
              "skus": spark.table("dim_sku").count(), "pairs": pairs.count()}
    print("dims:", counts)
    return pairs, counts

# ── Per-year sales generation (resumable via ctl_sales_years) ─────────────
def already_done(year):
    if FORCE_REPROCESS or not spark.catalog.tableExists("ctl_sales_years"):
        return False
    return spark.table("ctl_sales_years").where(
        (F.col("year") == year) & (F.col("status") == "done")).count() > 0

def upsert_ctl(year, status, fact_rows, monthly_rows):
    row = [(int(year), status, int(fact_rows), int(monthly_rows), dt.datetime.utcnow().isoformat())]
    df = spark.createDataFrame(row, "year int, status string, fact_rows long, monthly_rows long, loaded_at string")
    w = df.write.mode("overwrite").format("delta")
    if spark.catalog.tableExists("ctl_sales_years"):
        w = w.option("replaceWhere", f"year = {int(year)}")
    w.saveAsTable("ctl_sales_years")

def build_year(year, pairs):
    y_start = max(WINDOW_START, dt.date(year, 1, 1))
    y_end = min(WINDOW_END, dt.date(year, 12, 31))
    n_days = (y_end - y_start).days + 1
    day_rows = []
    for i in range(n_days):
        d = y_start + dt.timedelta(days=i)
        dim = (dt.date(d.year + (d.month // 12), (d.month % 12) + 1, 1) - dt.timedelta(days=1)).day
        month_idx = (d.year - WINDOW_START.year) * 12 + (d.month - 1)
        trend = 1.0 + TREND_ANNUAL * (month_idx / 12.0)
        day_rows.append((d, d.year, d.month, dim, float(seasonality(d.month)), float(trend)))
    days_df = spark.createDataFrame(
        day_rows, "date date, year int, month int, days_in_month int, seasonality double, trend double")

    grid = pairs.crossJoin(F.broadcast(days_df))
    lam_month = (F.lit(LAMBDA_BASE)
        * F.when(F.col("program") == "ZYN", F.lit(PROGRAM_LAMBDA["ZYN"])).otherwise(F.lit(PROGRAM_LAMBDA["VEEV"]))
        * F.when(F.col("channel") == "tobacco", F.lit(CHANNEL_LAMBDA["tobacco"]))
           .when(F.col("channel") == "grocery", F.lit(CHANNEL_LAMBDA["grocery"])).otherwise(F.lit(CHANNEL_LAMBDA["convenience"]))
        * F.col("demand_factor") * F.col("seasonality") * F.col("trend"))
    lam_daily = lam_month / F.col("days_in_month")

    # Ban factor: 1 normally; 0 for banned-without-date (whole window); linear taper to 0
    # ending at effective_date for banned-with-date (the visible revenue cliff).
    days_to_eff = F.datediff(F.col("effective_date"), F.col("date"))
    ban_factor = (F.when(~F.col("flavor_banned"), F.lit(1.0))
        .when(F.col("effective_date").isNull(), F.lit(0.0))
        .when(F.col("date") >= F.col("effective_date"), F.lit(0.0))
        .when(days_to_eff <= F.lit(TAPER_DAYS), (days_to_eff / F.lit(float(TAPER_DAYS))))
        .otherwise(F.lit(1.0)))

    price_factor = (F.when(F.col("channel") == "convenience", F.lit(CHANNEL_PRICE["convenience"]))
        .when(F.col("channel") == "grocery", F.lit(CHANNEL_PRICE["grocery"])).otherwise(F.lit(CHANNEL_PRICE["tobacco"])))
    tax_uplift = F.when((F.col("pricing_action") == "adjust_for_tax") & F.col("tax_burden").isNotNull(),
                        F.lit(1.0) + F.col("tax_burden") / F.lit(100.0) * F.lit(TAX_PASSTHROUGH)).otherwise(F.lit(1.0))
    unit_price = F.round(F.col("base_price") * price_factor * tax_uplift, 2)

    grid = (grid
        .withColumn("u", F.expr(U_EXPR))
        .withColumn("lam_daily", lam_daily)
        .withColumn("ban_factor", ban_factor)
        .withColumn("lam_eff", F.col("lam_daily") * F.col("ban_factor"))
        .withColumn("unit_price", unit_price))
    sampled = grid.withColumn("s", sample_demand(F.col("u"), F.col("lam_daily"), F.col("lam_eff")))
    sampled = (sampled
        .withColumn("baseline_units", F.col("s.baseline"))
        .withColumn("units", F.col("s.actual"))
        .withColumn("revenue", F.round(F.col("units") * F.col("unit_price"), 2))
        .withColumn("baseline_revenue", F.round(F.col("baseline_units") * F.col("unit_price"), 2))
        .withColumn("is_banned", F.col("flavor_banned"))
        .drop("s"))
    sampled.cache()

    # fact_sales_daily — sparse: only rows with actual units > 0 (post-ban reality).
    fact = (sampled.where(F.col("units") > 0)
        .withColumn("date_key", F.xxhash64(F.col("date").cast("string")))
        .withColumn("id", F.xxhash64(F.concat_ws("|", F.col("shop_id").cast("string"),
                                                  F.col("sku_id").cast("string"), F.col("date").cast("string"))))
        .select("id", "date", "year", "date_key", "state", "city", "shop_id", "shop_name", "channel",
                "sku_id", "sku_code", "program", "flavor", "pack", "units", "unit_price", "revenue", "pricing_action"))
    fw = fact.write.mode("overwrite").format("delta").partitionBy("year")
    fw = fw.option("replaceWhere", f"year = {int(year)}") if spark.catalog.tableExists("fact_sales_daily") \\
         else fw.option("overwriteSchema", "true")
    fw.saveAsTable("fact_sales_daily")
    fact_rows = fact.count()

    # gold_sales_monthly — dense month x shop x sku; retains baseline + revenue_at_risk
    # (rows the sparse fact drops because a ban forced actual units to zero).
    monthly = (sampled
        .withColumn("month_start", F.trunc(F.col("date"), "MM"))
        .groupBy("month_start", "state", "city", "shop_id", "shop_name", "channel",
                 "sku_id", "sku_code", "program", "flavor", "pack")
        .agg(F.sum("units").alias("units"),
             F.sum("baseline_units").alias("baseline_units"),
             F.round(F.sum("revenue"), 2).alias("revenue"),
             F.round(F.sum("baseline_revenue"), 2).alias("baseline_revenue"),
             F.round(F.avg("unit_price"), 2).alias("avg_price"),
             F.max("is_banned").alias("is_banned"),
             F.max("effective_date").alias("effective_date"))
        .where(F.col("baseline_units") > 0)
        .withColumn("revenue_at_risk", F.round(F.col("baseline_revenue") - F.col("revenue"), 2))
        .withColumn("year", F.year("month_start"))
        .withColumn("id", F.xxhash64(F.concat_ws("|", F.col("month_start").cast("string"),
                                                 F.col("shop_id").cast("string"), F.col("sku_id").cast("string"))))
        .select("id", "month_start", "year", "state", "city", "shop_id", "shop_name", "channel",
                "sku_id", "sku_code", "program", "flavor", "pack", "units", "baseline_units",
                "revenue", "baseline_revenue", "revenue_at_risk", "avg_price", "is_banned", "effective_date"))
    mw = monthly.write.mode("overwrite").format("delta").partitionBy("year")
    mw = mw.option("replaceWhere", f"year = {int(year)}") if spark.catalog.tableExists("gold_sales_monthly") \\
         else mw.option("overwriteSchema", "true")
    mw.saveAsTable("gold_sales_monthly")
    monthly_rows = monthly.count()

    sampled.unpersist()
    return fact_rows, monthly_rows

def run_sales(pairs, years):
    if WRITE_MODE == "overwrite" and set(years) == set(ALL_YEARS) and not FORCE_REPROCESS:
        for t in ["fact_sales_daily", "gold_sales_monthly", "ctl_sales_years"]:
            spark.sql(f"DROP TABLE IF EXISTS {t}")
    tot_fact = tot_monthly = 0
    for yr in years:
        if already_done(yr):
            print(f"year {yr}: already done — skip")
            continue
        fr, mr = build_year(yr, pairs)
        upsert_ctl(yr, "done", fr, mr)
        tot_fact += fr
        tot_monthly += mr
        print(f"year {yr}: fact_rows={fr:,} monthly_rows={mr:,}")
    print(f"TOTAL fact_sales_daily rows this run: {tot_fact:,}")
    return {"fact_rows": tot_fact, "monthly_rows": tot_monthly}

# ── Demand forecast (monthly) + program rollup ────────────────────────────
def _add_months(d, n):
    m = d.month - 1 + n
    return dt.date(d.year + m // 12, m % 12 + 1, 1)

def _forecast_series(y, have_sm):
    L = len(y)
    if have_sm and L >= 24 and float(np.std(y)) > 1e-6:
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
            fit = ExponentialSmoothing(y, trend="add", seasonal="add", seasonal_periods=12,
                                       initialization_method="estimated").fit()
            fc = np.asarray(fit.forecast(FORECAST_HORIZON), dtype=np.float64)
            resid = np.asarray(fit.fittedvalues, dtype=np.float64) - y
            return np.clip(fc, 0, None), float(np.std(resid)), "holt_winters_add"
        except Exception:
            pass
    # Fallback: least-squares linear trend + additive seasonal index by month position.
    t = np.arange(L, dtype=np.float64)
    if L >= 2:
        slope, intercept = np.polyfit(t, y, 1)
    else:
        slope, intercept = 0.0, (float(y[0]) if L else 0.0)
    line = intercept + slope * t
    seas = np.zeros(12, dtype=np.float64)
    if L >= 12:
        detr = y - line
        for m in range(12):
            idx = np.arange(m, L, 12)
            if len(idx):
                seas[m] = float(np.mean(detr[idx]))
    fitted = line + seas[(t.astype(int)) % 12]
    sigma = float(np.std(y - fitted)) if L >= 2 else (float(np.std(y)) if L else 0.0)
    fc = np.array([intercept + slope * (L + h) + seas[(L + h) % 12] for h in range(FORECAST_HORIZON)])
    return np.clip(fc, 0, None), sigma, "seasonal_naive_trend"

def build_forecast():
    try:
        import statsmodels  # noqa: F401
        have_sm = True
    except Exception as e:
        have_sm = False
        print("statsmodels unavailable -> fallback forecaster:", e)

    monthly = spark.table("gold_sales_monthly")
    nat = (monthly.groupBy("program", "month_start")
        .agg(F.sum("units").alias("units"), F.sum("revenue").alias("revenue"))
        .withColumn("state", F.lit("ALL")))
    byst = (monthly.groupBy("program", "state", "month_start")
        .agg(F.sum("units").alias("units"), F.sum("revenue").alias("revenue")))
    series_pd = (nat.select("program", "state", "month_start", "units", "revenue")
        .unionByName(byst.select("program", "state", "month_start", "units", "revenue"))
        .toPandas())
    series_pd["month_start"] = pd.to_datetime(series_pd["month_start"])

    Z = 1.28  # ~80% band
    fc_rows = []
    for (program, state) in series_pd[["program", "state"]].drop_duplicates().itertuples(index=False):
        g = series_pd[(series_pd["program"] == program) & (series_pd["state"] == state)].sort_values("month_start")
        if g.empty:
            continue
        y = g["units"].to_numpy(dtype=np.float64)
        rev = g["revenue"].to_numpy(dtype=np.float64)
        tot_u = float(y.sum())
        avg_price = float(rev.sum() / tot_u) if tot_u > 0 else 0.0
        for _, r in g.iterrows():
            ms = r["month_start"].date()
            fc_rows.append((program, state, ms, float(r["units"]), float(r["revenue"]),
                            None, None, None, None, False, "actual"))
        fc, sigma, method = _forecast_series(y, have_sm)
        last = g["month_start"].max().date()
        for h in range(FORECAST_HORIZON):
            ms = _add_months(last, h + 1)
            f_u = float(fc[h]); lo = max(0.0, f_u - Z * sigma); hi = f_u + Z * sigma
            fc_rows.append((program, state, ms, None, None, f_u, round(f_u * avg_price, 2),
                            round(lo, 2), round(hi, 2), True, method))

    fc_schema = StructType([
        StructField("program", StringType(), False), StructField("state", StringType(), False),
        StructField("month_start", DateType(), False), StructField("actual_units", DoubleType(), True),
        StructField("actual_revenue", DoubleType(), True), StructField("forecast_units", DoubleType(), True),
        StructField("forecast_revenue", DoubleType(), True), StructField("lower_units", DoubleType(), True),
        StructField("upper_units", DoubleType(), True), StructField("is_forecast", BooleanType(), False),
        StructField("method", StringType(), False)])
    gdf = (spark.createDataFrame(fc_rows, fc_schema)
        .withColumn("id", F.xxhash64(F.concat_ws("|", F.col("program"), F.col("state"),
                                                 F.col("month_start").cast("string"))))
        .select("id", "program", "state", "month_start", "actual_units", "actual_revenue",
                "forecast_units", "forecast_revenue", "lower_units", "upper_units", "is_forecast", "method"))
    gdf.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable("gold_demand_forecast")
    n_series = len(set((p, s) for (p, s, *_ ) in fc_rows))
    print("forecast series:", n_series, "| horizon:", FORECAST_HORIZON, "| statsmodels:", have_sm)
    return {"series": n_series, "have_statsmodels": have_sm}

def build_rollup():
    monthly = spark.table("gold_sales_monthly")
    by_prog = (monthly.groupBy("program")
        .agg(F.sum("units").alias("total_units"),
             F.round(F.sum("revenue"), 2).alias("total_revenue"),
             F.round(F.sum("baseline_revenue"), 2).alias("baseline_revenue"),
             F.round(F.sum("revenue_at_risk"), 2).alias("revenue_at_risk"))
        .withColumn("avg_price", F.round(F.col("total_revenue") / F.col("total_units"), 2))
        .withColumn("id", F.xxhash64(F.col("program")))
        .select("id", "program", "total_units", "total_revenue", "baseline_revenue", "revenue_at_risk", "avg_price"))
    by_prog.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable("gold_sales_by_program")
    by_prog.show(truncate=False)

# ── Validation gate ───────────────────────────────────────────────────────
def _key_ok(table):
    df = spark.table(table)
    n = df.count(); d = df.select("id").distinct().count(); nulls = df.where(F.col("id").isNull()).count()
    return {"rows": n, "distinct_id": d, "null_id": nulls, "ok": (n == d and nulls == 0)}

def validate():
    summary = {}
    tables = ["dim_city", "dim_shop", "dim_sku", "fact_sales_daily", "gold_sales_monthly",
              "gold_demand_forecast", "gold_sales_by_program", "ctl_sales_years"]
    summary["counts"] = {t: spark.table(t).count() for t in tables}
    summary["keys"] = {t: _key_ok(t) for t in
                       ["dim_city", "dim_shop", "dim_sku", "fact_sales_daily", "gold_sales_monthly",
                        "gold_demand_forecast", "gold_sales_by_program"]}

    fact = spark.table("fact_sales_daily"); mon = spark.table("gold_sales_monthly")
    f_u = fact.agg(F.sum("units")).first()[0] or 0
    f_r = float(fact.agg(F.sum("revenue")).first()[0] or 0.0)
    m_u = mon.agg(F.sum("units")).first()[0] or 0
    m_r = float(mon.agg(F.sum("revenue")).first()[0] or 0.0)
    summary["reconcile"] = {"fact_units": int(f_u), "monthly_units": int(m_u), "units_match": int(f_u) == int(m_u),
                            "fact_revenue": round(f_r, 2), "monthly_revenue": round(m_r, 2),
                            "revenue_match": abs(f_r - m_r) < 1.0}

    dd = spark.table("gold_dim_date").select(F.col("id").alias("date_key"))
    orphan_dates = fact.select("date_key").distinct().join(dd, "date_key", "left_anti").count()
    orphan_shops = fact.select("shop_id").distinct().join(
        spark.table("dim_shop").select(F.col("id").alias("shop_id")), "shop_id", "left_anti").count()
    orphan_skus = fact.select("sku_id").distinct().join(
        spark.table("dim_sku").select(F.col("id").alias("sku_id")), "sku_id", "left_anti").count()
    summary["fk"] = {"orphan_date_keys": orphan_dates, "orphan_shop_ids": orphan_shops,
                     "orphan_sku_ids": orphan_skus,
                     "ok": (orphan_dates == 0 and orphan_shops == 0 and orphan_skus == 0)}

    cliff = (mon.where(F.col("is_banned") & F.col("effective_date").isNotNull())
        .select("state", "program", "effective_date").distinct().orderBy("program", "state"))
    atrisk = (mon.where(F.col("is_banned") & F.col("effective_date").isNull())
        .select("state", "program").distinct().orderBy("program", "state"))
    rar_total = float(mon.agg(F.sum("revenue_at_risk")).first()[0] or 0.0)
    summary["coupling"] = {"cliff_state_skus": cliff.count(), "at_risk_state_skus": atrisk.count(),
                           "revenue_at_risk_total": round(rar_total, 2),
                           "cliff_examples": [f"{r['program']}/{r['state']}@{r['effective_date']}" for r in cliff.limit(12).collect()],
                           "at_risk_examples": [f"{r['program']}/{r['state']}" for r in atrisk.limit(12).collect()]}
    summary["window"] = {"start": START_DATE, "end": END_DATE,
                         "date_min": str(fact.agg(F.min("date")).first()[0]),
                         "date_max": str(fact.agg(F.max("date")).first()[0])}
    summary["params"] = {"LAMBDA_BASE": LAMBDA_BASE, "TAPER_DAYS": TAPER_DAYS,
                         "TAX_PASSTHROUGH": TAX_PASSTHROUGH, "TREND_ANNUAL": TREND_ANNUAL,
                         "FORECAST_HORIZON": FORECAST_HORIZON}
    all_keys_ok = all(v["ok"] for v in summary["keys"].values())
    summary["gate_ok"] = (all_keys_ok and summary["reconcile"]["units_match"]
                          and summary["reconcile"]["revenue_match"] and summary["fk"]["ok"]
                          and summary["coupling"]["revenue_at_risk_total"] > 0)
    return summary

print("definitions loaded | window:", WINDOW_START, "->", WINDOW_END, "| years:", run_years())
`, false]);

// ── CELL 3: guarded driver (writes traceback to Files/_run on any failure) ──
cells.push([`# ── Driver — runs the whole pipeline under one guard ─────────────────────
try:
    pairs, dim_counts = build_dims_and_pairs()
    totals = run_sales(pairs, run_years())
    fc_info = build_forecast()
    build_rollup()
    summary = validate()
    summary["totals"] = totals
    summary["dim_counts"] = dim_counts
    summary["forecast"] = fc_info
    _put("Files/_run/sales_summary.json", json.dumps(summary, indent=2, default=str))
    print(json.dumps(summary, indent=2, default=str))
    if not summary["gate_ok"]:
        raise Exception("VALIDATION GATE FAILED — see summary above (keys/reconcile/fk/coupling).")
    print("VALIDATION GATE PASSED ✅  fact_sales_daily rows:", summary["counts"]["fact_sales_daily"])
except Exception as _err:
    tb = traceback.format_exc()
    print(tb)
    try:
        _put("Files/_run/sales_error.txt", tb)
        print("wrote Files/_run/sales_error.txt")
    except Exception as _e2:
        print("could not write error file:", _e2)
    raise
`, false]);

// ── ipynb assembly ────────────────────────────────────────────────────────
function makeCell(src, isParam) {
  const lines = src.split(/(?<=\n)/);
  const c = { cell_type: "code", source: lines, outputs: [], execution_count: null, metadata: {} };
  if (isParam) c.metadata.tags = ["parameters"];
  return c;
}
const nb = {
  nbformat: 4, nbformat_minor: 5,
  cells: cells.map(([s, p]) => makeCell(s, p)),
  metadata: {
    language_info: { name: "python" },
    kernelspec: { name: "synapse_pyspark", display_name: "Synapse PySpark" },
    dependencies: {
      lakehouse: {
        default_lakehouse: LH_ID,
        default_lakehouse_name: LH_NAME,
        default_lakehouse_workspace_id: WS_ID,
      },
    },
  },
};

// ── Git-synced .py export ──────────────────────────────────────────────────
function writePyExport() {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "..", "workspace-sync", `${NB_NAME}.Notebook`, "notebook-content.py");
  const parts = [
    "# Fabric notebook source", "",
    "# METADATA ********************", "",
    "# META {",
    '# META   "kernel_info": {',
    '# META     "name": "synapse_pyspark"',
    "# META   },",
    '# META   "dependencies": {',
    '# META     "lakehouse": {',
    `# META       "default_lakehouse": "${LH_ID}",`,
    `# META       "default_lakehouse_name": "${LH_NAME}",`,
    `# META       "default_lakehouse_workspace_id": "${WS_ID}"`,
    "# META     }", "# META   }", "# META }", "",
  ];
  cells.forEach(([src, isParam], i) => {
    parts.push(isParam ? "# PARAMETERS CELL ********************" : "# CELL ********************");
    parts.push("");
    parts.push(src.replace(/\n$/, ""));
    parts.push("");
    parts.push("# METADATA ********************", "");
    parts.push("# META {", '# META   "language": "python",', '# META   "language_group": "synapse_pyspark"', "# META }");
    if (i < cells.length - 1) parts.push("");
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, parts.join("\n") + "\n", "utf8");
  console.log("wrote export:", out);
}

async function deploy() {
  const tok = token();
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const list = await (await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/notebooks`, { headers: H })).json();
  const existing = (list.value || []).find((n) => n.displayName === NB_NAME);
  const payload = Buffer.from(JSON.stringify(nb), "utf8").toString("base64");
  const definition = { format: "ipynb", parts: [
    { path: "notebook-content.ipynb", payload, payloadType: "InlineBase64" }] };

  const poll = async (res) => {
    let opUrl = res.headers.get("operation-location") || res.headers.get("location");
    for (let i = 0; i < 60 && opUrl; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await fetch(opUrl, { headers: H });
      const st = await s.json().catch(() => ({}));
      if (st.status === "Succeeded" || s.status === 200) {
        const rr = await fetch(opUrl + "/result", { headers: H }).catch(() => null);
        const rj = rr ? await rr.json().catch(() => ({})) : {};
        return rj.id || null;
      }
      if (st.status === "Failed") throw new Error("LRO Failed: " + JSON.stringify(st));
    }
    return null;
  };

  let res, id = existing?.id;
  if (existing) {
    res = await fetch(
      `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/notebooks/${id}/updateDefinition`,
      { method: "POST", headers: H, body: JSON.stringify({ definition }) });
    console.log("UPDATE status:", res.status, "id:", id);
    if (res.status !== 200 && res.status !== 202)
      console.log("UPDATE body:", (await res.text().catch(() => "")).slice(0, 400));
    if (res.status === 202) await poll(res);
  } else {
    res = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/notebooks`,
      { method: "POST", headers: H, body: JSON.stringify({ displayName: NB_NAME, description: NB_DESC, definition }) });
    console.log("CREATE status:", res.status);
    if (res.status === 201) {
      const body = await res.json().catch(() => ({}));
      id = body.id;
    } else if (res.status === 202) {
      id = await poll(res);
    } else {
      throw new Error("CREATE failed: " + res.status + " " + (await res.text().catch(() => "")));
    }
    console.log("id:", id);
  }
  return id;
}

writePyExport();
if (process.env.SKIP_DEPLOY !== "1") {
  const id = await deploy();
  console.log("notebook item id:", id);
} else {
  console.log("SKIP_DEPLOY=1 — export only, no REST call.");
}
