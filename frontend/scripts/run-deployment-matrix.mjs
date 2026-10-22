import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const [group = "default", stage = "after"] = process.argv.slice(2);
if (!["before", "after"].includes(stage)) throw new Error("Choose before or after");
const routes = ["/dashboard", "/live-floor", "/customers", "/bookings", "/cafe-pos", "/sales", "/analytics", "/settings", "/inventory", "/waitlist", "/legacy-table-controls", "/tournaments", "/daily-closing", "/pricing-rules", "/audit-log", "/status", "/help", "/changelog", "/demo", "/missing-page"];
const groups = {
  default: routes.map(route => ({ route, states: "default" })),
  core: ["/live-floor", "/customers", "/bookings", "/cafe-pos", "/sales", "/analytics", "/settings"].map(route => ({ route })),
  "cafe-tabs": [{ route: "/cafe-pos", tab: "Stats", key: "cafe-stats", data: "^/food/stats$" }, { route: "/cafe-pos", tab: "Order History", key: "cafe-history", data: "^/food/orders$" }],
};
if (!groups[group]) throw new Error("Unknown deployment matrix group");
const root = process.env.UI_OUTPUT_ROOT || "../docs/deployment-ui-completion";
const report = { group, stage, widths: [375, 768, 1024, 1440], strictPilot: true, results: [] };
await fs.mkdir(root, { recursive: true });
for (const row of groups[group]) {
  const key = row.key || row.route.slice(1);
  const env = { ...process.env, UI_OUTPUT_DIR: `${root}/${group === "default" ? "shared-regression/" : ""}${key}/${stage}`, UI_WIDTHS: "375,768,1024,1440", UI_STRICT_PILOT: "true" };
  if (row.states) env.UI_STATES = row.states; else delete env.UI_STATES;
  if (row.tab) env.UI_TAB = row.tab; else delete env.UI_TAB;
  if (row.data) env.UI_DATA_PATH = row.data; else delete env.UI_DATA_PATH;
  const result = spawnSync(process.execPath, ["scripts/scan-ui-readiness.mjs", row.route, stage], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  await fs.writeFile(`${env.UI_OUTPUT_DIR}/run.log`, (result.stdout || "") + (result.stderr || ""));
  report.results.push({ ...row, status: result.status, error: result.error?.message, output: env.UI_OUTPUT_DIR });
  console.log(JSON.stringify(report.results.at(-1)));
}
await fs.writeFile(`${root}/${group}-${stage}.json`, JSON.stringify(report, null, 2));
if (stage === "after" && report.results.some(row => row.status !== 0)) process.exitCode = 1;
