import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = "final-completion";
const current = process.env.FINAL_COMPLETION_CURRENT_ROOT || `${root}/shipping-regression`;
if (current.includes("..") || current.startsWith("/")) throw new Error("Current captures must stay inside the evidence directory");
const routes = ["dashboard", "live-floor", "customers", "bookings", "cafe-pos", "sales", "analytics", "settings", "inventory", "waitlist", "legacy-table-controls", "tournaments", "daily-closing", "pricing-rules", "audit-log", "status", "help", "changelog", "demo", "missing-page"];
const comparisons = routes.map(route => ({
  key: `final-${route}`, state: "default",
  before: route === "pricing-rules" ? `${root}/baseline/pricing-retry/before/{theme}-{width}-default.png` : `${root}/baseline/shared-regression/${route}/before/{theme}-{width}-default.png`,
  after: `${current}/shared-regression/${route}/after/{theme}-{width}-default.png`,
}));
for (const [key, state, before, after] of [
  ["final-command", "commands", "dialogs/before-history-final/admin-{theme}-{width}-commands.png", "dialogs/after-shipping/admin-{theme}-{width}-commands.png"],
  ["final-history", "history-error", "dialogs/before-history-final/admin-{theme}-{width}-history-error.png", "dialogs/after-shipping/admin-{theme}-{width}-history-error.png"],
  ["final-history", "history-populated", "dialogs/before-history-final/admin-{theme}-{width}-history-populated.png", "dialogs/after-shipping/admin-{theme}-{width}-history-populated.png"],
  ["final-reset", "reset", "dialogs/before-history-final/admin-{theme}-{width}-reset.png", "dialogs/after-shipping/admin-{theme}-{width}-reset.png"],
  ["final-food", "partial", "session-food/before/admin-{theme}-{width}-partial-failure.png", "session-food/after-final/admin-{theme}-{width}-partial.png"],
  ["final-food", "empty", "session-food/before/admin-{theme}-{width}-empty.png", "session-food/after-final/admin-{theme}-{width}-empty.png"],
  ["final-sidebar", "compact", "sidebar-footer/before/admin-{theme}-{width}-compact.png", "sidebar-footer/after/admin-{theme}-{width}-compact.png"],
  ["final-report-filters", "default", "full-regression/reports-customers/after/{theme}-{width}-default.png", "release-matrix-final/reports-customers/after/{theme}-{width}-default.png"],
  ["final-cafe-stats", "extreme", "full-regression/cafe-stats/after/{theme}-{width}-extreme.png", "release-matrix-final/cafe-stats/after/{theme}-{width}-extreme.png"],
  ["final-cafe-history", "partial", "full-regression/cafe-history/after/{theme}-{width}-partial.png", "release-matrix-final/cafe-history/after/{theme}-{width}-partial.png"],
]) comparisons.push({ key, state, before: `${root}/${before}`, after: `${root}/${after}` });

const manifest = [];
for (const row of comparisons) {
  const result = spawnSync(process.execPath, ["scripts/compose-deployment-proof.mjs", row.key, row.state, "375"], { encoding: "utf8", env: { ...process.env, UI_BEFORE_CAPTURE: row.before, UI_AFTER_CAPTURE: row.after } });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const image = `comparisons/${row.key}-${row.state}-375.png`;
  manifest.push({ ...row, image, legend: "Before left, after right; light above dark; original screenshot pixels, first 1000px of tall captures" });
  console.log(image);
}
await fs.writeFile(`../docs/deployment-ui-completion/${root}/comparisons.json`, JSON.stringify(manifest, null, 2));
