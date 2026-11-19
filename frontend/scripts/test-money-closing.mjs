import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = "http://127.0.0.1:5189", api = "http://127.0.0.1:8006";
const output = "../docs/daily-use-readiness/phase-2/browser";
await fs.mkdir(output, { recursive: true });
const response = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(response.status, 200);
const auth = await response.json();
const result = { stage, scope: "Disposable local database only", captures: [], errors: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => {
      localStorage.setItem("theme", theme);
      for (const key of ["token", "username", "role"]) localStorage.setItem(key, auth[key]);
    }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => result.errors.push(error.message));
    await page.goto(`${app}/daily-closing`);
    await page.locator(".closing-page").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = `${stage}-${theme}-${width}.png`;
    await page.screenshot({ path: `${output}/${file}`, fullPage: true, animations: "disabled" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const violations = await scanRenderedContrast(page, { theme, route: "/daily-closing", state: stage, minimumContrast: 4.5, includeDisabled: true, viewportOnly: true });
    const cashColumnWidth = await page.locator(".closing-payment-audit > div").first().evaluate(node => Math.round(node.getBoundingClientRect().width));
    result.captures.push({ theme, width, file, overflow, violations, cashColumnWidth });
    assert.equal(overflow, false);
    assert.equal(violations.length, 0, JSON.stringify(violations));
    if (stage === "after") {
      await page.getByLabel("Business date").waitFor();
      await page.getByText("Ledger reconciled", { exact: true }).waitFor();
      await page.getByLabel("Business date").fill("2026-01-01");
      await page.getByRole("button", { name: "Load date", exact: true }).click();
      await page.getByText("01/01/2026", { exact: true }).waitFor();
      assert.ok(cashColumnWidth >= 140);
      const fixture = await fetch(`${api}/reports/closing-report`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json());
      fixture.date = "01/01/2026";
      fixture.day_close = { closed: false };
      fixture.can_close_day = true;
      fixture.reconciliation = { ok: true, transactions_checked: 1, counter_orders_checked: 0, credit_total: 0,
        errors: [], warnings: [{ code: "missing_payment", resource: "transaction", id: 1, message: "Receipt has no payment-ledger coverage." }], legacy_review_required: true };
      await page.route(`${api}/reports/closing-report*`, route => route.fulfill({ json: fixture }));
      await page.getByRole("button", { name: "Load date", exact: true }).click();
      const acknowledgement = page.getByRole("checkbox", { name: "I reviewed the legacy payment-ledger warnings" });
      await acknowledgement.waitFor();
      assert.equal(await page.getByRole("button", { name: "Close Day", exact: true }).isEnabled(), false);
      await page.getByText("I reviewed the legacy payment-ledger warnings", { exact: true }).click();
      assert.equal(await acknowledgement.isChecked(), true);
      assert.equal(await page.getByRole("button", { name: "Close Day", exact: true }).isEnabled(), true);
      await page.screenshot({ path: `${output}/legacy-review-${theme}-${width}.png`, fullPage: true });
      fixture.can_close_day = false;
      fixture.reconciliation.ok = false;
      fixture.reconciliation.errors = [{ code: "payment_mismatch", resource: "transaction", id: 1, message: "Payment ledger does not match its receipt." }];
      await page.getByRole("button", { name: "Load date", exact: true }).click();
      await page.getByRole("button", { name: "Review Ledger", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Review Ledger", exact: true }).isEnabled(), false);
      result.captures.at(-1).legacyReviewAndMismatchBlocked = true;
    }
    await context.close();
  }
  if (stage === "after") {
    const context = await browser.newContext();
    await context.addInitScript(auth => {
      for (const key of ["token", "username", "role"]) localStorage.setItem(key, auth[key]);
    }, auth);
    const page = await context.newPage();
    await page.goto(`${app}/daily-closing`);
    await page.locator(".closing-page").waitFor();
    const keys = [];
    await page.route(`${api}/food/order`, async route => {
      keys.push(route.request().headers()["idempotency-key"]);
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      await route.abort("connectionreset");
    });
    const lost = await page.evaluate(async () => {
      const api = await import("/src/api/index.js");
      try { await api.placeFoodOrder("QA Money Browser", [{ item: "QA Water", qty: 1 }]); return false; }
      catch { return true; }
    });
    assert.equal(lost, true);
    await page.unroute(`${api}/food/order`);
    await page.reload();
    await page.locator(".closing-page").waitFor();
    await page.route(`${api}/food/order`, route => {
      keys.push(route.request().headers()["idempotency-key"]);
      return route.continue();
    });
    const replay = await page.evaluate(async () => {
      const api = await import("/src/api/index.js");
      return (await api.placeFoodOrder("QA Money Browser", [{ item: "QA Water", qty: 1 }])).data;
    });
    assert.equal(replay.idempotent, true);
    assert.equal(keys[0], keys[1]);
    const orders = await fetch(`${api}/food/orders`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json());
    assert.equal(orders.filter(row => row.customer_name === "QA Money Browser").length, 1);
    result.lostResponseReload = { committedOrders: 1, sameRequestKey: true, replayed: true };
    await page.reload();
    await page.locator(".closing-page").waitFor();
    await page.getByText("Ledger reconciled", { exact: true }).waitFor();
    await page.locator(".closing-cash-grid input").nth(1).fill("20");
    const closeRequest = page.waitForRequest(request => request.url().endsWith("/reports/day-close"));
    await page.getByRole("button", { name: "Close Day", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close Day", exact: true }).click();
    const submitted = (await closeRequest).postDataJSON();
    assert.match(submitted.business_date, /^\d{2}\/\d{2}\/\d{4}$/);
    await page.getByRole("button", { name: "Day Closed", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Day Closed", exact: true }).waitFor();
    result.realClose = { dateBound: true, persistedAfterReload: true, countedCash: submitted.counted_cash };
    await context.close();
  }
  assert.deepEqual(result.errors, []);
} finally {
  await browser.close();
  await fs.writeFile(`${output}/${stage}.json`, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
