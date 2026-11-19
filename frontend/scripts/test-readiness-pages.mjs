import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const routes = ["dashboard", "live-floor", "customers", "bookings", "cafe-pos", "sales", "analytics", "settings", "inventory", "waitlist", "legacy-table-controls", "tournaments", "daily-closing", "pricing-rules", "audit-log"];
const root = "../docs/daily-use-readiness/phase-1/pages";
const report = { scope: "Disposable local UI database; production not accessed", states: ["loading", "error", "empty"], themes: ["light", "dark"], widths: [375, 1440], routes: [] };
await fs.mkdir(root, { recursive: true });
for (const route of routes) {
  const output = `${root}/${route}`;
  const result = spawnSync(process.execPath, ["scripts/scan-ui-readiness.mjs", `/${route}`, "after"], {
    env: { ...process.env, UI_APP_URL: process.env.UI_APP_URL || "http://127.0.0.1:5189", UI_WIDTHS: "375,1440", UI_STATES: "loading,error,empty", UI_STRICT_PILOT: "true", UI_OUTPUT_DIR: output },
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(`${output}/run.log`, `${result.stdout || ""}${result.stderr || ""}`);
  const row = { route, status: result.status, error: result.error?.message };
  report.routes.push(row);
  console.log(JSON.stringify(row));
  await fs.writeFile(`${root}/results.json`, JSON.stringify(report, null, 2));
}
if (report.routes.some(row => row.status !== 0)) process.exitCode = 1;
