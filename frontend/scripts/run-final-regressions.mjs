import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = process.env.FINAL_REGRESSION_ROOT || "../docs/deployment-ui-completion/final-completion/full-regression";
await fs.mkdir(root, { recursive: true });
const steps = [
  ["core", "scripts/run-deployment-matrix.mjs", "core", "after"],
  ["operations", "scripts/run-readiness-group.mjs", "operations", "after"],
  ["service-pages", "scripts/run-readiness-group.mjs", "remaining", "after"],
  ["settings", "scripts/run-readiness-group.mjs", "settings", "after"],
  ["report-tabs", "scripts/run-deployment-matrix.mjs", "report-tabs", "after"],
  ["cafe-tabs", "scripts/run-deployment-matrix.mjs", "cafe-tabs", "after"],
  ...["dashboard", "daily-closing"].map(route => [route, "scripts/scan-ui-readiness.mjs", `/${route}`, "after"]),
];
const report = { scope: "Complete existing six-state read-fixture matrices, both themes and four widths; static pages retain applicable states only", steps: [] };
for (const [name, script, ...args] of steps) {
  const env = { ...process.env, UI_STRICT_PILOT: "true", UI_WIDTHS: "375,768,1024,1440", UI_OUTPUT_ROOT: root, UI_OUTPUT_DIR: `${root}/${name}/after` };
  delete env.UI_STATES;
  const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  await fs.writeFile(`${root}/${name}.log`, (result.stdout || "") + (result.stderr || ""));
  report.steps.push({ name, status: result.status, error: result.error?.message });
  await fs.writeFile(`${root}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.steps.at(-1)));
}
if (report.steps.some(step => step.status !== 0)) process.exitCode = 1;
