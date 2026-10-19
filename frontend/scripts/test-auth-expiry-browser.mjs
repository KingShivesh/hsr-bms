import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

// Parent runs this only after rebuilding preview 5181. No source imports or login submissions.
// From frontend: node scripts/test-auth-expiry-browser.mjs
const app = "http://127.0.0.1:5181";
const api = "http://127.0.0.1:8006";
const output = new URL("../../docs/ui-readiness/auth-expiry/browser/", import.meta.url);
const themes = ["light", "dark"];
const widths = [375, 768, 1024, 1440, 1920];
const marker = "hsr:auth-expired";
const noticeText = "Your session ended. Sign in again to continue.";
const token = "isolated-browser-expiry-fixture-not-a-real-credential";
const username = "QA authenticated staff";
const cors = {
  "access-control-allow-origin": app,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Client-Request-Id",
  "cache-control": "no-store",
};
const fixtures = new Map([
  ["/ready", { status: "ok" }],
  ["/auth/me", { role: "staff", username }],
  ["/product/context", { profile: { name: "HSR Snooker Cafe" }, version: 0 }],
  ["/sessions/alerts", { config: { soundEnabled: false }, alerts: [], owner_summaries: [] }],
  ["/sessions/tables", { tables: [], maintenance: {} }],
  ["/waitlist", []],
  ["/bookings", []],
  ["/food/orders", []],
]);
const report = {
  startedAt: new Date().toISOString(), app, api, widths, themes,
  scenario: "Built preview consumes a mocked auth/me 200, then a matching-token protected GET 401; expiry notice appears once and is absent after reload.",
  safety: {
    forwardedApiRequests: 0, forwardedBusinessWrites: 0, actualLoginAttempts: 0,
    policy: "Only static preview reads are forwarded, without redirects. Every API response is mocked; all mutations, external origins, WebSockets and source-module requests are blocked. Service workers are disabled.",
  },
  limitations: [
    "Mocked client-boundary regression, not a real JWT-expiry, backend-authentication or database test.",
    "Stale-token REST/stream races remain covered by test-auth-expiry.mjs; no browser pass is claimed for those races.",
    "Requires the parent-rebuilt production preview on 5181 configured for API8006; no dev server or source imports are used.",
  ],
  cases: [], samples: [], errors: [],
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations()
      .filter(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}

async function capture(page, theme, width, state) {
  await page.mouse.move(0, 0);
  await settle(page);
  const metrics = await page.evaluate(measureUi);
  const contrast = await scanRenderedContrast(page, { route: "/login", theme, state });
  await settle(page);
  const file = `${theme}-${width}-${state}.png`;
  await page.screenshot({ path: new URL(file, output).pathname, fullPage: true, animations: "disabled" });
  const sample = { theme, width, state, file, ...metrics, contrast };
  sample.uiFaults = [
    ...(metrics.applicationCrashed ? ["application-crashed"] : []),
    ...(metrics.overflow > 1 ? ["horizontal-overflow"] : []),
    ...["shortTargets", "clipped", "brokenImages", "invalidCopy", "unlabeledButtons", "unlabeledInputs", "contentOverflow"]
      .filter(key => metrics[key]?.length),
    ...(contrast.length ? ["contrast"] : []),
  ];
  report.samples.push(sample);
  return sample;
}

async function checkLoginHasNoCredentialError(page) {
  assert.equal(await page.locator("#login-error").count(), 0);
  assert.equal(await page.locator('.login-box [aria-invalid="true"]').count(), 0);
  assert.equal(await page.getByText("Invalid username or password", { exact: true }).count(), 0);
  assert.equal(await page.getByTestId("username-input").inputValue(), "");
  assert.equal(await page.getByTestId("password-input").inputValue(), "");
}

async function runCase(browser, theme, width) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 844 : 1000 },
    colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false,
  });
  const result = { theme, width, status: "running", functionalPass: false, network: [], pageErrors: [], safetyViolations: [] };
  report.cases.push(result);
  const expiryGate = deferred();
  let armed = false, authMeConsumed = false, closing = false;
  let api401s = 0, authMe200s = 0, loginRequests = 0, previewReads = 0;
  const violation = (kind, details) => result.safetyViolations.push({ kind, ...details });
  try {
    // Theme is restored on each document. Credentials are seeded once, never on reload.
    await context.addInitScript(({ app, theme }) => {
      if (location.origin === app) localStorage.setItem("theme", theme);
    }, { app, theme });
    await context.routeWebSocket("**/*", socket => {
      violation("blocked-websocket", { url: socket.url() });
      socket.close();
    });
    await context.route("**/*", async handler => {
      const request = handler.request();
      const url = new URL(request.url());
      const method = request.method();
      const entry = { method, url: `${url.origin}${url.pathname}`, resourceType: request.resourceType() };
      try {
        if (![app, api].includes(url.origin)) {
          violation("blocked-origin", entry);
          return await handler.abort("blockedbyclient");
        }
        if (url.origin === api && url.pathname === "/auth/login") loginRequests += 1;
        if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
          violation("blocked-mutation", entry);
          return await handler.abort("blockedbyclient");
        }
        if (url.origin === app) {
          const staticTypes = ["document", "script", "stylesheet", "image", "font", "manifest"];
          // Chromium classifies the icon linked by the built index as "other".
          const previewFavicon = request.resourceType() === "other" && url.pathname === "/favicon.svg" && !url.search;
          if (!["GET", "HEAD"].includes(method) || (!staticTypes.includes(request.resourceType()) && !previewFavicon) || /^\/(?:src|node_modules|@vite|@react-refresh|@fs|@id)(?:\/|$)/.test(url.pathname)) {
            violation("blocked-non-preview-read", entry);
            return await handler.abort("blockedbyclient");
          }
          const response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
          previewReads += 1;
          if (response.status() >= 300 && response.status() < 400) {
            violation("blocked-preview-redirect", entry);
            return await handler.abort("blockedbyclient");
          }
          if (previewFavicon) {
            assert.equal(response.headers()["content-type"]?.split(";")[0].trim(), "image/svg+xml", "Reviewed favicon must remain an SVG asset");
            result.network.push({ ...entry, status: response.status(), fixture: "reviewed-preview-favicon", mocked: false });
          }
          return await handler.fulfill({ response });
        }
        if (method === "OPTIONS") return await handler.fulfill({ status: 204, headers: cors });
        if (url.pathname === "/reports/summary") {
          assert.ok(armed, "Protected request occurred before the fixture was armed");
          assert.equal(request.headers().authorization, `Bearer ${token}`, "401 must concern the current token");
          await expiryGate.promise;
          if (closing) return await handler.abort("aborted");
          assert.ok(authMeConsumed, "Expiry cannot precede the application's auth/me consumption");
          api401s += 1;
          result.network.push({ ...entry, status: 401, mocked: true, afterAuthMeConsumed: true });
          return await handler.fulfill({ status: 401, headers: cors, json: { detail: "QA simulated session expiry" } });
        }
        if (url.pathname === "/events/stream") {
          result.network.push({ ...entry, status: 200, mocked: true, fixture: "connected-then-closed; no expiry event" });
          return await handler.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: "event: system.connected\ndata: {}\n\n" });
        }
        if (!fixtures.has(url.pathname)) {
          violation("blocked-unreviewed-api-read", entry);
          return await handler.abort("blockedbyclient");
        }
        if (url.pathname === "/auth/me") {
          assert.ok(armed);
          assert.equal(request.headers().authorization, `Bearer ${token}`);
          authMe200s += 1;
        }
        result.network.push({ ...entry, status: 200, mocked: true });
        return await handler.fulfill({ status: 200, headers: cors, json: fixtures.get(url.pathname) });
      } catch (error) {
        if (!closing) violation("route-handler-failure", { ...entry, message: error.message });
        await handler.abort("blockedbyclient").catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => result.pageErrors.push(error.message));
    await page.goto(`${app}/login`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-button").waitFor();
    assert.equal(await page.getByText(noticeText, { exact: true }).count(), 0);
    await checkLoginHasNoCredentialError(page);
    await page.evaluate(({ token }) => {
      localStorage.setItem("token", token);
      localStorage.setItem("role", "staff");
      localStorage.setItem("username", "QA identity before auth/me");
    }, { token });
    armed = true;
    await Promise.all([
      page.waitForResponse(response => response.url() === `${api}/auth/me` && response.status() === 200),
      page.goto(`${app}/help`, { waitUntil: "domcontentloaded" }),
    ]);
    await page.waitForFunction(username => localStorage.getItem("username") === username, username);
    authMeConsumed = true;
    expiryGate.resolve();
    await page.waitForURL(url => url.origin === app && url.pathname === "/login");
    await page.getByTestId("login-button").waitFor();
    const notice = page.locator('.login-box [role="status"]').filter({ hasText: noticeText });
    await notice.waitFor({ state: "visible" });
    assert.equal(await notice.count(), 1);
    assert.equal((await notice.innerText()).trim(), noticeText);
    assert.equal(new URL(page.url()).searchParams.get("from"), "/help");
    await page.waitForFunction(marker => sessionStorage.getItem(marker) === null, marker);
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), null);
    await checkLoginHasNoCredentialError(page);
    result.observedTheme = await page.evaluate(() => document.documentElement.classList.contains("dark") ? "dark" : "light");
    assert.equal(result.observedTheme, theme);
    result.expiredNotice = await notice.evaluate(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { role: node.getAttribute("role"), text: node.textContent.trim(), width: rect.width, height: rect.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, color: style.color, font: style.fontFamily };
    });
    assert.ok(result.expiredNotice.width > 0 && result.expiredNotice.height > 0);
    assert.ok(result.expiredNotice.scrollWidth <= result.expiredNotice.clientWidth + 1, "Expiry text overflows its container");
    const expired = await capture(page, theme, width, "expired-login");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("login-button").waitFor();
    await settle(page);
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(await page.getByText(noticeText, { exact: true }).count(), 0);
    assert.equal(await page.evaluate(marker => sessionStorage.getItem(marker), marker), null);
    assert.equal(await page.evaluate(() => localStorage.getItem("token")), null);
    await checkLoginHasNoCredentialError(page);
    const consumed = await capture(page, theme, width, "notice-consumed");
    assert.ok(authMe200s >= 1 && api401s >= 1);
    assert.equal(loginRequests, 0, "The test must not submit credentials");
    result.functionalPass = true;
    assert.equal(result.pageErrors.length, 0);
    assert.equal(result.safetyViolations.length, 0, "Unreviewed requests were blocked; inspect safetyViolations");
    assert.deepEqual(expired.uiFaults, [], "Expired Login has UI/contrast faults");
    assert.deepEqual(consumed.uiFaults, [], "Reloaded Login has UI/contrast faults");
    result.status = "pass";
  } catch (error) {
    result.status = "fail";
    result.error = error.stack || error.message;
  } finally {
    closing = true;
    expiryGate.resolve();
    result.counts = { authMe200s, protectedGet401s: api401s, loginRequests, forwardedPreviewReads: previewReads };
    await context.close();
  }
}

let browser;
await fs.mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"],
  });
  for (const theme of themes) for (const width of widths) {
    await runCase(browser, theme, width);
    console.log(`Auth expiry ${theme} ${width}px: ${report.cases.at(-1).status}`);
  }
} catch (error) {
  report.errors.push(error.stack || error.message);
} finally {
  if (browser) await browser.close().catch(error => report.errors.push(error.message));
  report.finishedAt = new Date().toISOString();
  report.summary = {
    expectedCases: themes.length * widths.length,
    passed: report.cases.filter(result => result.status === "pass").length,
    failed: report.cases.filter(result => result.status !== "pass").length,
    capturedSamples: report.samples.length,
    safetyViolations: report.cases.reduce((count, result) => count + result.safetyViolations.length, 0),
    staleTokenBrowserAssertions: 0,
  };
  report.status = !report.errors.length && report.summary.passed === report.summary.expectedCases && !report.summary.failed && !report.summary.safetyViolations ? "pass" : "fail";
  await fs.writeFile(new URL("results.json", output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: new URL("results.json", output).pathname, status: report.status, ...report.summary }, null, 2));
  if (report.status !== "pass") process.exitCode = 1;
}
