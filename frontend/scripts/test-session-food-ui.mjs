import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const stage = process.argv[2] || "after", api = "http://127.0.0.1:8006", app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
const output = process.env.FOOD_UI_OUTPUT || `../docs/deployment-ui-completion/final-completion/session-food/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], blockedWrites: [], scope: "Browser-only menu fixtures and held HTTP 500 food submission; no business write forwarded" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const role of ["admin", "staff"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    for (const theme of ["light", "dark"]) for (const width of [375, 1440]) for (const state of ["empty", "partial", "malformed", "pending", "loading"]) {
      const row = { role, theme, width, state, writes: 0, errors: [] }; report.cases.push(row);
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      let release; const gate = new Promise(resolve => { release = resolve; });
      await context.route("**/*", async handler => {
        const request = handler.request(), url = new URL(request.url());
        if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
        if (url.origin === api && request.method() === "POST" && url.pathname === "/sessions/t1/food") { row.writes++; await gate; return handler.fulfill({ status: 500, json: { detail: "QA food submission failed" } }); }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
        if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        if (url.origin === api && url.pathname === "/settings/menu") {
          if (state === "loading") await gate;
          const valid = { "QA Water": { price: 20, available: true, category: "Beverages" } };
          return handler.fulfill({ json: state === "empty" ? {} : state === "malformed" ? [] : state === "partial" ? { ...valid, "QA Unknown": null, "QA Missing price": { available: true }, "QA Missing stock": { price: 99 } } : valid });
        }
        return handler.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on("pageerror", error => row.errors.push(error.message));
      try {
        await page.goto(app + "/live-floor");
        await page.locator(".lf-table-card").first().getByRole("button", { name: "Food", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Session food · T1", exact: true }); await dialog.waitFor();
        if (state === "loading") await dialog.getByRole("status", { name: "Loading menu", exact: true }).waitFor();
        else if (state === "pending") {
          await dialog.getByRole("button", { name: /QA Water/ }).click();
          await dialog.getByLabel("Quantity", { exact: true }).fill("2");
          const submit = dialog.getByRole("button", { name: "Add Food to Session", exact: true });
          await submit.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaFoodFeedback = { ms: performance.now() - start, pending: node.disabled && node.getAttribute("data-loading") === "true" }; }); }, { once: true }));
          await submit.click(); await page.waitForFunction(() => window.qaFoodFeedback);
          row.feedback = await page.evaluate(() => window.qaFoodFeedback);
          await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${state}-before-dismiss.png`, animations: "disabled" });
          await page.keyboard.press("Escape");
          row.pendingDismissed = !await dialog.isVisible();
          if (stage === "after") { assert.ok(!row.pendingDismissed); assert.ok(row.feedback.pending && row.feedback.ms <= 200); assert.ok(await dialog.getByRole("button", { name: "Close dialog", exact: true }).isDisabled()); }
          if (stage === "before" && row.pendingDismissed) { release(); continue; }
          await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${state}-held.png`, animations: "disabled" });
          release(); await dialog.getByText("Order could not complete", { exact: true }).waitFor();
          row.errorCopy = await dialog.locator(".retry-notice").innerText();
          assert.match(row.errorCopy, /The club server could not complete the request/);
          assert.equal(await dialog.getByLabel("Quantity", { exact: true }).inputValue(), "2"); assert.equal(row.writes, 1);
        } else {
          await page.waitForFunction(() => ![...document.querySelectorAll('.order-skeleton,.ui-skeleton-stack')].some(n => n.getClientRects().length));
          if (stage === "after") {
            if (state === "empty") {
              await dialog.getByRole("button", { name: "Refresh menu", exact: true }).waitFor();
              row.emptyIconWidth = await dialog.locator(".ui-empty-icon svg").evaluate(node => node.getBoundingClientRect().width);
              assert.equal(row.emptyIconWidth, 32);
            }
            if (["partial", "malformed"].includes(state)) assert.ok(await dialog.getByRole("button", { name: "Retry", exact: true }).count());
            if (state === "partial") { await dialog.getByRole("button", { name: /QA Water/ }).waitFor(); assert.equal(await dialog.getByRole("button", { name: /QA Missing/ }).count(), 0); }
          }
        }
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
        row.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
        row.contrast = await scanRenderedContrast(page, { route: "/live-floor", theme, state, minimumContrast: 4.5, includeDisabled: true });
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${state}.png`, animations: "disabled" });
        if (stage === "after") {
          for (const key of ["shortTargets", "smallText", "clipped", "clippedControls", "contentOverflow", "unlabeledButtons", "unlabeledInputs"]) assert.equal(row.metrics[key].length, 0, key);
          assert.equal(row.metrics.overflow, 0); assert.equal(row.contrast.length, 0); assert.equal(row.errors.length, 0);
        }
      } catch (error) { row.error = error.message; await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${state}-failure.png` }).catch(() => {}); }
      finally { release(); await context.close(); console.log(JSON.stringify({ role, theme, width, state, error: row.error })); }
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
if (stage === "after") assert.ok(report.cases.every(row => !row.error));
