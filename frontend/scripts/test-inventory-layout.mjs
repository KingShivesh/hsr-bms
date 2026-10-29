import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const api = "http://127.0.0.1:8006", root = "../docs/deployment-ui-completion/inventory-maintenance";
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(response => response.json());
assert.ok(auth.token);
const results = [];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const stage of ["before", "after"]) {
    await fs.mkdir(`${root}/${stage}`, { recursive: true });
    for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      await context.route(api + "/sessions/alerts", handler => handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } }));
      const page = await context.newPage();
      try {
        await page.goto(`http://127.0.0.1:${stage === "before" ? 5180 : 5181}/inventory`);
        const panel = page.locator(".cf-panel").filter({ has: page.getByRole("heading", { name: "Table Maintenance", exact: true }) });
        await panel.getByRole("button", { name: "Mark", exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await panel.scrollIntoViewIfNeeded();
        const controls = await panel.locator(".cf-inline-form input,.cf-inline-form select,.cf-inline-form button").evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          return { label: node.getAttribute("aria-label") || node.textContent.trim(), left: box.left, right: box.right, overflow: Math.max(0, box.right - innerWidth, -box.left) };
        }));
        results.push({ stage, theme, width, controls });
        await panel.screenshot({ path: `${root}/${stage}/${theme}-${width}-default.png`, animations: "disabled" });
        if (stage === "after") assert.ok(controls.length === 3 && controls.every(control => control.overflow === 0));
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); await fs.writeFile(`${root}/results.json`, JSON.stringify(results, null, 2)); }
console.log(JSON.stringify(results));
