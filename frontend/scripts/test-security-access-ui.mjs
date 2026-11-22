import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = process.env.SECURITY_APP_URL || "http://127.0.0.1:5189";
const api = process.env.SECURITY_API_URL || "http://127.0.0.1:8006";
assert.equal(new URL(app).hostname, "127.0.0.1");
assert.equal(new URL(api).hostname, "127.0.0.1");
const output = "../docs/daily-use-readiness/phase-3/browser";
await fs.mkdir(output, { recursive: true });
const report = { stage, scope: "Disposable local QA database only", cases: [], errors: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const role of ["staff", "admin"]) {
    const response = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) });
    assert.equal(response.status, 200);
    const auth = await response.json();
    for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
      await context.addInitScript(({ theme, auth }) => {
        localStorage.setItem("theme", theme);
        for (const key of ["token", "username", "role"]) localStorage.setItem(key, auth[key]);
        window.__hsrCspViolations = [];
        document.addEventListener("securitypolicyviolation", event => window.__hsrCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
      }, { theme, auth });
      await context.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (![app, api].includes(url.origin)) return route.abort("blockedbyclient");
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          report.blockedWrites.push({ method: request.method(), path: url.pathname });
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", error => report.errors.push(error.message));
      const settle = async () => {
        await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      };
      await page.goto(`${app}/daily-closing`);
      const restricted = stage === "after" && role === "staff";
      if (restricted) await page.locator(".lf-table-card").first().waitFor();
      else await page.locator(".closing-page").waitFor();
      await settle();
      const closingLinks = await page.getByRole("button", { name: "Daily Closing", exact: true }).count();
      if (restricted) assert.equal(closingLinks, 0);
      const file = `${stage}-${role}-${theme}-${width}.png`;
      await page.screenshot({ path: `${output}/${file}`, animations: "disabled" });
      const violations = await scanRenderedContrast(page, { theme, route: "/daily-closing", state: stage, minimumContrast: 4.5, includeDisabled: true, viewportOnly: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false);
      assert.equal(violations.length, 0, JSON.stringify(violations));
      const summary = await fetch(`${api}/reports/summary`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json());
      if (restricted) assert.deepEqual(Object.keys(summary).sort(), ["active_tables", "idle_tables", "occupancy", "total_tables"]);
      await page.keyboard.press("Meta+k");
      const search = page.getByPlaceholder("Search actions, pages, reports...");
      await search.fill("daily closing");
      await page.getByRole("listbox", { name: "Command results" }).waitFor();
      const closingCommands = await page.getByRole("option", { name: /daily closing/i }).count();
      if (restricted) assert.equal(closingCommands, 0);
      else assert.ok(closingCommands > 0);
      const cspViolations = await page.evaluate(() => window.__hsrCspViolations);
      assert.deepEqual(cspViolations, []);
      let statsRequests = 0;
      page.on("request", request => { if (new URL(request.url()).pathname === "/food/stats") statsRequests++; });
      await page.goto(`${app}/cafe-pos`);
      await page.locator(".food-order-layout").waitFor();
      await settle();
      await page.getByText("Current Order", { exact: true }).waitFor();
      const statsTabs = await page.getByRole("button", { name: "Food Stats", exact: true }).count();
      if (restricted) {
        assert.equal(statsTabs, 0);
        assert.equal(statsRequests, 0);
      } else assert.ok(statsTabs > 0);
      await page.screenshot({ path: `${output}/${stage}-cafe-${role}-${theme}-${width}.png`, animations: "disabled" });
      const cafeCsp = await page.evaluate(() => window.__hsrCspViolations);
      assert.deepEqual(cafeCsp, []);
      await page.goto(`${app}/legacy-table-controls`);
      await page.locator(".table-control-panel").waitFor();
      await page.locator(".table-control-panel").scrollIntoViewIfNeeded();
      await settle();
      const historyButtons = await page.getByRole("button", { name: /^Open T[1-5] history$/ }).count();
      if (restricted) assert.equal(historyButtons, 0);
      else assert.ok(historyButtons > 0);
      await page.screenshot({ path: `${output}/${stage}-tables-${role}-${theme}-${width}.png`, animations: "disabled" });
      const historyCsp = await page.evaluate(() => window.__hsrCspViolations);
      assert.deepEqual(historyCsp, []);
      report.cases.push({ role, theme, width, file, closingLinks, closingCommands, summaryFields: Object.keys(summary).sort(), overflow, contrastViolations: violations.length, cspViolations, statsTabs, statsRequests, cafeCsp, historyButtons, historyCsp });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.blockedWrites, []);
} finally {
  await browser.close();
  await fs.writeFile(`${output}/${stage}.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors.length, blockedWrites: report.blockedWrites.length }));
