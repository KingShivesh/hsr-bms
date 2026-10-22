import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { scanTextContrast } from "./contrast-dom.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = process.env.PILOT_APP_URL || "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
assert.equal(new URL(app).hostname, "127.0.0.1");
const output = `../docs/pilot-ui-gate/${stage}`;
await fs.mkdir(output, { recursive: true });
const auth = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(async response => { assert.equal(response.status, 200); return response.json(); });
const report = { stage, minimumContrast: 4.5, includeDisabled: true, cases: [], violations: [], errors: [], businessWrites: [], scope: "Local seeded database; browser member reads are controlled fixtures; credential submission intercepted; no business writes forwarded" };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const guard = await browser.newPage();
  await guard.setContent('<body style="background:white"><h1 style="color:#888;font:32px Arial">Large threshold fixture</h1><button disabled style="background:white;color:#888;opacity:.5;font:32px Arial">Disabled threshold fixture</button></body>');
  const standard = await scanRenderedContrast(guard, { state: "scanner-guard" });
  const strict = await scanRenderedContrast(guard, { state: "scanner-guard", minimumContrast: 4.5, includeDisabled: true });
  report.scannerGuard = { standardViolations: standard.length, strictViolations: strict.length, strict };
  assert.equal(standard.length, 0);
  assert.equal(strict.length, 2);
  await guard.close();
  for (const theme of ["light", "dark"]) for (const width of [375, 1440]) {
    const test = { theme, width, checks: {}, captures: [] };
    report.cases.push(test);
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(({ theme, auth }) => {
      localStorage.setItem("theme", theme);
      if (location.pathname !== "/login") for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { theme, auth });
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return route.abort("blockedbyclient");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.businessWrites.push({ path: url.pathname, method: request.method() });
        return route.fulfill({ status: 409, json: { detail: "Pilot QA blocks business writes" } });
      }
      if (url.pathname === "/events/stream") return route.fulfill({ status: 503, json: { detail: "QA polling fallback" } });
      if (url.pathname === "/sessions/alerts") return route.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push({ theme, width, message: error.message }));
    async function capture(state) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      if (["member-error", "member-empty"].includes(state)) {
        await page.locator(".checkout-section:has(.checkout-customer-paths)").evaluate(section => {
          const target = section.querySelector('.retry-notice, .ui-empty-state, [role="status"]') || section.lastElementChild;
          const body = section.closest(".ui-overlay-body");
          body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 80;
        });
      }
      const violations = await scanRenderedContrast(page, { route: new URL(page.url()).pathname, theme, state, minimumContrast: 4.5, includeDisabled: true, viewportOnly: true });
      report.violations.push(...violations.map(row => ({ ...row, width })));
      const file = `${theme}-${width}-${state}.png`;
      await page.screenshot({ path: `${output}/${file}`, fullPage: state.startsWith("login-"), animations: "disabled" });
      const metrics = await page.evaluate(measureUi);
      test.captures.push({ state, file, violations: violations.length, ...metrics });
    }
    try {
      await page.goto(`${app}/login`);
      await page.getByTestId("username-input").fill("QA pilot fixture");
      await page.getByTestId("password-input").fill("not-a-real-credential");
      let releaseLogin;
      const loginGate = new Promise(resolve => { releaseLogin = resolve; });
      await page.route("**/auth/login", async route => { await loginGate; await route.fulfill({ status: 401, json: { detail: "QA invalid credentials" } }); });
      await page.getByTestId("login-button").click();
      await page.getByTestId("login-button").locator(".ui-button-spinner").waitFor();
      test.checks.pendingLoginDisabled = await page.getByTestId("username-input").isDisabled();
      await capture("login-pending");
      test.pendingFieldContrast = (await page.evaluate(scanTextContrast, { collect: true, minimumContrast: 4.5, includeDisabled: true })).filter(row => row.selector === "#login-username" || row.selector === "#login-password").map(({ selector, ratio }) => ({ selector, ratio }));
      releaseLogin();
      await page.locator("#login-error").waitFor();
      await capture("login-error");
      await page.goto(`${app}/live-floor`);
      await page.locator(".lf-table-card").first().getByRole("button", { name: "End", exact: true }).click();
      const drawer = page.locator(".checkout-panel");
      await drawer.getByText("Payment method", { exact: true }).waitFor();
      await drawer.getByRole("button", { name: "Credit", exact: true }).scrollIntoViewIfNeeded();
      await capture("checkout-disabled-payment");
      const toggle = drawer.getByRole("button", { name: "Adjust Time", exact: true });
      test.actionAppearance = await toggle.evaluate(node => {
        const css = getComputedStyle(node), bounds = node.getBoundingClientRect();
        return { background: css.backgroundColor, borderWidth: css.borderTopWidth, containerBorderWidth: getComputedStyle(node.closest(".ui-disclosure")).borderTopWidth, height: bounds.height, chevron: !!node.querySelector(".ui-disclosure-chevron"), expanded: node.getAttribute("aria-expanded") };
      });
      test.checks.adjustTimeHasAffordance = test.actionAppearance.chevron && parseFloat(test.actionAppearance.containerBorderWidth) >= 1 && (width > 768 || test.actionAppearance.height >= 44);
      await toggle.click();
      test.checks.adjustTimeExpands = await toggle.getAttribute("aria-expanded") === "true";
      await capture("adjust-time-expanded");
      await toggle.click();
      let memberMode = "held", releaseMembers;
      const memberGate = new Promise(resolve => { releaseMembers = resolve; });
      await page.route("**/members/recent**", async route => {
        if (memberMode === "held") await memberGate;
        return memberMode === "failure" ? route.fulfill({ status: 503, json: { detail: "QA member read failure" } }) : route.fulfill({ json: memberMode === "partial" ? [null, { id: "QA-fixture", nm: "QA fixture member", phone: "", typ: "LP" }] : [] });
      });
      await drawer.getByRole("button", { name: "Search LP Member", exact: true }).click();
      await page.getByRole("status", { name: "Loading members", exact: true }).waitFor();
      await capture("member-loading");
      memberMode = "failure"; releaseMembers();
      await page.getByRole("status", { name: "Loading members", exact: true }).waitFor({ state: "hidden" });
      const retry = drawer.getByRole("button", { name: "Retry", exact: true });
      test.checks.memberFailureHasRetry = await retry.count() > 0;
      await (await retry.count() ? retry : drawer.locator(".checkout-section:has(.checkout-customer-paths) [role=status]")).scrollIntoViewIfNeeded();
      await capture("member-error");
      memberMode = "empty";
      const emptyResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/members/recent" && response.status() === 200);
      if (await retry.count()) await retry.click();
      else { await drawer.getByRole("button", { name: "Add name", exact: true }).click(); await drawer.getByRole("button", { name: "Search LP Member", exact: true }).click(); }
      await emptyResponse;
      await page.getByRole("status", { name: "Loading members", exact: true }).waitFor({ state: "hidden" });
      await page.waitForTimeout(100);
      test.checks.emptyMembersHasAction = await drawer.getByRole("button", { name: "Use guest name", exact: true }).count() > 0;
      await (test.checks.emptyMembersHasAction ? drawer.getByRole("button", { name: "Use guest name", exact: true }) : drawer.locator(".checkout-section:has(.checkout-customer-paths) [role=status]")).scrollIntoViewIfNeeded();
      await capture("member-empty");
      if (test.checks.emptyMembersHasAction) {
        await drawer.getByRole("button", { name: "Use guest name", exact: true }).click();
        test.checks.emptyMembersActionWorks = await drawer.getByLabel("Name (optional)", { exact: true }).isVisible();
      }
      memberMode = "partial";
      const partialResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/members/recent" && response.status() === 200);
      await drawer.getByRole("button", { name: "Add name", exact: true }).click();
      await drawer.getByRole("button", { name: "Search LP Member", exact: true }).click();
      await partialResponse;
      await page.getByRole("status", { name: "Loading members", exact: true }).waitFor({ state: "hidden" });
      await page.waitForTimeout(100);
      test.checks.partialMemberRowsDoNotCrash = await drawer.getByRole("button", { name: /QA fixture member/ }).count() === 1;
      await capture("member-partial");
    } catch (error) { test.error = error.message; await page.screenshot({ path: `${output}/${theme}-${width}-failure.png` }).catch(() => {}); }
    finally { await context.close(); }
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ cases: report.cases.length, violations: report.violations.length, failedCases: report.cases.filter(row => row.error || Object.values(row.checks).some(value => !value)).length, errors: report.errors.length, writes: report.businessWrites.length }));
if (stage === "after") {
  assert.equal(report.violations.length, 0);
  assert.ok(report.cases.every(row => !row.error && Object.values(row.checks).every(Boolean)));
  assert.ok(report.cases.every(row => row.captures.every(sample => !sample.overflow && !sample.contentOverflow.length && !sample.shortTargets.length && !sample.invalidCopy.length && !sample.unlabeledButtons.length && !sample.unlabeledInputs.length)));
  assert.equal(report.errors.length, 0);
}
assert.equal(report.businessWrites.length, 0);
