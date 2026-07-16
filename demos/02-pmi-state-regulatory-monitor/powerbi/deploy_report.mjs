// Deploys the "PMI Dynamic Pricing" Power BI report (PBIR) to the
// "Dynamic Pricing" Fabric workspace via the Fabric REST API, UPSERT-style
// (update-if-exists else create), bound by connection to the deployed
// Direct Lake semantic model.
//
// Auth is performed at runtime via the Azure CLI (az account get-access-token) —
// NO credentials are stored in this repo. Workspace / item ids are Azure
// resource identifiers, not secrets.
//
//   node powerbi/deploy_report.mjs
//
// NOTE: this Fabric tenant's Power BI ring may reject a PBIR **API** import when
// the definition schema is newer than the ring supports. If the create/update
// returns an "unsupported/invalid definition" error, publish from Power BI
// Desktop instead (open the .pbip and Home -> Publish). See powerbi/README.md.
//
// Requires Node 18+ (global fetch) and an authenticated `az login`.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05"; // "Dynamic Pricing"
const RPT_NAME = "PMI Dynamic Pricing";
const RPT_DESC = "3-page pricing decision dashboard over the PMI Dynamic Pricing Direct Lake model.";

const here = dirname(fileURLToPath(import.meta.url));
const RPT_ROOT = join(here, "PMI Dynamic Pricing.Report");

function token(resource) {
  return execSync(
    `az account get-access-token --resource "${resource}" --tenant ${TENANT} --query accessToken -o tsv`,
    { encoding: "utf8", shell: "powershell.exe" }
  ).trim();
}

// ── collect PBIR definition parts (definition.pbir + definition/** + StaticResources/**) ──
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === ".platform") continue; // git-sync only, not part of REST definition
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
function parts() {
  return walk(RPT_ROOT).map((full) => ({
    path: relative(RPT_ROOT, full).split("\\").join("/"),
    payload: readFileSync(full).toString("base64"),
    payloadType: "InlineBase64",
  }));
}

async function poll(res, H) {
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
}

async function deploy() {
  const tok = token("https://api.fabric.microsoft.com");
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const list = await (await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/reports`, { headers: H })).json();
  const existing = (list.value || []).find((n) => n.displayName === RPT_NAME);
  const definition = { parts: parts() };

  let res, id = existing?.id;
  if (existing) {
    res = await fetch(
      `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/reports/${id}/updateDefinition`,
      { method: "POST", headers: H, body: JSON.stringify({ definition }) });
    console.log("UPDATE status:", res.status, "id:", id);
    if (res.status !== 200 && res.status !== 202)
      console.log("UPDATE body:", (await res.text().catch(() => "")).slice(0, 800));
    if (res.status === 202) await poll(res, H);
  } else {
    res = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/reports`,
      { method: "POST", headers: H, body: JSON.stringify({ displayName: RPT_NAME, description: RPT_DESC, definition }) });
    console.log("CREATE status:", res.status);
    if (res.status === 201) id = (await res.json().catch(() => ({}))).id;
    else if (res.status === 202) id = await poll(res, H);
    else { console.log("CREATE body:", (await res.text().catch(() => "")).slice(0, 800)); throw new Error("CREATE failed: " + res.status); }
  }
  console.log("report id:", id);
  console.log(`report url: https://app.powerbi.com/groups/${WS_ID}/reports/${id}`);
  return id;
}

await deploy();
