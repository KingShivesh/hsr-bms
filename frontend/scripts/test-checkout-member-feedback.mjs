import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const app = "http://127.0.0.1:5182", api = "http://127.0.0.1:8006";
const output = "../docs/deployment-ui-completion/final-completion/closure-20261118/member-feedback";
await fs.mkdir(output, { recursive: true });
const report = { scope: "Local-only checkout member-search feedback; no business write forwarded; no settlement-success claim", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const role of ["admin", "staff"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    for (const theme of ["light", "dark"]) for (const width of [375, 1440]) for (const route of ["/", "/live-floor"]) {
      const row = { role, theme, width, route }; report.cases.push(row);
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      await context.route("**/*", handler => {
        const r = handler.request(), u = new URL(r.url());
        if (![app, api].includes(u.origin)) return handler.abort("blockedbyclient");
        if (!["GET", "HEAD", "OPTIONS"].includes(r.method())) { report.blockedWrites.push(u.pathname); return handler.abort("blockedbyclient"); }
        if (u.origin === api && u.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        return handler.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      try {
        await page.goto(app + route);
        await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
        const checkout = page.locator(".checkout-panel");
        const button = checkout.getByRole("button", { name: "Search LP Member", exact: true });
        await button.waitFor();
        await button.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { const input = node.closest(".checkout-section").querySelector("input"); window.qaMemberFeedback = { ms: performance.now() - start, pressed: node.getAttribute("aria-pressed") === "true", inputVisible: !!input?.getClientRects().length }; }); }, { once: true }));
        await button.click(); await page.waitForFunction(() => window.qaMemberFeedback);
        row.feedback = await page.evaluate(() => window.qaMemberFeedback);
        await checkout.getByLabel("Search by phone or name", { exact: true }).waitFor();
        assert.ok(row.feedback.ms <= 200 && row.feedback.pressed && row.feedback.inputVisible);
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${route === "/" ? "root" : "floor"}.png`, animations: "disabled" });
      } catch (e) { row.error = e.message; }
      finally { await context.close(); }
      console.log(JSON.stringify(row));
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
assert.ok(report.cases.every(row => !row.error));
