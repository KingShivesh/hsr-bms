import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = process.env.UI_DIALOG_OUTPUT_DIR || `../docs/deployment-ui-completion/member-booking-dialogs/${stage}`;
await fs.mkdir(output, { recursive: true });
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
const report = { stage, cases: [], blockedWrites: [], mockedBookingWrites: 0, scope: "Local dialogs; booking submission is browser-mocked pending then HTTP 500. No business writes reach backend" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const route of ["customers", "bookings"]) for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    let releaseBooking;
    const bookingGate = new Promise(resolve => { releaseBooking = resolve; });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (stage === "after" && route === "bookings" && request.method() === "POST" && /^\/bookings\/?$/.test(url.pathname)) {
        report.mockedBookingWrites += 1;
        await bookingGate;
        return handler.fulfill({ status: 500, json: { detail: "QA simulated booking failure" } });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push({ method: request.method(), path: url.pathname }); return handler.abort("blockedbyclient"); }
      return handler.continue();
    });
    const page = await context.newPage(), result = { route, theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/" + route);
      const opener = route === "customers" ? page.locator(".op2-customer-card").first() : page.getByRole("button", { name: "New booking", exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      await page.mouse.move(0, 0);
      result.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      result.contrast = await scanRenderedContrast(page, { route, theme, state: "dialog", minimumContrast: 4.5, includeDisabled: true });
      await page.screenshot({ path: `${output}/${route}-${theme}-${width}.png`, animations: "disabled" });
      if (stage === "after" && route === "bookings") {
        const submit = dialog.getByRole("button", { name: "Create booking", exact: true });
        assert.ok(await submit.evaluate(node => node.classList.contains("ui-button-primary")), "primary action stays primary");
        await dialog.getByLabel("Customer name", { exact: true }).fill("QA blocked booking submission");
        await submit.evaluate(node => node.addEventListener("click", () => {
          const start = performance.now();
          requestAnimationFrame(() => { window.qaBookingFeedback = { ms: performance.now() - start, pending: node.disabled && node.getAttribute("data-loading") === "true" }; });
        }, { once: true }));
        await submit.click();
        await page.waitForFunction(() => window.qaBookingFeedback);
        result.pendingFeedback = await page.evaluate(() => window.qaBookingFeedback);
        assert.ok(result.pendingFeedback.pending && result.pendingFeedback.ms <= 200, "immediate pending feedback");
        result.closeDisabledWhileSaving = await dialog.getByRole("button", { name: "Close dialog", exact: true }).isDisabled();
        assert.ok(result.closeDisabledWhileSaving);
        await page.keyboard.press("Escape");
        assert.ok(await dialog.isVisible(), "pending submission cannot dismiss");
        await page.screenshot({ path: `${output}/${route}-${theme}-${width}-pending.png`, animations: "disabled" });
        releaseBooking();
        await dialog.locator('[role="alert"]').waitFor();
        result.errorPreservesInput = await dialog.getByLabel("Customer name", { exact: true }).inputValue() === "QA blocked booking submission";
        assert.ok(result.errorPreservesInput);
        assert.equal(await submit.isDisabled(), false);
        await page.screenshot({ path: `${output}/${route}-${theme}-${width}-error.png`, animations: "disabled" });
      }
      await page.keyboard.press("Tab");
      result.tabTrapped = await dialog.evaluate(node => node.contains(document.activeElement));
      await page.keyboard.press("Shift+Tab");
      result.reverseTabTrapped = await dialog.evaluate(node => node.contains(document.activeElement));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      result.escaped = true;
      result.focusRestored = await page.waitForFunction(node => document.activeElement === node, await opener.elementHandle(), { timeout: 500 }).then(() => true, () => false);
      if (stage === "after") {
        const m = result.metrics;
        assert.equal(m.applicationCrashed, false);
        for (const key of ["smallText", "contentOverflow", "shortTargets", "clipped", "unlabeledButtons", "unlabeledInputs", "invalidCopy"]) assert.equal(m[key].length, 0, key);
        assert.equal(m.overflow, 0);
        assert.equal(result.contrast.length, 0, "contrast");
        assert.ok(result.tabTrapped && result.reverseTabTrapped && result.escaped && result.focusRestored, "dialog keyboard contract");
      }
    } catch (error) { result.error = error.message; }
    finally { releaseBooking(); await context.close(); }
    console.log(JSON.stringify({ route, theme, width, error: result.error, contrast: result.contrast?.length, focusRestored: result.focusRestored }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
if (stage === "after") { assert.ok(report.cases.every(row => !row.error)); assert.equal(report.blockedWrites.length, 0); }
