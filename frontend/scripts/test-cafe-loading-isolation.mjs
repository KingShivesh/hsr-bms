import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const output = "../docs/deployment-ui-completion/cafe-loading-isolation";
await fs.mkdir(output, { recursive: true });
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) }).then(r => r.json());
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { scope: "Local Staff read-only: hold history and stats independently while menu and floor REST remain available", cases: [], blockedWrites: [] };
try {
  for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    let releaseStats, releaseHistory;
    const statsGate = new Promise(resolve => { releaseStats = resolve; }), historyGate = new Promise(resolve => { releaseHistory = resolve; });
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin !== api) return handler.continue();
      if (url.pathname === "/settings/menu") return handler.fulfill({ json: { "QA Snack": { price: 30, category: "Veg Snacks", available: true } } });
      if (url.pathname === "/food/stats") { await statsGate; return handler.fulfill({ json: [{ name: "QA Snack", qty: 1, revenue: 30 }] }); }
      if (url.pathname === "/food/orders") { await historyGate; return handler.fulfill({ json: [{ id: 99001, customer_name: "QA Read Fixture", items: [], payment_method: "Cash", total: 30 }] }); }
      return handler.continue();
    });
    const page = await context.newPage(), result = { theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/cafe-pos");
      await page.getByRole("button", { name: "Add QA Snack to order", exact: true }).waitFor({ timeout: 5000 });
      result.counterReadyWhileBothHeld = true;
      await page.getByRole("button", { name: "Food Stats", exact: true }).click();
      await page.getByRole("status", { name: "Loading food performance", exact: true }).waitFor();
      result.statsHasOwnSkeleton = true;
      await page.getByRole("button", { name: "Order History", exact: true }).click();
      await page.getByRole("status", { name: "Loading order history", exact: true }).waitFor();
      result.historyHasOwnSkeleton = true;
      await page.screenshot({ path: `${output}/${theme}-${width}-history-held.png`, animations: "disabled" });
      releaseStats();
      await page.getByRole("button", { name: "Food Stats", exact: true }).click();
      await page.getByRole("cell", { name: "QA Snack", exact: true }).waitFor();
      result.statsReadyWhileHistoryHeld = true;
      await page.getByRole("button", { name: "Order History", exact: true }).click();
      assert.ok(await page.getByRole("status", { name: "Loading order history", exact: true }).isVisible());
      releaseHistory();
      await page.getByRole("cell", { name: "QA Read Fixture", exact: true }).waitFor();
      result.historyRecovered = true;
    } catch (error) { result.error = error.message; }
    finally { releaseStats(); releaseHistory(); await context.close(); }
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.ok(report.cases.every(row => !row.error));
assert.equal(report.blockedWrites.length, 0);
