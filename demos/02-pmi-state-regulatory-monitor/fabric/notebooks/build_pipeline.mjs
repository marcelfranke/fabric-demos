// Deploys the PMI pricing Data Pipeline (orchestrates the medallion notebook on a
// daily schedule) to the "Dynamic Pricing" Fabric workspace via the Fabric REST API.
//
// Auth is performed at runtime via the Azure CLI (az account get-access-token) —
// NO credentials are stored in this repo. Workspace / notebook ids are Azure
// resource identifiers, not secrets.
//
//   node fabric/notebooks/build_pipeline.mjs
//
// Requires Node 18+ (global fetch) and an authenticated `az login`. It also writes
// the Git-synced export at workspace-sync/pmi_pricing_pipeline.DataPipeline/.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05"; // "Dynamic Pricing"
const NB_ID = process.env.FABRIC_NOTEBOOK_ID || "904e669e-dd9c-4b36-9362-64d11051a175";
const PL_NAME = "pmi_pricing_pipeline";
const PL_DESC = "Daily orchestration: run the PMI medallion notebook (Bronze/Silver/Gold pricing signals).";

const here = dirname(fileURLToPath(import.meta.url));

function token() {
  return execSync(
    `az account get-access-token --resource "https://api.fabric.microsoft.com" --tenant ${TENANT} --query accessToken -o tsv`,
    { encoding: "utf8", shell: "powershell.exe" }
  ).trim();
}

// ── Pipeline definition: single Notebook activity running the medallion notebook ──
const pipelineContent = {
  properties: {
    activities: [
      {
        name: "Run PMI medallion",
        type: "TridentNotebook",
        dependsOn: [],
        policy: { timeout: "0.02:00:00", retry: 1, retryIntervalInSeconds: 60 },
        typeProperties: { notebookId: NB_ID, workspaceId: WS_ID },
      },
    ],
  },
};

function writeExport() {
  const dir = join(here, "..", "..", "workspace-sync", `${PL_NAME}.DataPipeline`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pipeline-content.json"), JSON.stringify(pipelineContent, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, ".platform"), JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "DataPipeline", displayName: PL_NAME, description: PL_DESC },
    config: { version: "2.0", logicalId: "00000000-0000-0000-0000-000000000000" },
  }, null, 2) + "\n", "utf8");
  console.log("wrote export:", dir);
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
  const tok = token();
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const payload = Buffer.from(JSON.stringify(pipelineContent), "utf8").toString("base64");
  const definition = { parts: [{ path: "pipeline-content.json", payload, payloadType: "InlineBase64" }] };

  const list = await (await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/dataPipelines`, { headers: H })).json();
  const existing = (list.value || []).find((n) => n.displayName === PL_NAME);

  let res, id = existing?.id;
  if (existing) {
    res = await fetch(
      `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/dataPipelines/${id}/updateDefinition`,
      { method: "POST", headers: H, body: JSON.stringify({ definition }) });
    console.log("UPDATE status:", res.status, "id:", id);
    if (res.status !== 200 && res.status !== 202)
      console.log("UPDATE body:", (await res.text().catch(() => "")).slice(0, 600));
    if (res.status === 202) await poll(res, H);
  } else {
    res = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/dataPipelines`,
      { method: "POST", headers: H, body: JSON.stringify({ displayName: PL_NAME, description: PL_DESC, definition }) });
    console.log("CREATE status:", res.status);
    if (res.status === 201) id = (await res.json().catch(() => ({}))).id;
    else if (res.status === 202) id = await poll(res, H);
    else throw new Error("CREATE failed: " + res.status + " " + (await res.text().catch(() => "")));
  }
  console.log("pipeline id:", id);
  return { id, H };
}

async function schedule(id, H) {
  // Daily schedule at 06:00 UTC via the item job scheduler.
  const body = {
    enabled: true,
    configuration: {
      type: "Daily",
      times: ["06:00"],
      startDateTime: "2026-01-01T00:00:00",
      endDateTime: "2030-12-31T23:59:59",
      localTimeZoneId: "UTC",
    },
  };
  const res = await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/items/${id}/jobs/Pipeline/schedules`,
    { method: "POST", headers: H, body: JSON.stringify(body) });
  console.log("SCHEDULE status:", res.status);
  if (res.status !== 201 && res.status !== 200)
    console.log("SCHEDULE body:", (await res.text().catch(() => "")).slice(0, 500));
}

writeExport();
if (process.env.SKIP_DEPLOY !== "1") {
  const { id, H } = await deploy();
  if (id && process.env.SKIP_SCHEDULE !== "1") {
    try { await schedule(id, H); } catch (e) { console.log("schedule error:", e.message); }
  }
} else {
  console.log("SKIP_DEPLOY=1 — export only, no REST call.");
}
