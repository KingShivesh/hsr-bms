import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const stage = process.argv[2] || "after";
assert.ok(["before", "after"].includes(stage));
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const output = `../docs/deployment-ui-completion/settings-contract/${stage}`;
await fs.mkdir(output, { recursive: true });
const report = { stage, cases: [], blockedWrites: [], mockedWrites: [], businessWrites: 0, scope: "Isolated local QA. Alerts held empty to isolate Settings; tariff POST is held then mocked HTTP 500, never sent to the backend." };
const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
assert.ok(auth.token);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    let accountMode = "partial", tariffMode = "loading", releaseRead, releaseWrite;
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    const writeGate = new Promise(resolve => { releaseWrite = resolve; });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url());
      if (![app, api].includes(url.origin)) return handler.abort("blockedbyclient");
      if (url.origin === api && url.pathname === "/settings/tariffs" && request.method() === "POST") {
        report.mockedWrites.push({ theme, width, payload: request.postDataJSON() });
        await writeGate;
        return handler.fulfill({ status: 500, json: { detail: "QA tariff save failed" } });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push(url.pathname); return handler.abort("blockedbyclient"); }
      if (url.origin === api && url.pathname === "/sessions/alerts") return handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } });
      if (url.origin === api && url.pathname === "/product/account") {
        if (accountMode === "error") return handler.fulfill({ status: 503, json: { detail: "QA account unavailable" } });
        const response = await handler.fetch(), data = await response.json();
        return handler.fulfill({ response, json: accountMode === "partial" ? { ...data, members: null, tables: null, team: null } : data });
      }
      if (url.origin === api && url.pathname === "/settings/tariffs") {
        if (tariffMode === "loading") await readGate;
        return handler.fulfill({ json: { frame_rates: { wr: 100, sr: 90, pr: 60 }, packages: tariffMode === "partial" ? null : [] } });
      }
      return handler.continue();
    });
    const page = await context.newPage(), result = { theme, width };
    report.cases.push(result);
    async function capture(state) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/${theme}-${width}-${state}.png`, animations: "disabled", fullPage: true });
      if (stage === "after") {
        const metrics = await page.evaluate(measureUi, { minimumTextSize: 12 });
        for (const key of ["smallText", "contentOverflow", "shortTargets", "clipped", "unlabeledButtons", "unlabeledInputs", "invalidCopy"]) assert.equal(metrics[key].length, 0, `${state}: ${key}`);
        assert.equal(metrics.overflow, 0, state);
        assert.equal((await scanRenderedContrast(page, { route: "/settings", theme, state, minimumContrast: 4.5, includeDisabled: true })).length, 0, `${state}: contrast`);
      }
    }
    try {
      await page.goto(app + "/settings?section=account");
      await page.locator(".product-details").waitFor();
      result.missingCounts = await page.locator(".product-details").evaluate(node => Object.fromEntries([...node.querySelectorAll("dt")].map(label => [label.textContent, label.nextElementSibling.textContent])));
      await capture("missing-counts");
      if (stage === "after") {
        for (const key of ["Customers", "Tables", "Role logins"]) assert.equal(result.missingCounts[key], "—");
        assert.ok(await page.locator(".product-settings-section").getByRole("button", { name: "Retry", exact: true }).isVisible());
      }
      await page.goto(app + "/settings?section=team");
      await page.getByRole("heading", { name: "Team access", exact: true }).waitFor();
      await capture("missing-team");
      result.unknownTeamReviewDisabled = await page.getByRole("button", { name: "Mark access reviewed", exact: true }).isDisabled();
      if (stage === "after") {
        assert.ok(result.unknownTeamReviewDisabled);
        accountMode = "error";
        await page.locator(".product-settings-section").getByRole("button", { name: "Retry", exact: true }).click();
        await page.locator(".product-settings-section .retry-notice").getByText("The club server could not complete the request. Try again in a moment.", { exact: true }).waitFor();
        await capture("team-retry-failed");
        accountMode = "valid";
        await page.locator(".product-settings-section").getByRole("button", { name: "Retry", exact: true }).click();
        await page.getByRole("button", { name: "Mark access reviewed", exact: true }).waitFor({ state: "visible" });
        await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(node => node.textContent === "Mark access reviewed")?.disabled);
        result.teamRecovered = await page.locator(".product-settings-section tbody tr").count() === 2;
        assert.ok(result.teamRecovered);
      }
      await page.goto(app + "/settings");
      const tariffs = page.getByRole("region", { name: "Frame and package tariffs", exact: true });
      await tariffs.waitFor();
      result.settingsPanelHeights = await page.locator(".settings-page-shell > .settings-panel").evaluateAll(nodes => nodes.map(node => ({ title: node.querySelector(".settings-panel-title,h3")?.textContent, height: node.getBoundingClientRect().height })));
      result.tableOperationsHeight = result.settingsPanelHeights[0].height;
      if (stage === "after") assert.ok(result.tableOperationsHeight < 600, "Table Operations must fit its content, not stretch to the whole settings stack");
      result.tariffLoadingSkeleton = await tariffs.locator(".ui-skeleton-stack").count() > 0;
      await tariffs.screenshot({ path: `${output}/${theme}-${width}-tariff-loading-panel.png`, animations: "disabled" });
      await capture("tariff-loading");
      if (stage === "after") assert.ok(result.tariffLoadingSkeleton);
      tariffMode = "valid"; releaseRead();
      await page.getByRole("button", { name: "Save Tariffs", exact: true }).waitFor();
      tariffMode = "partial";
      await page.reload();
      if (stage === "after") await page.getByText("Could not load tariff settings.", { exact: true }).waitFor();
      else await page.getByRole("button", { name: /retry|reload|try again/i }).first().waitFor();
      await capture("tariff-incomplete");
      result.incompleteTariffCrashesPage = await page.evaluate(() => document.body.innerText.includes("This page could not open."));
      result.incompleteTariffHasSave = await page.getByRole("button", { name: "Save Tariffs", exact: true }).count() > 0;
      if (stage === "after") {
        assert.equal(result.incompleteTariffHasSave, false);
        assert.equal(result.incompleteTariffCrashesPage, false);
        tariffMode = "valid";
        await tariffs.getByRole("button", { name: "Retry", exact: true }).click();
        const submit = page.getByRole("button", { name: "Save Tariffs", exact: true });
        await submit.waitFor();
        await submit.evaluate(node => node.addEventListener("click", () => { const start = performance.now(); requestAnimationFrame(() => { window.qaTariffFeedback = { ms: performance.now() - start, pending: node.disabled && node.getAttribute("data-loading") === "true" }; }); }, { once: true }));
        await submit.click();
        await page.waitForFunction(() => window.qaTariffFeedback);
        result.pendingFeedback = await page.evaluate(() => window.qaTariffFeedback);
        assert.ok(result.pendingFeedback.pending && result.pendingFeedback.ms <= 200);
        releaseWrite();
        await page.getByText("QA tariff save failed", { exact: true }).waitFor();
        result.rateRetained = await tariffs.locator('input[type="number"]').first().inputValue() === "100";
        assert.ok(result.rateRetained);
        assert.equal(report.mockedWrites.filter(row => row.theme === theme && row.width === width).length, 1);
        await capture("tariff-save-failed");
      }
    } catch (error) { result.error = error.message; }
    finally { releaseRead(); releaseWrite(); await context.close(); }
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
assert.ok(report.cases.every(row => !row.error));
assert.equal(report.blockedWrites.length, 0);
