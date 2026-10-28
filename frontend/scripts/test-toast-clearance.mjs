import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5183 : 5182}`;
const output = `../docs/deployment-ui-completion/notification-clearance/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], businessWrites: 0, scope: "Same isolated fixture and actual shared Toast/Modal/Button components; frozen baseline source on 5183, current source on 5182. No club mutations." };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [375, 414, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width <= 414 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await context.route("**/*", handler => new URL(handler.request().url()).origin === app ? handler.continue() : handler.fulfill({ json: { status: "ok" } }));
    const page = await context.newPage(), result = { theme, width };
    report.cases.push(result);
    try {
      await page.goto(app + "/login");
      await page.evaluate(async () => { await import("/scripts/toast-clearance-fixture.jsx"); });
      await page.waitForLoadState("networkidle");
      await page.evaluate(async () => { const module = await import("/scripts/toast-clearance-fixture.jsx"); module.mountToastClearanceFixture(); });
      const next = page.getByRole("button", { name: "Next records", exact: true });
      await next.waitFor();
      await page.evaluate(() => {
        window.qaUndoCalls = 0; window.qaWarningDismissCalls = 0;
        window.qaWarning1 = window.qaNotify("QA T1 — one-hour table reminder", "warning", { duration: null, actionLabel: "View", secondaryActionLabel: "Dismiss", onSecondaryAction: () => window.qaWarningDismissCalls++ });
        window.qaWarning2 = window.qaNotify("QA T2 — table needs staff attention", "warning", { duration: null, actionLabel: "View", secondaryActionLabel: "Dismiss" });
        window.qaNotify("QA order change saved", "success", { duration: null, actionLabel: "Undo", onAction: () => window.qaUndoCalls++ });
      });
      await page.getByText("QA order change saved", { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      result.pageAction = await next.evaluate(node => {
        const box = node.getBoundingClientRect(), top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { rect: box.toJSON(), reachable: node === top || node.contains(top), interceptor: top?.closest(".app-toast")?.textContent, clearance: getComputedStyle(document.documentElement).getPropertyValue("--toast-page-clearance") };
      });
      result.stackOverlap = await page.evaluate(() => {
        const feedback = document.querySelector(".app-toast-container:not(.app-session-alert-container)").getBoundingClientRect();
        const warning = document.querySelector(".app-session-alert-container").getBoundingClientRect();
        return Math.max(0, Math.min(feedback.right, warning.right) - Math.max(feedback.left, warning.left)) * Math.max(0, Math.min(feedback.bottom, warning.bottom) - Math.max(feedback.top, warning.top));
      });
      await page.screenshot({ path: `${output}/${theme}-${width}-page.png`, animations: "disabled" });
      result.contrast = await scanRenderedContrast(page, { route: "notification-fixture", theme, state: "stack", minimumContrast: 4.5, includeDisabled: true });
      if (stage === "before") {
        await page.evaluate(() => { window.qaOpenDialog(); window.qaNotify("QA save failed — try again", "error"); });
        await page.getByRole("dialog", { name: "QA recovery", exact: true }).waitFor();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${output}/${theme}-${width}-dialog.png`, animations: "disabled" });
      }
      if (stage === "after") {
        assert.ok(result.pageAction.reachable, "The final page action must remain reachable above persistent notifications");
        assert.equal(result.stackOverlap, 0, "Ordinary feedback and session reminders must not overlap");
        assert.equal(result.contrast.length, 0);
        await next.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaPageFeedback = { ms: performance.now() - start, visible: document.body.innerText.includes("Page 2") }; }); }, { once: true }));
        await next.click();
        await page.waitForFunction(() => window.qaPageFeedback);
        result.feedback = await page.evaluate(() => window.qaPageFeedback);
        assert.ok(result.feedback.visible && result.feedback.ms <= 200);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        assert.equal(await page.evaluate(() => window.qaUndoCalls), 1);
        await page.locator(".app-toast-warning").filter({ hasText: "QA T1" }).getByRole("button", { name: "Dismiss", exact: true }).click();
        assert.equal(await page.evaluate(() => window.qaWarningDismissCalls), 1);
        await page.evaluate(() => window.qaOpenDialog());
        const dialog = page.getByRole("dialog", { name: "QA recovery", exact: true });
        await dialog.waitFor();
        await page.evaluate(() => window.qaNotify("QA save failed — try again", "error"));
        await page.getByText("QA save failed — try again", { exact: true }).waitFor();
        const retry = dialog.getByRole("button", { name: "Retry QA action", exact: true });
        result.dialog = await retry.evaluate(node => {
          const button = node.getBoundingClientRect(), toast = node.closest('[role="dialog"]').querySelector(".app-toast").getBoundingClientRect();
          return { button: button.toJSON(), toast: toast.toJSON(), overlap: Math.max(0, Math.min(button.right, toast.right) - Math.max(button.left, toast.left)) * Math.max(0, Math.min(button.bottom, toast.bottom) - Math.max(button.top, toast.top)) };
        });
        assert.equal(result.dialog.overlap, 0, "Dialog feedback must not cover its recovery action");
        await retry.click(); await dialog.getByText("Attempts 1", { exact: true }).waitFor();
        await page.screenshot({ path: `${output}/${theme}-${width}-dialog.png`, animations: "disabled" });
        await dialog.getByRole("button", { name: "Dismiss notification", exact: true }).click();
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        await page.evaluate(() => window.qaDismiss(window.qaWarning2));
        await page.waitForFunction(() => document.querySelectorAll(".app-toast").length === 0);
        await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--toast-page-clearance")) === 0);
        result.undoCalls = 1; result.warningDismissCalls = 1; result.clearanceResets = true;
      }
    } catch (error) { result.error = error.message; await page.screenshot({ path: `${output}/${theme}-${width}-failure.png` }).catch(() => {}); }
    finally { await context.close(); }
    console.log(JSON.stringify({ theme, width, reachable: result.pageAction?.reachable, feedback: result.feedback, error: result.error }));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.ok(report.cases.every(row => !row.error));
if (stage === "before") assert.ok(report.cases.some(row => !row.pageAction.reachable), "The baseline fixture must reproduce occlusion");
