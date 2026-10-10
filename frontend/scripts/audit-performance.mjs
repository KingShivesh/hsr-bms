import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const app = process.env.AUDIT_APP_URL || "http://127.0.0.1:5178";
const api = process.env.AUDIT_API_URL || "http://127.0.0.1:8003";
assert.ok([app, api].every(url => ["localhost", "127.0.0.1"].includes(new URL(url).hostname)));
const toolRoot = process.env.AUDIT_TOOLS_ROOT || "/tmp/hsr-audit-tools/node_modules";
const { default: lighthouse } = await import(pathToFileURL(toolRoot + "/lighthouse/core/index.js"));
const { launch } = await import(pathToFileURL(toolRoot + "/chrome-launcher/dist/index.js"));
const login = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.ok(login.ok);
const auth = await login.json();
const chrome = await launch({ chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", chromeFlags: ["--headless", "--no-first-run"] });
let browser;
const results = [];
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const page = await browser.contexts()[0].newPage();
  await page.goto(app + "/login");
  await page.evaluate(auth => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, auth);
  for (const route of ["/dashboard", "/live-floor", "/sales"]) {
    const { lhr } = await lighthouse(app + route, { port: chrome.port, onlyCategories: ["performance"], disableStorageReset: true, preset: "desktop", logLevel: "error" });
    assert.equal(new URL(lhr.finalDisplayedUrl).pathname, route, "Must measure authenticated page, not login");
    results.push({ route, score: lhr.categories.performance.score, lcpMilliseconds: lhr.audits["largest-contentful-paint"].numericValue, cls: lhr.audits["cumulative-layout-shift"].numericValue, totalBlockingTimeMilliseconds: lhr.audits["total-blocking-time"].numericValue, runtimeError: lhr.runtimeError || null });
  }
} finally { await browser?.close(); await chrome.kill(); }
const report = { environment: "local production build, disposable SQLite API; Lighthouse desktop lab, NOT field or Render cold-start performance", inp: "Not measured: navigation Lighthouse reports TBT, not field INP/FID", results };
await fs.writeFile("../docs/full-stack-audit/performance.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
