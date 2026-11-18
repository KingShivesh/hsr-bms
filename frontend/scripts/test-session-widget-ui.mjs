import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const stage = process.argv[2] || "after";
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5182}`, api = `http://127.0.0.1:${stage === "before" ? 8006 : 8007}`;
const output = process.env.WIDGET_OUTPUT || `../docs/deployment-ui-completion/final-completion/session-widget/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, scope: "Read-only frame/idle fixtures; one browser-mocked failed frame request per case; no business writes forwarded", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const role of ["admin", "staff"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    const templateFloor = await fetch("http://127.0.0.1:8006/sessions/live-floor", { headers: { Authorization: `Bearer ${auth.token}` } }).then(r => r.json());
    const template = templateFloor.tables.find(table => table.session).session;
    for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
      const row = { role, theme, width, writes: 0, errors: [], samples: [] }; report.cases.push(row);
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      let release; const pending = new Promise(resolve => { release = resolve; });
      await context.route("**/*", async handler => {
        const request = handler.request(), url = new URL(request.url());
        if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
        if (request.method() === "POST" && url.origin === api && /\/frames\//.test(url.pathname)) { row.writes++; await pending; return handler.fulfill({ status: 500, json: { detail: "QA frame failure" } }); }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
        if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        if (url.origin === api && url.pathname === "/sessions/live-floor") {
          const data = structuredClone(templateFloor);
          const started = Date.now() - 3600000;
          const tables = data.tables.map((table, i) => i === 0 ? { ...table, status_key: "running", status_label: "Running", elapsed_seconds: 3600, running_total: 100, session: { ...template, table_id: table.id, session_key: "qa-frame-widget", customer_name: "QA Frame Guest", paused: false, elapsed_seconds: 3600, session_started_at: started, start_time: started, tariff_mode: "frame", tariff_price: 100, billing_mode: "single", play_estimate: 100, running_total: 100, food_items: [], food_total: 0, frames: [{ id: 99001, frame_no: 1, status: "open" }] } } : { ...table, session: null, status_key: "available", status_label: "Available", running_total: 0 });
          return handler.fulfill({ json: { ...data, tables, ...(data.floor ? { floor: { ...data.floor, tables } } : {}) } });
        }
        return handler.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on("pageerror", error => row.errors.push(error.message));
      const sample = async name => {
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
        const contrast = await scanRenderedContrast(page, { route: "/live-floor", theme, state: name, minimumContrast: 4.5, includeDisabled: true });
        row.samples.push({ name, metrics, contrast });
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${name}.png`, animations: "disabled" });
        if (stage === "after") { for (const key of ["shortTargets", "smallText", "clipped", "clippedControls", "contentOverflow", "unlabeledButtons", "unlabeledInputs"]) assert.equal(metrics[key].length, 0, key); assert.equal(metrics.overflow, 0); assert.equal(contrast.length, 0); }
      };
      try {
        await page.goto(app + "/live-floor");
        const first = page.locator(".lf-table-card").first(); await first.waitFor(); await first.focus(); await first.press("Enter");
        const drawer = page.getByRole("dialog", { name: "Session details · T1", exact: true }); await drawer.waitFor();
        await drawer.getByText("Frame 1 in progress", { exact: true }).waitFor(); await sample("frame");
        if (stage === "after") {
          const overview = drawer.getByRole("tab", { name: "overview", exact: true });
          await overview.focus(); await overview.press("End"); assert.equal(await drawer.getByRole("tab", { name: "activity", exact: true }).getAttribute("aria-selected"), "true");
          await page.keyboard.press("Home"); assert.equal(await overview.getAttribute("aria-selected"), "true");
          await page.keyboard.press("ArrowRight"); assert.equal(await drawer.getByRole("tab", { name: "orders", exact: true }).getAttribute("aria-selected"), "true");
          await page.keyboard.press("ArrowLeft"); assert.equal(await overview.getAttribute("aria-selected"), "true"); row.keyboardTabs = true;
        }
        await drawer.getByRole("button", { name: "Complete Frame", exact: true }).click();
        await page.keyboard.press("Tab"); release();
        await page.getByText("QA frame failure", { exact: true }).waitFor();
        await drawer.getByText("Frame 1 in progress", { exact: true }).waitFor(); assert.equal(row.writes, 1);
        await sample("frame-error"); await page.keyboard.press("Escape"); await drawer.waitFor({ state: "hidden" });
        const idle = page.locator(".lf-table-card").nth(2); await idle.focus(); await idle.press("Enter");
        await page.getByRole("dialog", { name: "Session details · T3", exact: true }).waitFor(); await sample("idle");
        if (stage === "after") assert.equal(row.errors.length, 0);
      } catch (error) { row.error = error.message; await page.screenshot({ path: `${output}/${role}-${theme}-${width}-failure.png` }).catch(() => {}); }
      finally { release(); await context.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
      console.log(JSON.stringify({ role, theme, width, error: row.error }));
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
if (stage === "after") assert.ok(report.cases.every(row => !row.error));
