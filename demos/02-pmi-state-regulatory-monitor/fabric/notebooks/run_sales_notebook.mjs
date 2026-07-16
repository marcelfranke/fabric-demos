// Triggers a RunNotebook job for the PMI synthetic-sales notebook on the Dynamic
// Pricing workspace and polls it to a terminal state. Resolves the notebook id by its
// stable displayName at runtime (no hardcoded item GUID). Auth via az CLI at runtime.
//   node fabric/notebooks/run_sales_notebook.mjs
// Optional parameter overrides via env, forwarded as notebook parameters, e.g.:
//   NB_PARAMS='{"LAMBDA_BASE":15,"YEARS":"2018,2019"}' node fabric/notebooks/run_sales_notebook.mjs
import { execSync } from "node:child_process";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05";
const NB_NAME = process.env.FABRIC_NOTEBOOK_NAME || "02_pmi_sales_forecast";

const tok = execSync(
  `az account get-access-token --resource "https://api.fabric.microsoft.com" --tenant ${TENANT} --query accessToken -o tsv`,
  { encoding: "utf8", shell: "powershell.exe" }).trim();
const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

// Resolve notebook id by stable displayName.
let NB_ID = process.env.FABRIC_NOTEBOOK_ID;
if (!NB_ID) {
  const list = await (await fetch(
    `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/notebooks`, { headers: H })).json();
  const nb = (list.value || []).find((n) => n.displayName === NB_NAME);
  if (!nb) { console.log(`notebook '${NB_NAME}' not found in workspace`); process.exit(1); }
  NB_ID = nb.id;
}
console.log("notebook:", NB_NAME, NB_ID);

// Optional parameter overrides -> Fabric parameterization payload.
const executionData = {};
if (process.env.NB_PARAMS) {
  const raw = JSON.parse(process.env.NB_PARAMS);
  const typeOf = (v) => (typeof v === "number" ? (Number.isInteger(v) ? "int" : "float")
    : typeof v === "boolean" ? "bool" : "string");
  executionData.parameters = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, { value: v, type: typeOf(v) }]));
  console.log("parameters:", JSON.stringify(executionData.parameters));
}

const res = await fetch(
  `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/items/${NB_ID}/jobs/instances?jobType=RunNotebook`,
  { method: "POST", headers: H, body: JSON.stringify({ executionData }) });
console.log("trigger status:", res.status);
const loc = res.headers.get("location");
if (!loc) { console.log("no location; body:", await res.text()); process.exit(1); }
console.log("job instance:", loc);

for (let i = 0; i < 180; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const s = await fetch(loc, { headers: H });
  const st = await s.json().catch(() => ({}));
  const status = st.status || st.state;
  process.stdout.write(`[${i}] ${status}\n`);
  if (["Completed", "Succeeded"].includes(status)) { console.log("DONE"); process.exit(0); }
  if (["Failed", "Cancelled", "Deduped"].includes(status)) {
    console.log("FAILED:", JSON.stringify(st.failureReason || st, null, 2)); process.exit(2);
  }
}
console.log("timed out waiting for job");
process.exit(3);
