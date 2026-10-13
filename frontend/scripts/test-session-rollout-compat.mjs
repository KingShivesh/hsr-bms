import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "staff", password: "staff123" }) });
assert.equal(response.status, 200);
const auth = await response.json();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { checks: [], actualBusinessWrites: 0, errors: [] };
try {
  for (const theme of ["light", "dark"]) for (const method of ["UPI", "Split"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route(api + "/sessions/quote/**", async route => {
      const response = await route.fetch(); const data = await response.json();
      for (const key of ["can_edit_time", "can_discount", "rate", "original_rate", "rate_delta", "time_edit", "pin_required"]) delete data[key];
      await route.fulfill({ response, json: data });
    });
    await page.route(api + "/sessions/checkout-preview/**", () => { throw new Error("New preview must not be called against an old response"); });
    let captured;
    await page.route(api + "/sessions/stop/**", async route => {
      captured = new URL(route.request().url()).searchParams;
      assert.equal(captured.get("payment_method"), method);
      assert.ok(captured.get("session_key")); assert.ok(captured.get("checkout_token_value"));
      if (method === "Split") assert.equal(JSON.parse(captured.get("payment_split_json")).length, 2);
      await route.fulfill({ json: { tbl: "T1", tot: 245, payment_method: method, nm: null } });
    });
    await page.goto(app + "/live-floor");
    await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Payment method", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("Adjust Time", { exact: true }).count(), 0);
    assert.equal(await dialog.getByText("Customer (optional)", { exact: true }).count(), 0);
    await dialog.getByRole("button", { name: method, exact: true }).click();
    await page.waitForTimeout(200);
    if (method === "Split") {
      const quoteResponse = await fetch(api + "/sessions/quote/t1", { headers: { Authorization: `Bearer ${auth.token}` } }).then(response => response.json());
      await dialog.getByLabel("Cash amount", { exact: true }).fill("100");
      await dialog.getByLabel("UPI amount", { exact: true }).fill(String(quoteResponse.tot - 100));
    }
    await dialog.getByRole("button", { name: /^Close table/ }).click();
    await dialog.getByRole("heading", { name: "Payment Complete" }).waitFor();
    assert.ok(captured);
    report.checks.push({ theme, method, legacyFrozenCheckout: true, identityHidden: true, preservedPayment: true });
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile("../docs/session-close-controls/rollout-compatibility.json", JSON.stringify(report, null, 2)); }
assert.equal(report.errors.length, 0);
console.log(JSON.stringify(report));
