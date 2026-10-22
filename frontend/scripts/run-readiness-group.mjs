import { spawnSync } from "node:child_process";

const [group, stage = "after"] = process.argv.slice(2);
if (!["before", "after"].includes(stage)) throw new Error("Choose before or after");
const groups = {
  settings: [
    ["settings-team", "/settings?section=team", "^/product/account$"],
    ["settings-account", "/settings?section=account", "^/product/account$"],
    ["settings-activity", "/settings?section=activity", "^/operations/audit-logs$"],
    ["settings-billing", "/settings?section=billing", "^/product/account$", "default,error"],
  ],
  operations: [
    ["inventory", "/inventory"], ["waitlist", "/waitlist"],
    ["legacy-table-controls", "/legacy-table-controls"], ["tournaments", "/tournaments"],
  ],
  remaining: [
    ["daily-closing", "/daily-closing"], ["pricing-rules", "/pricing-rules"],
    ["audit-log", "/audit-log"], ["status", "/status"],
    ["help", "/help", null, "default"], ["changelog", "/changelog", null, "default"],
    ["demo", "/demo", null, "default"], ["not-found", "/missing-page", null, "default"],
  ],
};
if (!groups[group]) throw new Error("Unknown readiness group");
const failures = [];
for (const [name, route, path, states] of groups[group]) {
  const env = { ...process.env, UI_OUTPUT_DIR: `${process.env.UI_OUTPUT_ROOT || "../docs/ui-readiness"}/${name}/${stage}` };
  if (path) env.UI_DATA_PATH = path; else delete env.UI_DATA_PATH;
  if (states) env.UI_STATES = states; else delete env.UI_STATES;
  const result = spawnSync(process.execPath, ["scripts/scan-ui-readiness.mjs", route, stage], { env, stdio: "inherit" });
  if (result.status !== 0) failures.push({ name, status: result.status });
}
console.log(JSON.stringify({ group, stage, failures }));
if (failures.length) process.exitCode = 1;
