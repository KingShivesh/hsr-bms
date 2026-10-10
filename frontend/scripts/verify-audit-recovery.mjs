import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const app = process.env.AUDIT_APP_URL || "http://127.0.0.1:5178";
const api = process.env.AUDIT_API_URL || "http://127.0.0.1:8003";
assert.ok([app, api].every(url => ["localhost", "127.0.0.1"].includes(new URL(url).hostname)));
const login = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.ok(login.ok);
const auth = await login.json();
const dir = path.resolve("../docs/full-stack-audit");
const results = [];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ theme, auth }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { theme, auth });
    const page = await context.newPage();
    const pattern = "**/features/sales/SalesPage.jsx*";
    await page.route(pattern, route => route.fulfill({ status: 503, body: "QA chunk unavailable" }));
    await page.goto(app + "/sales");
    await page.getByRole("alert").waitFor();
    assert.ok(await page.locator(".shell").isVisible());
    await page.unroute(pattern);
    await page.getByRole("button", { name: /retry/i }).click();
    await page.waitForFunction(() => document.querySelector(".sales-page") || document.body.innerText.includes("Sales & Billing"));
    assert.equal(await page.getByRole("alert").count(), 0);
    results.push({ theme, shellSurvived: true, retryAfterRestoringNetwork: true });
    await context.close();
  }
  const rows = [];
  for (const theme of ["light", "dark"]) {
    const cells = [];
    for (const stage of ["before", "after"]) {
      const data = await fs.readFile(path.join(dir, stage, `route-crash-${theme}.png`));
      cells.push(`<section><h2>${stage} / ${theme}</h2><img src="data:image/png;base64,${data.toString("base64")}"></section>`);
    }
    rows.push(cells.join(""));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
  await page.setContent(`<html><style>body{margin:0;background:#eee;color:#222;font:18px Arial}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}section{min-width:0}h2{font-size:18px;margin:8px 0}img{width:100%;display:block;border:1px solid #999;box-sizing:border-box}</style><main>${rows.join("")}</main></html>`);
  await page.screenshot({ path: path.join(dir, "route-recovery-comparison.png"), fullPage: true });
} finally { await browser.close(); }
await fs.writeFile(path.join(dir, "route-recovery.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
