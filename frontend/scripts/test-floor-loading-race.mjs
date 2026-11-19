import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = "http://127.0.0.1:5189", api = "http://127.0.0.1:8006";
const output = `../docs/daily-use-readiness/phase-1/loading-race/${stage}`;
await fs.mkdir(output, { recursive: true });
const response = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(response.status, 200);
const auth = await response.json(), report = { stage, scope: "Disposable loopback QA backend; held read plus concurrent refresh", cases: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript(({ theme, auth }) => {
      localStorage.setItem("theme", theme);
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { theme, auth });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await context.route(`${api}/sessions/live-floor`, async route => { await gate; await route.continue(); });
    await context.route(`${api}/events/stream**`, route => route.fulfill({ status: 503, json: {} }));
    const page = await context.newPage();
    await page.goto(`${app}/live-floor`);
    await page.locator(".lf-skeleton").waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("hsr:data-changed", { detail: { reason: "QA-concurrent-refresh" } })));
    await page.waitForTimeout(300);
    release();
    await page.waitForResponse(response => new URL(response.url()).pathname === "/sessions/live-floor");
    await page.waitForTimeout(600);
    const row = { theme, skeletons: await page.locator(".lf-skeleton").count(), cards: await page.locator(".lf-table-card").count() };
    report.cases.push(row);
    await page.screenshot({ path: `${output}/${theme}.png`, fullPage: true });
    if (stage === "after") { assert.equal(row.skeletons, 0); assert.equal(row.cards, 5); }
    else { assert.equal(row.skeletons, 1); assert.equal(row.cards, 0); }
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
