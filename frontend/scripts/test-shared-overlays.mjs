import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
const api = "http://127.0.0.1:8006";
const output = process.env.UI_OVERLAY_OUTPUT || `../docs/deployment-ui-completion/shared-overlays/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, scope: "Local QA only; every business write blocked; logout browser-mocked", cases: [], blockedWrites: [] };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
try {
  for (const role of (process.env.UI_OVERLAY_ROLES || "admin,staff").split(",")) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: role, password: role === "admin" ? "admin123" : "staff123" }) }).then(r => r.json());
    assert.ok(auth.token);
    for (const theme of (process.env.UI_OVERLAY_THEMES || "light,dark").split(",")) for (const width of (process.env.UI_OVERLAY_WIDTHS || "375,768,1024,1440").split(",").map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
      await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
      const row = { role, theme, width, menus: [], logoutRequests: 0, errors: [] };
      report.cases.push(row);
      await context.route("**/*", handler => {
        const request = handler.request(), url = new URL(request.url());
        if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
        if (url.origin === api && url.pathname === "/auth/logout" && request.method() === "POST") { row.logoutRequests++; return handler.fulfill({ json: { ok: true } }); }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
        if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
        return handler.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", error => row.errors.push(error.message));
      try {
        await page.goto(app + "/help");
        await page.locator(".topbar-title").waitFor();
        await settle(page);
        for (const label of ["Help", "User menu", "Club menu"]) {
          const trigger = page.getByRole("button", { name: label, exact: true });
          await trigger.focus();
          await trigger.press("ArrowDown");
          await page.waitForTimeout(60);
          const menu = page.getByRole("menu", { name: label, exact: true });
          const result = { label, arrowOpens: await menu.count() > 0 };
          row.menus.push(result);
          if (!result.arrowOpens) await trigger.click();
          await menu.waitFor();
          await settle(page);
          result.items = await menu.getByRole("menuitem").allTextContents();
          result.initialFocus = await menu.getByRole("menuitem").first().evaluate(node => node === document.activeElement);
          await page.keyboard.press("End");
          result.end = await menu.getByRole("menuitem").last().evaluate(node => node === document.activeElement);
          await page.keyboard.press("ArrowDown");
          result.wrap = await menu.getByRole("menuitem").first().evaluate(node => node === document.activeElement);
          await page.keyboard.press("Home");
          result.home = await menu.getByRole("menuitem").first().evaluate(node => node === document.activeElement);
          result.contrast = await scanRenderedContrast(page, { route: "/help", theme, state: label, minimumContrast: 4.5, includeDisabled: true });
          result.bounds = await menu.evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewport: innerHeight }; });
          await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${label.replaceAll(" ", "-")}.png`, animations: "disabled" });
          await page.keyboard.press("Escape");
          await menu.waitFor({ state: "hidden" });
          result.escapeFocus = await trigger.evaluate(node => node === document.activeElement);
          await trigger.evaluate(node => { delete window.qaMenuFeedback; node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaMenuFeedback = { ms: performance.now() - start, expanded: node.getAttribute("aria-expanded") === "true" }; }); }, { once: true }); });
          await trigger.click(); await menu.waitFor();
          await page.waitForFunction(() => window.qaMenuFeedback);
          result.feedback = await page.evaluate(() => window.qaMenuFeedback);
          await page.keyboard.press("Tab"); await menu.waitFor({ state: "hidden" });
          result.tabLeaves = true;
          await trigger.focus(); await trigger.press("ArrowUp"); await page.waitForTimeout(40);
          result.upOpensLast = await menu.count() > 0 && await menu.getByRole("menuitem").last().evaluate(node => node === document.activeElement);
          if (await menu.count()) { await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" }); }
          await trigger.click(); await menu.waitFor();
          await page.mouse.click(0, 0); await menu.waitFor({ state: "hidden" });
          result.outsideCloses = true;
          if (width === 375) {
            await page.setViewportSize({ width, height: 320 });
            await trigger.click(); await menu.waitFor(); await settle(page);
            result.shortViewport = await menu.evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; });
            await page.screenshot({ path: `${output}/${role}-${theme}-${width}-${label.replaceAll(" ", "-")}-short.png`, animations: "disabled" });
            await page.setViewportSize({ width, height: 844 }); await menu.waitFor({ state: "hidden" });
            result.resizeCloses = true;
          }
          if (label === "Club menu") assert.equal(result.items.some(text => /Team access/.test(text)), role === "admin");
          if (label === "Help") {
            await trigger.click();
            assert.match(await menu.getByRole("menuitem", { name: "Contact support" }).getAttribute("href"), /^mailto:shivanshg2510@gmail\.com/);
            await menu.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
            const child = page.getByRole("dialog");
            await child.waitFor(); await settle(page);
            result.childDialogFocus = await child.evaluate(node => node.contains(document.activeElement));
            await page.keyboard.press("Escape"); await child.waitFor({ state: "hidden" }); await settle(page);
            result.childRestoresFocus = await trigger.evaluate(node => node === document.activeElement);
          }
          if (stage === "after") {
            for (const key of ["arrowOpens", "initialFocus", "end", "wrap", "home", "escapeFocus", "tabLeaves", "upOpensLast", "outsideCloses"]) assert.equal(result[key], true, `${label} ${key}`);
            assert.ok(result.feedback.expanded && result.feedback.ms <= 200);
            if (result.shortViewport) assert.ok(result.shortViewport.top >= 0 && result.shortViewport.bottom <= result.shortViewport.height);
            if (label === "Help") assert.ok(result.childDialogFocus && result.childRestoresFocus);
            assert.equal(result.contrast.length, 0);
            assert.ok(result.bounds.left >= 0 && result.bounds.right <= width && result.bounds.top >= 0 && result.bounds.bottom <= result.bounds.viewport);
          }
        }
        await page.goto(app + "/live-floor");
        const end = page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true });
        await end.click();
        const drawer = page.locator(".checkout-panel");
        await drawer.getByText("Payment method", { exact: true }).waitFor();
        await drawer.getByRole("button", { name: "Adjust Time", exact: true }).click();
        const started = drawer.getByLabel("Started at", { exact: true });
        const earlier = await started.evaluate(node => new Date(node.valueAsNumber - 60000).toISOString().slice(0, 19));
        await started.fill(earlier);
        const close = drawer.getByRole("button", { name: "Close panel", exact: true });
        await close.click();
        const nested = page.getByRole("dialog", { name: "Discard checkout edits?", exact: true });
        await nested.waitFor(); await settle(page);
        row.nestedFocus = await nested.evaluate(node => node.contains(document.activeElement));
        row.nestedIsTop = await nested.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-nested.png`, animations: "disabled" });
        await page.keyboard.press("Escape"); await nested.waitFor({ state: "hidden" }); await settle(page);
        row.nestedRestoresFocus = await close.evaluate(node => node === document.activeElement);
        assert.ok(await drawer.isVisible());
        assert.equal(await started.inputValue(), earlier);
        await close.click(); await nested.waitFor();
        await nested.getByRole("button", { name: "Discard edits", exact: true }).click();
        await drawer.waitFor({ state: "hidden" }); await settle(page);
        row.discardRestoresFocus = await end.evaluate(node => node === document.activeElement);
        if (stage === "after") assert.ok(row.nestedFocus && row.nestedIsTop && row.nestedRestoresFocus && row.discardRestoresFocus);
        await page.goto(app + "/help"); await page.locator(".topbar-title").waitFor(); await settle(page);
        const user = page.getByRole("button", { name: "User menu", exact: true });
        const openConfirm = async () => {
          row.confirmOpening = (row.confirmOpening || 0) + 1;
          await user.click();
          await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
          await page.getByRole("dialog", { name: "Log out?", exact: true }).waitFor(); await settle(page);
        };
        await openConfirm();
        const dialog = page.getByRole("dialog", { name: "Log out?", exact: true });
        row.cancelInitiallyFocused = await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(node => node === document.activeElement);
        for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab"); assert.ok(await dialog.evaluate(node => node.contains(document.activeElement))); }
        row.dialogMetrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
        row.dialogContrast = await scanRenderedContrast(page, { route: "/help", theme, state: "confirm", minimumContrast: 4.5, includeDisabled: true });
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-confirm.png`, animations: "disabled" });
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await settle(page);
        row.cancelRestoresFocus = await user.evaluate(node => node === document.activeElement);
        assert.equal(row.logoutRequests, 0);
        await openConfirm(); await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await settle(page);
        assert.equal(row.logoutRequests, 0);
        await openConfirm(); await page.mouse.click(2, 2); await dialog.waitFor({ state: "hidden" }); await settle(page);
        assert.equal(row.logoutRequests, 0);
        if (stage === "after") { await openConfirm(); await dialog.getByRole("button", { name: "Close dialog", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await settle(page); assert.equal(row.logoutRequests, 0); }
        await openConfirm(); await dialog.getByRole("button", { name: "Log out", exact: true }).click();
        await page.waitForURL("**/login"); assert.equal(row.logoutRequests, 1);
        if (stage === "after") {
          assert.ok(row.cancelInitiallyFocused && row.cancelRestoresFocus);
          assert.equal(row.dialogContrast.length, 0);
          for (const key of ["shortTargets", "smallText", "clipped", "clippedControls", "contentOverflow"]) assert.equal(row.dialogMetrics[key].length, 0, key);
          assert.equal(row.errors.length, 0);
        }
      } catch (error) {
        row.error = error.message;
        row.failureDom = await page.evaluate(() => ({ path: location.pathname, buttons: [...document.querySelectorAll("button")].filter(node => node.getClientRects().length).map(node => ({ label: node.getAttribute("aria-label"), text: node.textContent, hidden: !!node.closest('[inert],[aria-hidden="true"]'), disabled: node.disabled })), dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({ title: node.getAttribute("aria-labelledby"), hidden: !!node.closest('[inert],[aria-hidden="true"]') })) })).catch(() => null);
        await page.screenshot({ path: `${output}/${role}-${theme}-${width}-failure.png`, animations: "disabled" }).catch(() => {});
      }
      finally { await context.close(); }
      console.log(JSON.stringify({ role, theme, width, error: row.error, arrowOpens: row.menus.map(m => m.arrowOpens) }));
    }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.equal(report.blockedWrites.length, 0);
assert.ok(report.cases.every(row => !row.error));
