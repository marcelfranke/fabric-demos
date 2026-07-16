// Triggers a RunNotebook job for the PMI medallion notebook on the Dynamic
// Pricing workspace and polls it to a terminal state. Auth via az CLI at runtime.
//   node fabric/notebooks/run_notebook.mjs
import { execSync } from "node:child_process";

const TENANT = process.env.FABRIC_TENANT_ID || "1cf0faf3-5363-470a-8369-df15f6562c64";
const WS_ID = process.env.FABRIC_WORKSPACE_ID || "aa0aa5fa-e638-4e4a-a0a2-a6da3e515f05";
const NB_ID = process.env.FABRIC_NOTEBOOK_ID || "904e669e-dd9c-4b36-9362-64d11051a175";

const tok = execSync(
  `az account get-access-token --resource "https://api.fabric.microsoft.com" --tenant ${TENANT} --query accessToken -o tsv`,
  { encoding: "utf8", shell: "powershell.exe" }).trim();
const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

const res = await fetch(
  `https://api.fabric.microsoft.com/v1/workspaces/${WS_ID}/items/${NB_ID}/jobs/instances?jobType=RunNotebook`,
  { method: "POST", headers: H, body: JSON.stringify({ executionData: {} }) });
console.log("trigger status:", res.status);
const loc = res.headers.get("location");
if (!loc) { console.log("no location; body:", await res.text()); process.exit(1); }
console.log("job instance:", loc);

for (let i = 0; i < 120; i++) {
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
