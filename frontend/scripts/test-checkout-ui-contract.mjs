import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const output = "../docs/deployment-ui-completion/checkout/contract";
await fs.mkdir(output, { recursive: true });
const report = { cases: [], errors: [], blockedBusinessWrites: [], readOnlyPreviews: 0, scope: "Disposable local QA only; POST checkout-preview is read-only; settlement and every other write blocked" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const username of ["staff", "admin"]) for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
    const response = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: username === "staff" ? "staff123" : "admin123" }) });
    assert.equal(response.status, 200);
    const auth = await response.json();
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, timezoneId: "Asia/Kolkata" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return route.abort("blockedbyclient");
      if (request.method() === "POST" && url.pathname.startsWith("/sessions/checkout-preview/")) {
        report.readOnlyPreviews++;
        await new Promise(resolve => setTimeout(resolve, 400));
        return route.continue();
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.blockedBusinessWrites.push({ method: request.method(), path: url.pathname });
        return route.fulfill({ status: 409, json: { detail: "QA forbids business writes" } });
      }
      if (url.pathname === "/sessions/alerts") return route.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    page.setDefaultTimeout(15000);
    const result = { username, theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/live-floor");
      const end = page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true });
      await end.click();
      const drawer = page.locator(".checkout-panel");
      await drawer.getByText("Payment method", { exact: true }).waitFor();
      const choices = drawer.locator(".checkout-payment-grid button");
      const sizes = await choices.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
      assert.equal(sizes.length, 3);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) < 1);
      result.equalPaymentWidths = sizes;
      const toggle = drawer.getByRole("button", { name: "Adjust Time", exact: true });
      await toggle.click();
      await page.waitForTimeout(200);
      const chevron = await toggle.locator(".ui-disclosure-chevron").evaluate(node => {
        const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform);
        return { transform: style.transform, duration: style.transitionDuration, coefficients: [matrix.a, matrix.b, matrix.c, matrix.d] };
      });
      assert.ok(chevron.coefficients.every((value, index) => Math.abs(value - [-1, 0, 0, -1][index]) < 0.0001));
      assert.equal(chevron.duration, "0.15s");
      result.chevron = chevron;
      const reason = drawer.getByLabel("Time adjustment reason", { exact: true });
      await reason.focus();
      await page.keyboard.press("s");
      await page.keyboard.press("Enter");
      assert.equal(await reason.inputValue(), "staff_forgot_to_start");
      const started = drawer.getByLabel("Started at", { exact: true });
      const earlier = await started.evaluate(node => new Date(node.valueAsNumber - 60000).toISOString().slice(0, 19));
      await started.fill(earlier);
      const apply = drawer.getByRole("button", { name: "Apply Change", exact: true });
      assert.ok(await apply.isEnabled());
      const preview = page.waitForResponse(r => r.url().includes("/sessions/checkout-preview/") && r.request().method() === "POST");
      await apply.click();
      await drawer.getByRole("status", { name: "Recalculating bill", exact: true }).waitFor({ timeout: 200 });
      const applied = await preview;
      assert.equal(applied.status(), 200, await applied.text());
      await drawer.getByRole("status", { name: "Recalculating bill", exact: true }).waitFor({ state: "hidden" });
      await drawer.getByText("Duration adjusted", { exact: true }).waitFor();
      result.keyboardSelectAndReadOnlyApply = true;
      result.keyboardSelectionMethod = "Native select type-ahead + Enter; native popup arrow automation also fails on a bare select in this Chrome build and is not certified by this test";
      await page.screenshot({ path: `${output}/${username}-${theme}-${width}-time-preview.png`, animations: "disabled" });
      const resetPreview = page.waitForResponse(r => r.url().includes("/sessions/checkout-preview/") && r.request().method() === "POST");
      await drawer.getByRole("button", { name: "Reset", exact: true }).click();
      assert.equal((await resetPreview).status(), 200);
      await drawer.getByRole("status", { name: "Recalculating bill", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await reason.inputValue(), "");
      const first = drawer.getByRole("button", { name: "Close panel", exact: true });
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      assert.ok(await drawer.evaluate(node => node.contains(document.activeElement)));
      await page.keyboard.press("Tab");
      assert.ok(await first.evaluate(node => node === document.activeElement));
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
      result.resetFocusTrapEscape = true;
      result.focusRestored = await end.evaluate(node => node === document.activeElement);
      assert.ok(result.focusRestored);
    } catch (error) { result.error = error.message; await page.screenshot({ path: `${output}/${username}-${theme}-${width}-failure.png` }).catch(() => {}); }
    finally { await context.close(); }
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.errors.length, 0);
assert.equal(report.blockedBusinessWrites.length, 0);
assert.ok(report.cases.every(row => !row.error));
