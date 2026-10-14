import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const directory = path.resolve("../docs/session-food-credit/comparison");
await fs.mkdir(directory, { recursive: true });
const auth = await fetch("http://127.0.0.1:8006/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) }).then(r => r.json());
assert.ok(auth.token);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const files = [];
try {
  for (const theme of ["light", "dark"]) for (const stage of ["before", "after"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: theme, timezoneId: "Asia/Kolkata" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${stage === "before" ? 5180 : 5181}/live-floor`);
    const card = page.locator(".lf-table-card").first();
    await card.waitFor(); await page.evaluate(() => document.fonts.ready);
    await card.screenshot({ path: path.join(directory, `card-${theme}-${stage}.png`), animations: "disabled" });
    await card.getByRole("button", { name: "End", exact: true }).click();
    await page.getByText("Payment method", { exact: true }).waitFor();
    await page.locator(".checkout-payment-grid").screenshot({ path: path.join(directory, `payment-${theme}-${stage}.png`), animations: "disabled" });
    files.push({ theme, stage, origin: stage === "before" ? "ca1ee07 exact frontend snapshot / same current QA floor payload" : "feature frontend / same QA floor payload", orders: "2 Cold Drink, 1 Samosa, 120 rupees" });
    await context.close();
  }
  const cards = await Promise.all(["light", "dark"].flatMap(theme => ["before", "after"].map(async stage => ({ theme, stage, card: (await fs.readFile(path.join(directory, `card-${theme}-${stage}.png`))).toString("base64"), payment: (await fs.readFile(path.join(directory, `payment-${theme}-${stage}.png`))).toString("base64") }))));
  const html = `<!doctype html><html><meta charset="utf-8"><title>Session fixes: actual before and after</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#f4f4f5;color:#18181b;font:14px Arial,sans-serif}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 20px}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}section{min-width:0}h2{font-size:16px;margin:0 0 12px}img{display:block;width:100%;height:auto}h3{font-size:14px;margin:20px 0 8px}</style><h1>Session orders and checkout</h1><p>Actual browser captures. Same canteen fixture, unchanged palette and fonts. Before frontend: ca1ee07.</p><main>${cards.map(row => `<section><h2>${row.theme} / ${row.stage}</h2><img src="data:image/png;base64,${row.card}" alt="${row.theme} ${row.stage} table card"><h3>Payment choices</h3><img src="data:image/png;base64,${row.payment}" alt="${row.theme} ${row.stage} payments"></section>`).join("")}</main></html>`;
  await fs.writeFile(path.join(directory, "comparison.html"), html);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.setContent(html); await page.screenshot({ path: path.join(directory, "comparison.png"), fullPage: true });
  await fs.writeFile(path.join(directory, "sources.json"), JSON.stringify(files, null, 2));
} finally { await browser.close(); }
console.log("Saved same-data light/dark before/after card and payment comparison.");
