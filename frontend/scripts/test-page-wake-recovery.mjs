import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const app = "http://127.0.0.1:5189", api = "http://127.0.0.1:8006";
const output = "../docs/daily-use-readiness/phase-1/recovered-pages";
await fs.mkdir(output, { recursive: true });
const response = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(response.status, 200);
const auth = await response.json();
const report = { scope: "Disposable loopback QA backend; 35s intercepted unavailability; no production access", cases: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  await Promise.all(["light", "dark"].flatMap(theme => ["dashboard", "live-floor"].map(async route => {
    const context = await browser.newContext({ viewport: { width: theme === "dark" ? 375 : 1440, height: 900 } });
    await context.addInitScript(({ theme, auth }) => {
      localStorage.setItem("theme", theme);
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { theme, auth });
    const page = await context.newPage();
    const began = Date.now(), dataPath = route === "dashboard" ? "/reports/dashboard" : "/sessions/live-floor";
    const row = { theme, route, failedReads: 0, healthyReads: 0, errors: [] };
    report.cases.push(row);
    page.on("pageerror", error => row.errors.push(error.message));
    await context.route(`${api}/**`, handler => {
      const request = handler.request(), path = new URL(request.url()).pathname;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return handler.abort("blockedbyclient");
      if (path === "/events/stream") return handler.fulfill({ status: 503, json: {} });
      if ((path === "/ready" || path === dataPath) && Date.now() - began < 35000) {
        if (path === dataPath) row.failedReads++;
        return handler.fulfill({ status: 503, json: { detail: "QA server waking" } });
      }
      if (path === dataPath) row.healthyReads++;
      return handler.continue();
    });
    await page.goto(`${app}/${route}`);
    await page.locator(".retry-notice").first().waitFor({ timeout: 15000 });
    row.errorAtMs = Date.now() - began;
    await page.screenshot({ path: `${output}/${route}-${theme}-waiting.png`, fullPage: true });
    await page.locator(route === "live-floor" ? ".lf-table-card" : ".ops-reference-grid").first().waitFor({ timeout: 50000 });
    await page.locator(".retry-notice").first().waitFor({ state: "hidden", timeout: 5000 });
    row.recoveredAtMs = Date.now() - began;
    row.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: `${output}/${route}-${theme}-recovered.png`, fullPage: true });
    assert.ok(row.recoveredAtMs < 42000);
    assert.ok(row.healthyReads >= 1 && row.healthyReads <= 4);
    assert.equal(row.errors.length, 0);
    assert.equal(row.horizontalOverflow, false);
    await context.close();
  })));
} finally {
  await browser.close();
  await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
