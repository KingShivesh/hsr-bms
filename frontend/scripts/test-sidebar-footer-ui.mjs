import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const stage = process.argv[2] || "after";
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5182}`, api = "http://127.0.0.1:8006";
const output = `../docs/deployment-ui-completion/final-completion/sidebar-footer/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], blockedWrites: [], scope: "Local read-only navigation, no business writes" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
try {
  for (const role of ["admin", "staff"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
      const row = { role, theme, width }; report.cases.push(row);
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); localStorage.setItem("sidebarCollapsed", "false"); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      await context.route("**/*", handler => {
        const r = handler.request(), u = new URL(r.url());
        if (![app, api].includes(u.origin)) return handler.abort("blockedbyclient");
        if (!["GET", "HEAD", "OPTIONS"].includes(r.method())) { report.blockedWrites.push(u.pathname); return handler.abort("blockedbyclient"); }
        if (u.origin === api && u.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        return handler.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      try {
        await page.goto(app + "/help"); await page.locator(".topbar-title").waitFor(); await settle(page);
        const footer = page.locator(".product-footer");
        row.initialVisible = await footer.isVisible();
        row.initialBounds = await footer.getByRole("button").evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(), p = n.closest(".cf-sidebar").getBoundingClientRect(); return { label: n.innerText, right: r.right, sidebarRight: p.right, excess: Math.max(0, r.right - p.right) }; }));
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-compact.png`, animations: "disabled" });
        if (stage === "after") assert.equal(row.initialVisible, width > 768);
        if (width <= 768) await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
        await footer.getByRole("button", { name: "Changelog", exact: true }).waitFor();
        await settle(page);
        row.expandedBounds = await footer.getByRole("button").evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(), p = n.closest(".cf-sidebar").getBoundingClientRect(); return { label: n.innerText, right: r.right, sidebarRight: p.right, excess: Math.max(0, r.right - p.right) }; }));
        if (stage === "after") assert.ok(row.expandedBounds.every(b => b.excess <= 1));
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-expanded.png`, animations: "disabled" });
        await footer.getByRole("button", { name: "Status", exact: true }).click(); await page.waitForURL("**/status");
        if (width <= 768) await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
        await footer.getByRole("button", { name: "Changelog", exact: true }).click(); await page.waitForURL("**/changelog");
        if (width <= 768) await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
        await page.getByRole("button", { name: "Club menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Help & documentation", exact: true }).click();
        await page.waitForURL("**/help");
        row.clubNavigationClosesMobile = width > 768 || !await page.locator(".cf-sidebar.mobile-open").count();
        if (stage === "after") assert.ok(row.clubNavigationClosesMobile);
        row.navigation = true;
      } catch (e) { row.error = e.message; }
      finally { await context.close(); }
      console.log(JSON.stringify(row));
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
if (stage === "after") assert.ok(report.cases.every(row => !row.error && row.navigation));
