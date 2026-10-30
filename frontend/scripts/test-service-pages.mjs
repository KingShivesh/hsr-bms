import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = process.env.UI_SERVICE_OUTPUT || `../docs/deployment-ui-completion/service-contract/${stage}`;
await fs.mkdir(output, { recursive: true });
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(response => response.json());
assert.ok(auth.token);
const cases = [
  ["status-unknown", "/status"], ["peak-unknown", "/pricing-rules"],
  ["audit-critical", "/audit-log"], ["audit-partial", "/audit-log"], ["audit-malformed", "/audit-log"],
  ["gst-save", "/pricing-rules"], ["peak-save", "/pricing-rules"], ["help-guide", "/help"], ["demo", "/demo"],
];
const report = { stage, scope: "Isolated local QA; read fixtures and browser-mocked held HTTP 500 saves; no backend business writes", cases: [], writes: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const [name, route] of cases.filter(([name]) => !process.env.UI_SERVICE_CASES || process.env.UI_SERVICE_CASES.split(",").includes(name))) for (const theme of ["light", "dark"]) for (const width of name.endsWith("save") || ["help-guide", "demo"].includes(name) ? [375, 768, 1024, 1440] : [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const result = { name, route, theme, width, errors: [] };
    report.cases.push(result);
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      const save = { "gst-save": "/operations/gst", "peak-save": "/operations/peak-hours", "help-guide": "/product/setup" }[name];
      if (request.method() === (name === "help-guide" ? "PATCH" : "POST") && url.origin === api && url.pathname === save) {
        report.writes.push({ name, theme, width, path: save, payload: request.postDataJSON() });
        await gate;
        return handler.fulfill({ status: 500, json: { detail: "QA held service save failed" } });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin !== api) return handler.continue();
      if (url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      if (name === "status-unknown" && url.pathname === "/ready") return handler.fulfill({ json: {} });
      if (name === "peak-unknown" && url.pathname === "/operations/current-rate") return handler.fulfill({ json: { is_peak: null, multiplier: null, label: null } });
      if (url.pathname === "/operations/audit-logs" && name.startsWith("audit-")) {
        const row = { id: 99001, date: "30 Oct 2026", ts: Date.now(), staff: "QA Actor", action: "qa_read_fixture", detail: "Read-only fixture", severity: "critical", amount: 0 };
        return handler.fulfill({ json: name === "audit-critical" ? [row] : name === "audit-partial" ? [null, { ...row, staff: null, severity: null }] : {} });
      }
      return handler.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => result.errors.push(error.message));
    try {
      await page.goto(app + route);
      await page.locator(".topbar-title").waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid")].some(node => node.getClientRects().length));
      await page.evaluate(() => document.fonts.ready);
      if (name === "status-unknown") {
        result.readyClaim = await page.getByText("Ready", { exact: true }).count() > 0;
        if (stage === "after") assert.equal(result.readyClaim, false, "HTTP 200 without readiness data is not Ready");
      } else if (name === "peak-unknown") {
        result.standardClaim = await page.getByText("Standard rate currently active", { exact: true }).count() > 0;
        if (stage === "after") { assert.equal(result.standardClaim, false); assert.ok(await page.getByRole("button", { name: "Retry", exact: true }).count()); }
      } else if (name.startsWith("audit-")) {
        result.values = await page.locator(".cf-stat").evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.querySelector("span")?.textContent, node.querySelector("strong")?.textContent])));
        if (stage === "after" && name === "audit-critical") { assert.equal(result.values["Risk Actions"], "1"); assert.equal(await page.locator(".cf-row.warning").count(), 1); }
        if (stage === "after" && name === "audit-partial") { assert.equal(result.values["Risk Actions"], "—"); assert.equal(result.values["Staff/System Actors"], "—"); await page.getByText("Unknown actor", { exact: true }).waitFor(); }
        if (stage === "after" && name === "audit-malformed") { assert.ok(await page.getByRole("button", { name: "Retry", exact: true }).count()); assert.equal(await page.getByText("No staff activity yet", { exact: true }).count(), 0); }
      } else if (name === "demo") {
        await page.getByRole("button", { name: "Load sample data", exact: true }).click();
        assert.equal(await page.locator(".ui-data-table tbody tr").count(), 5);
        await page.getByRole("button", { name: "Close sample session", exact: true }).first().click();
        assert.match(await page.locator(".ui-data-table tbody tr").first().innerText(), /Available/);
        for (const [label, count] of [["Members", 10], ["Bookings", 3], ["Cafe orders", 2]]) {
          await page.getByRole("tab", { name: label, exact: true }).click();
          assert.equal(await page.locator(".ui-data-table tbody tr").count(), count);
        }
        await page.getByRole("tab", { name: "Cafe orders", exact: true }).press("Home");
        assert.equal(await page.getByRole("tab", { name: "Tables", exact: true }).getAttribute("aria-selected"), "true");
        await page.getByRole("button", { name: "Reset sample data", exact: true }).click();
        assert.match(await page.locator(".ui-data-table tbody tr").first().innerText(), /Running/);
        await page.screenshot({ path: `${output}/${name}-${theme}-${width}-populated.png`, animations: "disabled" });
        await page.getByRole("button", { name: "Delete sample data", exact: true }).click();
        await page.getByRole("button", { name: "Load sample data", exact: true }).waitFor();
        result.sampleLifecycle = true;
      } else {
        if (name === "gst-save") await page.getByRole("button", { name: "Tax / GST", exact: true }).click();
        const submit = page.getByRole("button", { name: { "gst-save": "Save GST", "peak-save": "Add Peak Rule", "help-guide": "Mark first-shift guide reviewed" }[name], exact: true });
        await submit.waitFor();
        if (name === "gst-save") {
          const field = page.getByLabel("GST Percentage", { exact: true });
          result.gstMaximum = await field.getAttribute("max");
          if (stage === "after") {
            assert.equal(result.gstMaximum, "28");
            await field.fill("29"); await submit.click();
            await page.getByText("Enter a GST percentage from 0 to 28.", { exact: true }).waitFor();
            assert.equal(report.writes.filter(row => row.name === name && row.theme === theme && row.width === width).length, 0);
          }
          await field.fill("7.5");
        }
        if (name === "peak-save" && stage === "after") {
          await page.getByLabel("Start Hour", { exact: true }).fill("24"); await submit.click();
          await page.getByText(/Enter hours from 0/).waitFor();
          assert.equal(report.writes.filter(row => row.name === name && row.theme === theme && row.width === width).length, 0);
          await page.getByLabel("Start Hour", { exact: true }).fill("18");
        }
        await submit.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaServiceFeedback = { ms: performance.now() - start, pending: node.disabled && node.getAttribute("data-loading") === "true" }; }); }, { once: true }));
        await submit.click(); await page.waitForFunction(() => window.qaServiceFeedback);
        result.pendingFeedback = await page.evaluate(() => window.qaServiceFeedback);
        if (stage === "after") assert.ok(result.pendingFeedback.pending && result.pendingFeedback.ms <= 200);
        await page.screenshot({ path: `${output}/${name}-${theme}-${width}-pending.png`, animations: "disabled" });
        release();
        await page.waitForFunction(node => !node.disabled, await submit.elementHandle());
        assert.equal(report.writes.filter(row => row.name === name && row.theme === theme && row.width === width).length, 1);
        if (name === "gst-save") { result.preservedGst = await page.getByLabel("GST Percentage", { exact: true }).inputValue(); assert.equal(result.preservedGst, "7.5"); }
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        result.hoverContrast = await scanRenderedContrast(page, { route, theme, state: `${name}-hover`, minimumContrast: 4.5, includeDisabled: true });
        if (stage === "after") assert.equal(result.hoverContrast.length, 0, "settled post-save hover contrast");
        if (name === "help-guide") {
          await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
          const dialog = page.getByRole("dialog"); await dialog.getByRole("heading", { name: "Keyboard shortcuts", exact: true }).waitFor();
          await page.keyboard.press("Tab"); assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
          result.shortcuts = true;
        }
      }
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      result.metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
      result.contrast = await scanRenderedContrast(page, { route, theme, state: name, minimumContrast: 4.5, includeDisabled: true });
      await page.screenshot({ path: `${output}/${name}-${theme}-${width}.png`, animations: "disabled", fullPage: true });
      if (stage === "after") {
        for (const key of ["shortTargets", "clipped", "clippedControls", "smallText", "contentOverflow", "invalidCopy", "unlabeledButtons", "unlabeledInputs"]) assert.equal(result.metrics[key].length, 0, key);
        assert.equal(result.metrics.overflow, 0); assert.equal(result.metrics.applicationCrashed, false);
        assert.equal(result.contrast.length, 0); assert.equal(result.errors.length, 0);
      }
    } catch (error) { result.error = error.message; await page.screenshot({ path: `${output}/${name}-${theme}-${width}-failure.png`, animations: "disabled" }).catch(() => {}); }
    finally { release(); await context.close(); }
    console.log(JSON.stringify({ name, theme, width, error: result.error, feedback: result.pendingFeedback }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
if (stage === "after") assert.ok(report.cases.every(row => !row.error));
