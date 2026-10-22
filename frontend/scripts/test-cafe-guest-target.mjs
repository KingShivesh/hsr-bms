import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = `../docs/deployment-ui-completion/cafe-guest-target/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], mockedWrites: [], blockedWrites: [], scope: "Guarded local anonymous sessions; food POST is browser-mocked as HTTP 500, never persisted" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const username of ["admin", "staff"]) for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: username === "staff" ? "staff123" : "admin123" }) }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (stage === "after" && request.method() === "POST" && url.pathname === "/sessions/t1/food") {
        report.mockedWrites.push({ username, theme, width, payload: request.postDataJSON() });
        await gate;
        return handler.fulfill({ status: 500, json: { detail: "QA simulated food failure" } });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      if (url.origin === api && url.pathname === "/settings/menu") return handler.fulfill({ json: { "QA Snack": { price: 30, category: "Veg Snacks", available: true } } });
      return handler.continue();
    });
    const page = await context.newPage(), result = { username, theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/cafe-pos");
      await page.getByRole("button", { name: "Add QA Snack to order", exact: true }).click();
      await page.getByText("Add to running table", { exact: true }).click();
      assert.ok(await page.getByRole("checkbox", { name: /^Add to running table/ }).isChecked());
      await page.getByRole("combobox", { name: "Order table", exact: true }).selectOption("t1");
      const submit = page.getByRole("button", { name: /^Add to table bill/ });
      result.submitDisabled = await submit.isDisabled();
      result.playerOptions = await page.getByRole("combobox", { name: "Order player", exact: true }).locator("option").count();
      for (const dismiss of await page.getByRole("button", { name: "Dismiss notification", exact: true }).all()) await dismiss.click();
      await page.screenshot({ path: `${output}/${username}-${theme}-${width}-guest.png`, animations: "disabled", fullPage: true });
      result.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      result.contrast = await scanRenderedContrast(page, { route: "/cafe-pos", theme, state: "guest-target", minimumContrast: 4.5, includeDisabled: true });
      if (stage === "after") {
        for (const key of ["smallText", "contentOverflow", "shortTargets", "clipped", "unlabeledButtons", "unlabeledInputs", "invalidCopy"]) assert.equal(result.metrics[key].length, 0, key);
        assert.equal(result.metrics.overflow, 0);
        assert.equal(result.contrast.length, 0, "contrast");
        assert.equal(result.submitDisabled, false, "Anonymous session must accept food without a name");
        assert.equal(result.playerOptions, 0, "No unusable player dropdown");
        await submit.evaluate(node => node.addEventListener("click", () => {
          const start = performance.now();
          requestAnimationFrame(() => { window.qaFoodFeedback = { ms: performance.now() - start, pending: node.disabled && node.getAttribute("data-loading") === "true" }; });
        }, { once: true }));
        await submit.click();
        await page.waitForFunction(() => window.qaFoodFeedback);
        result.pendingFeedback = await page.evaluate(() => window.qaFoodFeedback);
        assert.ok(result.pendingFeedback.pending && result.pendingFeedback.ms <= 200);
        await page.screenshot({ path: `${output}/${username}-${theme}-${width}-pending.png`, animations: "disabled" });
        release();
        await page.getByText("QA simulated food failure", { exact: true }).waitFor();
        result.cartRetainedAfterFailure = await page.locator(".cart-line-name").textContent() === "QA Snack";
        assert.ok(result.cartRetainedAfterFailure);
        assert.equal(await page.locator(".success-callout").count(), 0, "No optimistic financial success");
        const writes = report.mockedWrites.filter(row => row.username === username && row.theme === theme && row.width === width);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].payload.player_name, "", "No invented Guest identity sent");
        assert.ok(writes[0].payload.session_key, "Existing session identity guards against stale table submissions");
      } else assert.equal(result.submitDisabled, true);
    } catch (error) { result.error = error.message; }
    finally { release(); await context.close(); }
    console.log(JSON.stringify({ username, theme, width, submitDisabled: result.submitDisabled, error: result.error, pendingFeedback: result.pendingFeedback, cartRetainedAfterFailure: result.cartRetainedAfterFailure }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.ok(report.cases.every(row => !row.error));
assert.equal(report.blockedWrites.length, 0);
