import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { formatCurrency, formatDuration, formatDateTime } from "../src/utils/format.js";

assert.equal(formatCurrency(1200000), "₹12,00,000");
assert.equal(formatCurrency(1200.5), "₹1,200.5");
assert.equal(formatDuration(2723), "45:23");
assert.equal(formatDuration(3661), "01:01:01");
assert.equal(formatDateTime(null), "-");
const app = process.env.POLISH_APP_URL || "http://127.0.0.1:5177";
const api = process.env.POLISH_API_URL || "http://127.0.0.1:8003";
for (const url of [app, api]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const auth = await (await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) })).json();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { controls: [], loading: [], errors: [], apiMutations: 0 };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    await page.goto(app + "/settings");
    const save = page.getByRole("button", { name: "Save Table Rates", exact: true });
    await save.waitFor();
    await page.route("**/settings/rates", async route => {
      if (route.request().method() === "GET") return route.continue();
      await new Promise(resolve => setTimeout(resolve, 700));
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    const before = await save.boundingBox();
    await save.evaluate(button => button.addEventListener("click", () => {
      const start = performance.now();
      const observer = new MutationObserver(() => { if (button.getAttribute("aria-busy") === "true") { window.feedbackMs = performance.now() - start; observer.disconnect(); } });
      observer.observe(button, { attributes: true });
    }, { capture: true, once: true }));
    await save.click();
    await page.locator('button[aria-busy="true"]').waitFor({ timeout: 200 });
    const feedbackMs = await page.evaluate(() => window.feedbackMs);
    const loading = await save.boundingBox();
    const spinnerColor = await save.locator(".ui-button-spinner").evaluate(node => getComputedStyle(node).color);
    assert.ok(feedbackMs < 100);
    assert.ok(Math.abs(before.width - loading.width) < 1);
    assert.ok(await save.isDisabled());
    await page.screenshot({ path: `../docs/presentation-polish/after/settings-saving-${theme}.png` });
    await page.getByText("Rates saved", { exact: true }).first().waitFor();
    await page.getByLabel(theme === "dark" ? "Switch to light mode" : "Switch to dark mode").hover();
    await page.waitForTimeout(450);
    const tooltip = await page.getByLabel(theme === "dark" ? "Switch to light mode" : "Switch to dark mode").evaluate(button => ({ text: getComputedStyle(button, "::after").content, visible: getComputedStyle(button, "::after").opacity }));
    assert.ok(Number(tooltip.visible) > 0.99);
    report.controls.push({ theme, feedbackMs, widthBefore: before.width, widthLoading: loading.width, spinnerColor, tooltip });

    for (const route of ["/dashboard", "/bookings", "/customers", "/sales", "/cafe-pos", "/inventory", "/settings"]) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(api + "/**", async handler => {
        if (handler.request().method() === "GET" && !/\/(auth|health|ready|events)/.test(handler.request().url().slice(api.length))) await gate;
        await handler.continue();
      });
      await page.goto(app + route);
      const skeleton = page.locator(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton").first();
      await skeleton.waitFor({ timeout: 5000 });
      report.loading.push({ theme, route, skeletonVisible: true });
      release();
      await page.unroute(api + "/**");
      await skeleton.waitFor({ state: "hidden" });
    }
    await page.route("**/settings/rates", handler => handler.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA connection interrupted" }) }));
    await page.goto(app + "/settings");
    await page.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save Table Rates" }).count(), 0);
    await page.screenshot({ path: `../docs/presentation-polish/after/settings-error-${theme}.png` });
    report.errors.push({ theme, failedSettingsDoNotShowEditableDefaults: true, retryVisible: true });
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile("../docs/presentation-polish/controls.json", JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
