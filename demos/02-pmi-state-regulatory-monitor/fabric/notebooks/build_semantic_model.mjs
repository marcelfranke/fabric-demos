// Deploys the PMI Dynamic Pricing Direct Lake semantic model (TMDL) to the
// "Dynamic Pricing" Fabric workspace via the Fabric REST API, then reframes it
// so Direct Lake picks up the Gold Delta tables.
//
// Auth is performed at runtime via the Azure CLI (az account get-access-token) —
// NO credentials are stored in this repo. Workspace / lakehouse / item ids are
// Azure resource identifiers, not secrets.
//
//   node fabric/notebooks/build_semantic_model.mjs
//
// Requires Node 18+ (global fetch) and an authenticated `az login`.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05"; // "Dynamic Pricing"
const SM_NAME = "PMI Dynamic Pricing";
const SM_DESC = "Direct Lake star schema over pmi_lakehouse Gold pricing signals.";

const here = dirname(fileURLToPath(import.meta.url));
const SM_ROOT = join(here, "..", "semantic-model");

function token(resource) {
  return execSync(
    `az account get-access-token --resource "${resource}" --tenant ${TENANT} --query accessToken -o tsv`,
    { encoding: "utf8", shell: "powershell.exe" }
  ).trim();
}

// ── collect TMDL definition parts (definition.pbism + definition/**) ──────────
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === ".platform") continue;
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
function parts() {
  return walk(SM_ROOT).map((full) => ({
    path: relative(SM_ROOT, full).split("\\").join("/"),
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
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/semanticModels`, { headers: H })).json();
  const existing = (list.value || []).find((n) => n.displayName === SM_NAME);
  const definition = { parts: parts() };

  let res, id = existing?.id;
  if (existing) {
    res = await fetch(
      `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/semanticModels/${id}/updateDefinition`,
      { method: "POST", headers: H, body: JSON.stringify({ definition }) });
    console.log("UPDATE status:", res.status, "id:", id);
    if (res.status !== 200 && res.status !== 202)
      console.log("UPDATE body:", (await res.text().catch(() => "")).slice(0, 600));
    if (res.status === 202) await poll(res, H);
  } else {
    res = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/semanticModels`,
      { method: "POST", headers: H, body: JSON.stringify({ displayName: SM_NAME, description: SM_DESC, definition }) });
    console.log("CREATE status:", res.status);
    if (res.status === 201) id = (await res.json().catch(() => ({}))).id;
    else if (res.status === 202) id = await poll(res, H);
    else throw new Error("CREATE failed: " + res.status + " " + (await res.text().catch(() => "")));
  }
  console.log("semantic model id:", id);
  return id;
}

async function reframe(id) {
  // Direct Lake reframing: trigger a dataset refresh via the Power BI REST API.
  const tok = token("https://analysis.windows.net/powerbi/api");
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WS_ID}/datasets/${id}/refreshes`,
    { method: "POST", headers: H, body: JSON.stringify({ type: "full" }) });
  console.log("REFRESH (reframe) status:", res.status);
  if (res.status !== 202 && res.status !== 200)
    console.log("REFRESH body:", (await res.text().catch(() => "")).slice(0, 400));
}

const id = await deploy();
if (id && process.env.SKIP_REFRAME !== "1") {
  try { await reframe(id); } catch (e) { console.log("reframe error:", e.message); }
}
