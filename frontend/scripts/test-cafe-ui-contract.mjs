import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = process.env.UI_CAFE_OUTPUT_DIR || `../docs/deployment-ui-completion/cafe-contract/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], blockedWrites: [], scope: "Local browser read fixtures; cart changes only, no order/settlement writes. Unrelated aged-session reminders isolated; normal cart notifications dismissed with their real close button before paging" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const username of ["admin", "staff"]) for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: username === "staff" ? "staff123" : "admin123" }) }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push({ method: request.method(), path: url.pathname }); return handler.abort("blockedbyclient"); }
      if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      if (url.origin === api && url.pathname === "/settings/menu") return handler.fulfill({ json: { "QA Cigarette": { price: 20, category: "Cigarettes", available: true }, "QA Snack": { price: 30, category: "Veg Snacks", available: true } } });
      if (stage === "after" && url.origin === api && url.pathname === "/food/orders") return handler.fulfill({ json: Array.from({ length: 1000 }, (_, i) => ({ id: i + 99001, customer_name: `QA Order ${i + 1}`, items: [{ item: "QA Snack", qty: 1 }], payment_method: "Cash", total: 30, ts: 1792264200000 })) });
      if (stage === "after" && url.origin === api && url.pathname === "/food/stats") return handler.fulfill({ json: Array.from({ length: 60 }, (_, i) => ({ name: `QA Item ${i + 1}`, qty: 60 - i, revenue: (60 - i) * 30 })) });
      return handler.continue();
    });
    const page = await context.newPage(), result = { username, theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/cafe-pos");
      const opener = page.getByRole("button", { name: "Add QA Cigarette to order", exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const input = dialog.getByLabel("MRP", { exact: true });
      result.priceFocused = await page.waitForFunction(node => document.activeElement === node, await input.elementHandle(), { timeout: 500 }).then(() => true, () => false);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      result.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      result.contrast = await scanRenderedContrast(page, { route: "/cafe-pos", theme, state: "price", minimumContrast: 4.5, includeDisabled: true });
      await page.screenshot({ path: `${output}/${username}-${theme}-${width}-price.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      result.focusRestored = await page.waitForFunction(node => document.activeElement === node, await opener.elementHandle(), { timeout: 500 }).then(() => true, () => false);
      await opener.click();
      await dialog.getByLabel("MRP", { exact: true }).fill("20");
      await dialog.getByRole("button", { name: "Add Cigarette", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const cart = page.locator(".food-cart-panel");
      await cart.getByRole("button", { name: "Increase QA Cigarette quantity", exact: true }).click();
      result.cartQuantity = await cart.getByRole("spinbutton", { name: "QA Cigarette quantity", exact: true }).inputValue();
      assert.equal(result.cartQuantity, "2");
      result.cartPrice = await cart.locator(".cart-line-meta").innerText();
      assert.match(result.cartPrice, /23.*2/);
      await page.screenshot({ path: `${output}/${username}-${theme}-${width}-cart.png`, animations: "disabled" });
      for (const dismiss of await page.getByRole("button", { name: "Dismiss notification", exact: true }).all()) await dismiss.click();
      if (stage === "after") {
        const m = result.metrics;
        for (const key of ["smallText", "contentOverflow", "shortTargets", "clipped", "unlabeledButtons", "unlabeledInputs", "invalidCopy"]) assert.equal(m[key].length, 0, key);
        assert.equal(m.overflow, 0);
        assert.equal(result.contrast.length, 0, "contrast");
        assert.ok(result.priceFocused && result.focusRestored, "price dialog focus");
        result.pagination = [];
        for (const [tab, label, count] of [["Food Stats", "Food performance", 60], ["Order History", "Order history", 1000]]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          const pagination = page.getByRole("navigation", { name: `${label} pagination`, exact: true });
          await pagination.getByRole("button", { name: "Next page", exact: true }).click();
          const text = await pagination.innerText();
          assert.ok(text.includes(`26-50 of ${count}`));
          assert.equal(await page.locator(".history-section tbody tr").count(), 25);
          result.pagination.push({ tab, count, renderedRows: 25, secondPage: true });
          await page.screenshot({ path: `${output}/${username}-${theme}-${width}-${label.replaceAll(" ", "-")}.png`, animations: "disabled" });
        }
      }
    } catch (error) { result.error = error.message; }
    finally { await context.close(); }
    console.log(JSON.stringify({ username, theme, width, error: result.error, priceFocused: result.priceFocused, focusRestored: result.focusRestored }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
if (stage === "after") { assert.ok(report.cases.every(row => !row.error)); assert.equal(report.blockedWrites.length, 0); }
