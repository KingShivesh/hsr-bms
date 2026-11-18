import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
const app = process.env.FINAL_DIALOG_APP_URL || `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
assert.equal(new URL(app).hostname, "127.0.0.1");
const output = process.env.FINAL_DIALOG_OUTPUT || `../docs/deployment-ui-completion/final-completion/dialogs/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, scope: "Guarded local QA; reset is browser-mocked pending then 500; no business writes", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
try {
  for (const role of ["admin", "staff"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
      const row = { role, theme, width, errors: [], samples: [], resets: 0 };
      report.cases.push(row);
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      let readFailure = false, historyMode = "empty", release, releaseHistory;
      const historyGate = new Promise(resolve => { releaseHistory = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      await context.route("**/*", async handler => {
        const request = handler.request(), url = new URL(request.url());
        if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
        if (url.origin === api && url.pathname.includes("reset") && !["GET", "OPTIONS"].includes(request.method())) {
          row.resets++; await pending; return handler.fulfill({ status: 500, json: { detail: "QA reset failed safely" } });
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
        if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        if (url.origin === api && /\/sessions\/(history|audit)\//.test(url.pathname)) {
          if (historyMode === "loading") await historyGate;
          if (readFailure) return handler.fulfill({ status: 500, json: { detail: "QA history read failed" } });
          if (historyMode === "malformed") return handler.fulfill({ json: { unexpected: true } });
          if (historyMode === "partial") return handler.fulfill({ json: [null, { id: 99001, date: {}, nm: {}, dur: null, tot: null, payment_method: null, action: {}, detail: {}, amount: null }] });
          const rows = historyMode === "populated" ? Array.from({ length: 60 }, (_, i) => ({ id: 99001 + i, date: "06/11/2026", nm: `QA Session ${i + 1}`, dur: 60, tot: 320, payment_method: "Cash", action: "qa_read_fixture", detail: `QA audit ${i + 1}`, amount: 0 })) : [];
          return handler.fulfill({ json: rows });
        }
        return handler.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on("pageerror", error => row.errors.push(error.message));
      const capture = async name => {
        await settle(page);
        const metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
        const contrast = await scanRenderedContrast(page, { route: page.url(), theme, state: name, minimumContrast: 4.5, includeDisabled: true });
        row.samples.push({ name, metrics, contrast });
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${name}.png`, animations: "disabled" });
        if (stage === "after") {
          assert.equal(metrics.overflow, 0);
          for (const key of ["shortTargets", "smallText", "clipped", "clippedControls", "contentOverflow", "invalidCopy", "unlabeledButtons", "unlabeledInputs"]) assert.equal(metrics[key].length, 0, `${name}: ${key}`);
          assert.equal(contrast.length, 0, `${name}: contrast`);
        }
      };
      try {
        await page.goto(app + "/help"); await page.locator(".topbar-title").waitFor();
        const opener = page.getByRole("button", { name: "Help", exact: true }); await opener.focus();
        await page.keyboard.press("Meta+k");
        const commands = page.getByRole("dialog", { name: "Command palette", exact: true });
        await commands.waitFor();
        const input = commands.getByRole("textbox", { name: "Search commands", exact: true });
        await page.waitForFunction(() => ![...document.querySelectorAll('.ui-skeleton-stack')].some(n => n.getClientRects().length));
        await capture("commands");
        assert.ok(await input.evaluate(node => node === document.activeElement));
        if (stage === "after") {
          await page.keyboard.press("Meta+k"); await settle(page);
          row.repeatedShortcutKeepsLoaded = await commands.locator(".ui-skeleton-stack").count() === 0;
          assert.ok(row.repeatedShortcutKeepsLoaded);
        }
        await input.fill("zz-no-matching-command"); await capture("commands-empty");
        await commands.getByRole("button", { name: "Clear search", exact: true }).click();
        await input.press("Shift+Tab"); assert.ok(await commands.evaluate(node => node.contains(document.activeElement)));
        await page.keyboard.press("Escape"); await commands.waitFor({ state: "hidden" }); await settle(page);
        assert.ok(await opener.evaluate(node => node === document.activeElement));
        await page.keyboard.press("Meta+k"); await commands.waitFor(); await input.fill("Cafe POS");
        await input.press("ArrowDown"); await input.press("ArrowUp"); await input.press("Enter");
        await page.waitForURL("**/cafe-pos");
        await page.goto(app + "/legacy-table-controls");
        const history = page.getByRole("button", { name: "Open T1 history", exact: true });
        await history.click();
        const dialog = page.getByRole("dialog", { name: "Table 1 history", exact: true });
        await dialog.waitFor(); await page.getByText("No sessions yet", { exact: true }).waitFor();
        await capture("history-empty");
        await page.keyboard.press("Tab"); assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await settle(page);
        assert.ok(await history.evaluate(node => node === document.activeElement));
        if (stage === "after") {
          historyMode = "loading"; await history.click(); await dialog.waitFor();
          await dialog.getByRole("status", { name: "Fetching table history", exact: true }).waitFor();
          await capture("history-loading"); historyMode = "populated"; releaseHistory();
          await dialog.getByRole("cell", { name: "QA Session 1", exact: true }).waitFor();
          const sessionsPager = dialog.getByRole("navigation", { name: "Sessions pagination", exact: true });
          await sessionsPager.getByRole("button", { name: "Next page", exact: true }).click();
          await dialog.getByRole("cell", { name: "QA Session 26", exact: true }).waitFor();
          assert.equal(await dialog.locator("tbody").first().locator("tr").count(), 25);
          assert.match(await sessionsPager.innerText(), /26-50 of 60/);
          const tableRegion = dialog.getByRole("region", { name: "Last sessions table", exact: true });
          await tableRegion.evaluate(node => { node.scrollTop = 300; });
          row.stickyHeader = await tableRegion.evaluate(node => ({ regionTop: node.getBoundingClientRect().top, headerTop: node.querySelector("th").getBoundingClientRect().top, viewportHeight: node.clientHeight, contentHeight: node.scrollHeight }));
          assert.ok(Math.abs(row.stickyHeader.headerTop - row.stickyHeader.regionTop) <= 2);
          assert.ok(row.stickyHeader.contentHeight > row.stickyHeader.viewportHeight);
          await tableRegion.evaluate(node => { node.scrollTop = 0; });
          if (width === 375) {
            await tableRegion.focus(); await tableRegion.press("ArrowRight");
            await page.waitForFunction(node => node.scrollLeft > 0, await tableRegion.elementHandle());
            await page.waitForTimeout(250);
            row.keyboardTableScroll = await tableRegion.evaluate(node => ({ viewportWidth: node.clientWidth, contentWidth: node.scrollWidth, scrollLeft: node.scrollLeft }));
          }
          await tableRegion.evaluate(node => { node.scrollTo({ left: 0, top: 0, behavior: "instant" }); node.closest(".ui-overlay-body").scrollTop = 0; });
          await capture("history-populated"); row.historyPagination = true;
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
          historyMode = "partial"; await history.click(); await dialog.waitFor();
          await page.waitForFunction(() => !document.querySelector('.table-history-dialog .ui-skeleton-stack'));
          assert.equal(await dialog.locator("tbody").first().locator("tr").count(), 1);
          assert.equal(await dialog.locator("tbody").first().innerText(), "-\t-\t-\t-\t-");
          await capture("history-partial"); row.missingValuesNotInvented = true;
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
          historyMode = "malformed"; await history.click(); await dialog.waitFor();
          await dialog.getByRole("button", { name: "Retry", exact: true }).first().waitFor();
          await capture("history-malformed");
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        } else {
          historyMode = "populated"; await history.click(); await dialog.waitFor();
          await dialog.getByRole("cell", { name: "QA Session 1", exact: true }).waitFor();
          await capture("history-populated");
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        }
        readFailure = true; await history.click(); await dialog.waitFor();
        await page.waitForFunction(() => ![...document.querySelectorAll('.ui-skeleton-stack')].some(n => n.getClientRects().length));
        await capture("history-error");
        if (stage === "after") assert.ok(await dialog.getByRole("button", { name: "Retry", exact: true }).count());
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await settle(page);
        await page.getByTestId("reset-t1").click();
        const reset = page.getByRole("dialog", { name: /Reset (T1|t1)/ });
        await reset.waitFor(); await capture("reset");
        const pin = reset.getByLabel("Manager PIN, if required"); await pin.fill("2468");
        const submit = reset.getByRole("button", { name: "Reset Table", exact: true });
        await submit.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaFinalFeedback = { ms: performance.now() - start, disabled: node.disabled }; }); }, { once: true }));
        await submit.click(); await page.waitForFunction(() => window.qaFinalFeedback);
        row.feedback = await page.evaluate(() => window.qaFinalFeedback);
        await page.keyboard.press("Escape");
        assert.ok(await reset.isVisible());
        await capture("reset-pending");
        release(); await page.getByText("QA reset failed safely", { exact: true }).waitFor();
        await capture("reset-failed");
        assert.equal(await pin.inputValue(), "2468"); assert.equal(row.resets, 1);
        await page.keyboard.press("Escape"); await reset.waitFor({ state: "hidden" });
        if (stage === "after") { assert.ok(row.feedback.disabled && row.feedback.ms <= 200); assert.equal(row.errors.length, 0); }
      } catch (error) { row.error = error.message; await page.screenshot({ path: `${output}/${role}-${theme}-${width}-failure.png` }).catch(() => {}); }
      finally { release(); releaseHistory(); await context.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
      console.log(JSON.stringify({ role, theme, width, error: row.error }));
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
if (stage === "after") assert.ok(report.cases.every(row => !row.error));
