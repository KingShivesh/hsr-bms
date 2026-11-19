import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
const app = process.env.RELIABILITY_APP_URL || "http://127.0.0.1:5188";
assert.equal(new URL(app).hostname, "127.0.0.1");
assert.ok(["before", "after"].includes(stage));
const onlyOutage = process.env.RELIABILITY_CASES === "outage";
const output = `../docs/daily-use-readiness/phase-1/${stage}${onlyOutage ? "-outage" : ""}`;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, scope: "Local browser with intercepted API; no production requests or database writes", cases: [], outages: [] };
try {
  for (const theme of onlyOutage ? [] : ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: theme === "dark" ? 375 : 1440, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const began = Date.now();
    const row = { theme, wakeMs: 60000, healthRequests: 0, loginRequests: 0, errors };
    report.cases.push(row);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(app).origin) return route.continue();
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
      if (url.pathname === "/ready") {
        row.healthRequests++;
        return route.fulfill({ status: Date.now() - began < row.wakeMs ? 503 : 200, json: { status: "ok", database: "ok" } });
      }
      if (url.pathname === "/auth/login") {
        row.loginRequests++;
        row.loginAtMs = Date.now() - began;
        await new Promise(resolve => setTimeout(resolve, 300));
        return route.fulfill({ status: Date.now() - began < row.wakeMs ? 503 : 401, json: { detail: "QA invalid credentials after server wake" } });
      }
      return route.fulfill({ status: 503, json: { detail: "QA blocks unrelated requests" } });
    });
    await page.goto(`${app}/login`);
    await page.getByTestId("username-input").fill("QA disposable fixture");
    await page.getByTestId("password-input").fill("not-a-real-password");
    const idleBackground = await page.getByTestId("login-button").evaluate(node => getComputedStyle(node).backgroundColor);
    const clicked = Date.now();
    await page.getByTestId("login-button").click();
    await page.getByTestId("login-button").locator(".ui-button-spinner").waitFor();
    row.feedbackMs = Date.now() - clicked;
    await page.waitForTimeout(1700);
    row.wakeVisible = await page.locator(".backend-status-banner.is-connecting").isVisible();
    row.pendingDuringWake = await page.getByTestId("username-input").isDisabled();
    row.buttonAppearance = await page.getByTestId("login-button").evaluate(node => {
      const spinner = node.querySelector(".ui-button-spinner"), style = getComputedStyle(node), ink = getComputedStyle(spinner);
      return { background: style.backgroundColor, spinner: ink.color, visibility: ink.visibility, opacity: ink.opacity };
    });
    row.contrast = await scanRenderedContrast(page, { theme, state: "login-waking", minimumContrast: 4.5, includeDisabled: true });
    await page.screenshot({ path: `${output}/${theme}-waking.png`, fullPage: true });
    await page.locator("#login-error").waitFor({ timeout: 85000 });
    row.resultAtMs = Date.now() - began;
    row.error = await page.locator("#login-error").innerText();
    row.credentialsRetained = await page.getByTestId("username-input").inputValue() === "QA disposable fixture";
    row.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: `${output}/${theme}-result.png`, fullPage: true });
    if (stage === "after") {
      assert.ok(row.wakeVisible && row.pendingDuringWake);
      assert.equal(row.buttonAppearance.background, idleBackground);
      assert.notEqual(row.buttonAppearance.spinner, "rgba(0, 0, 0, 0)");
      assert.equal(row.buttonAppearance.visibility, "visible");
      assert.equal(row.contrast.length, 0);
      assert.ok(row.loginAtMs >= 60000 && row.loginAtMs < 75000, JSON.stringify(row));
      assert.equal(row.loginRequests, 1);
      assert.ok(row.error.includes("Invalid username or password"));
      assert.ok(row.credentialsRetained && !row.horizontalOverflow);
      assert.equal(errors.length, 0);
    }
    await context.close();
  }
  if (stage === "after") await Promise.all(["light", "dark"].map(async theme => {
    const context = await browser.newContext({ viewport: { width: 375, height: 844 }, reducedMotion: "reduce" });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    const page = await context.newPage();
    let unavailable = true, loginRequests = 0;
    const began = Date.now();
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(app).origin) return route.continue();
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
      if (url.pathname === "/ready") return route.fulfill({ status: unavailable ? 503 : 200, json: { status: "ok", database: "ok" } });
      if (url.pathname === "/auth/login") loginRequests++;
      return route.fulfill({ status: 401, json: { detail: "QA invalid login" } });
    });
    await page.goto(`${app}/login`);
    await page.getByTestId("username-input").fill("QA preserved input");
    await page.getByTestId("password-input").fill("QA preserved password");
    await page.getByTestId("login-button").click();
    await page.locator("#login-error").waitFor({ timeout: 80000 });
    const row = { theme, failureAtMs: Date.now() - began, loginRequestsBeforeRecovery: loginRequests };
    report.outages.push(row);
    assert.ok(row.failureAtMs < 78000);
    assert.equal(loginRequests, 0);
    assert.ok(await page.getByTestId("login-button").isEnabled());
    await page.screenshot({ path: `${output}/${theme}-offline.png`, fullPage: true });
    unavailable = false;
    const retryAt = Date.now();
    await page.locator(".backend-status-banner").getByRole("button", { name: "Retry" }).click();
    await page.locator(".backend-status-banner").waitFor({ state: "hidden" });
    row.recoveryMs = Date.now() - retryAt;
    assert.equal(await page.getByTestId("username-input").inputValue(), "QA preserved input");
    await page.getByTestId("login-button").click();
    await page.getByText("Invalid username or password", { exact: true }).waitFor();
    row.loginRequestsAfterRecovery = loginRequests;
    assert.equal(loginRequests, 1);
    await context.close();
  }));
} finally {
  await browser.close();
  await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
