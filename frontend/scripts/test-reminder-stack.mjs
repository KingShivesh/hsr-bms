import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

// Prepare only until the parent rebuilds. No application source imports or mutations.
// From frontend: node scripts/test-reminder-stack.mjs [both|before|after]
const stageArgument = process.argv[2] || "both";
assert.ok(["both", "before", "after"].includes(stageArgument), "Expected both, before or after");
const stages = stageArgument === "both" ? ["before", "after"] : [stageArgument];
const api = "http://127.0.0.1:8006";
const output = new URL("../../docs/ui-readiness/reminder-stack/", import.meta.url);
const themes = ["light", "dark"], widths = [375, 1440];
const sessionKey = "qa-reminder-stack-ui-only";
const older = { id: 960060, session_key: sessionKey, table_id: "t1", threshold_minutes: 60, intensity: "normal", paused: false, accrued_amount: 320 };
const latest = { id: 960120, session_key: sessionKey, table_id: "t1", threshold_minutes: 120, intensity: "urgent", paused: false, accrued_amount: 640 };
const apiReads = [
  /^\/(?:ready|auth\/me)\/?$/,
  /^\/product\/(?:context|setup|account)\/?$/,
  /^\/reports\/summary\/?$/,
  /^\/sessions\/(?:live-floor|tables|active)\/?$/,
  /^\/sessions\/quote\/t1\/?$/,
  /^\/(?:waitlist|bookings)\/?$/,
  /^\/members(?:\/(?:recent|search))?\/?$/,
  /^\/food\/orders\/?$/,
  /^\/operations\/audit-logs\/?$/,
  /^\/settings\/(?:menu|rates)\/?$/,
];
const report = {
  startedAt: new Date().toISOString(), stages, api, widths, themes,
  fixture: { initial: [older], replacement: [older, latest], soundEnabled: false, owner_summaries: [] },
  safety: {
    localAdminLoginAttempts: 0, forwardedBusinessWrites: 0,
    policy: "One explicit Node-side admin login to literal API8006. Browser GET/HEAD reads use reviewed local paths; alerts and SSE are mocked. Browser mutations, acknowledgements, source imports, WebSockets, external origins and redirects are blocked.",
  },
  limitations: [
    "Alert rows are UI-only response fixtures; no alert, acknowledgement, table or financial records are created.",
    "The local QA database must already contain T1 for the checkout deep link. Missing checkout is reported as a failure, not replaced with a synthetic dialog.",
    "Forwarded local QA GETs, including checkout quote, may reconcile backend state; database side effects are not measured or claimed absent.",
    "The before stage records regression observations without requiring the unfixed preview to satisfy after-only expectations.",
  ],
  cases: [], errors: [],
};

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(200);
}

async function snapshot(page, result, state) {
  await page.mouse.move(0, 0);
  await settle(page);
  const measurement = await page.evaluate(() => {
    const stack = document.querySelector(".app-session-alert-container");
    if (!stack) throw new Error("Reminder stack is missing");
    const style = getComputedStyle(stack), bounds = stack.getBoundingClientRect();
    const rows = [...stack.querySelectorAll(".app-toast-warning:not(.is-exiting)")];
    return {
      messages: rows.map(node => node.querySelector(".app-toast-message")?.textContent || node.textContent),
      count: rows.length, exiting: stack.querySelectorAll(".is-exiting").length,
      zIndex: Number(style.zIndex), maxHeight: parseFloat(style.maxHeight),
      height: bounds.height, viewportHeight: innerHeight, overflowY: style.overflowY,
      insideDialog: !!stack.closest('[role="dialog"]'),
      actualTheme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    };
  });
  const file = `${result.stage}-${result.theme}-${result.width}-${state}.png`;
  await page.screenshot({ path: new URL(file, output).pathname, fullPage: true, animations: "disabled" });
  const sample = { state, file, ...measurement };
  result.samples.push(sample);
  assert.equal(measurement.actualTheme, result.theme);
  return sample;
}

async function runCase(browser, auth, stage, theme, width) {
  const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
  const cors = { "access-control-allow-origin": app, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, X-Client-Request-Id" };
  const result = { stage, theme, width, app, status: "running", samples: [], repeatReads: [], violations: [], pageErrors: [] };
  report.cases.push(result);
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false });
  let phase = "older", alertReads = 0, browserWrites = 0, ackAttempts = 0, closing = false;
  const violation = (kind, entry) => result.violations.push({ kind, ...entry });
  try {
    await context.addInitScript(({ app, theme }) => {
      if (location.origin === app) localStorage.setItem("theme", theme);
    }, { app, theme });
    await context.routeWebSocket("**/*", socket => {
      violation("blocked-websocket", { url: socket.url() }); socket.close();
    });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url()), method = request.method();
      const entry = { method, url: `${url.origin}${url.pathname}`, resourceType: request.resourceType() };
      try {
        if (![app, api].includes(url.origin)) {
          violation("blocked-origin", entry); return await handler.abort("blockedbyclient");
        }
        if (/\/acknowledge\/?$/.test(url.pathname)) ackAttempts += 1;
        if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
          browserWrites += 1;
          violation("blocked-browser-write", entry); return await handler.abort("blockedbyclient");
        }
        if (url.origin === api && method === "OPTIONS") return await handler.fulfill({ status: 204, headers: cors });
        if (url.origin === api && url.pathname === "/sessions/alerts") {
          alertReads += 1;
          return await handler.fulfill({ headers: { ...cors, "cache-control": "no-store", "x-qa-alert-phase": phase }, json: {
            config: { soundEnabled: false }, owner_summaries: [], alerts: phase === "older" ? [older] : [older, latest],
          } });
        }
        if (url.origin === api && url.pathname === "/events/stream") {
          return await handler.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: "event: system.connected\ndata: {}\n\n" });
        }
        if (url.origin === api && !apiReads.some(pattern => pattern.test(url.pathname))) {
          violation("blocked-unreviewed-api-read", entry); return await handler.abort("blockedbyclient");
        }
        if (url.origin === app) {
          const staticType = ["document", "script", "stylesheet", "image", "font", "manifest"].includes(request.resourceType());
          const favicon = request.resourceType() === "other" && url.pathname === "/favicon.svg" && !url.search;
          if (!["GET", "HEAD"].includes(method) || (!staticType && !favicon) || /^\/(?:src|node_modules|@vite|@react-refresh|@fs|@id)(?:\/|$)/.test(url.pathname)) {
            violation("blocked-non-preview-read", entry); return await handler.abort("blockedbyclient");
          }
        }
        const response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
        if (response.status() >= 300 && response.status() < 400) {
          violation("blocked-redirect", entry); return await handler.abort("blockedbyclient");
        }
        return await handler.fulfill({ response, ...(url.origin === api ? { headers: { ...response.headers(), ...cors } } : {}) });
      } catch (error) {
        if (!closing) violation("route-handler-failure", { ...entry, error: error.message });
        await handler.abort("blockedbyclient").catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => result.pageErrors.push(error.message));
    await page.goto(`${app}/login`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-button").waitFor();
    await page.evaluate(auth => {
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, auth);
    await page.goto(`${app}/live-floor`, { waitUntil: "domcontentloaded" });
    const stack = page.locator(".app-session-alert-container");
    const olderToast = stack.locator(".app-toast-warning:not(.is-exiting)").filter({ hasText: /T1.*60 min played/ });
    const latestToast = stack.locator(".app-toast-warning:not(.is-exiting)").filter({ hasText: /T1.*120 min played/ });
    await olderToast.waitFor();
    const firstShownAt = Date.now();
    const first = await snapshot(page, result, "60-minute-warning");
    assert.equal(first.count, 1);
    assert.equal(await olderToast.count(), 1, "Earlier warning expired before replacement was exercised");
    phase = "latest";
    async function refreshAlerts() {
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url() === `${api}/sessions/alerts` && response.status() === 200 && response.headers()["x-qa-alert-phase"] === "latest"),
        page.evaluate(() => window.dispatchEvent(new CustomEvent("hsr:data-changed", { detail: { path: "/sessions" } }))),
      ]);
      await response.finished();
      await latestToast.waitFor();
      await page.waitForTimeout(250);
    }
    await refreshAlerts();
    const replacement = await snapshot(page, result, "120-minute-replacement");
    result.replacement = {
      latestCount: await latestToast.count(), olderCount: await olderToast.count(),
      singleLatest: replacement.count === 1 && replacement.messages.every(message => /120 min played/.test(message)),
      elapsedSinceFirstWarningMs: Date.now() - firstShownAt,
    };
    assert.ok(result.replacement.elapsedSinceFirstWarningMs < 9000, "Replacement observation exceeded the normal warning's lifetime; rerun when QA is idle");
    for (let index = 1; index <= 3; index += 1) {
      const before = alertReads;
      await refreshAlerts();
      result.repeatReads.push({ index, alertReads, responseObserved: alertReads > before, latestCount: await latestToast.count(), olderCount: await olderToast.count(), total: await stack.locator(".app-toast-warning:not(.is-exiting)").count() });
    }
    await snapshot(page, result, "repeated-alert-reads");

    // Only open the real checkout UI. Never click a reminder action or settlement control.
    await page.goto(`${app}/live-floor?table=t1&action=checkout`, { waitUntil: "domcontentloaded" });
    const checkout = page.locator(".checkout-panel");
    await checkout.waitFor();
    await latestToast.waitFor();
    await settle(page);
    result.layering = await checkout.evaluate(node => {
      const overlay = node.closest(".ui-overlay"), stack = document.querySelector(".app-session-alert-container");
      if (!overlay || !stack) throw new Error("Real checkout overlay or reminder stack missing");
      const style = getComputedStyle(stack), rect = stack.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const painted = document.elementFromPoint(x, y);
      return {
        warningZ: Number(style.zIndex), checkoutZ: Number(getComputedStyle(overlay).zIndex),
        warningInsideCheckout: node.contains(stack), checkoutReceivesOverlap: !!painted && overlay.contains(painted),
        maxHeight: parseFloat(style.maxHeight), viewportHeight: innerHeight, height: rect.height,
      };
    });
    await snapshot(page, result, "below-checkout");
    assert.equal(browserWrites, 0, "Browser business writes must not be attempted");
    assert.equal(ackAttempts, 0, "Reminders must not be acknowledged");
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.pageErrors, []);
    if (stage === "after") {
      assert.ok(result.replacement.singleLatest, "Latest threshold must replace the earlier warning for the same session");
      assert.ok(result.repeatReads.every(row => row.responseObserved && row.latestCount === 1 && row.olderCount === 0 && row.total === 1), "Repeated reads resurrected older or duplicate reminder UI");
      assert.equal(result.layering.warningZ, 1900);
      assert.equal(result.layering.checkoutZ, 2000);
      assert.ok(!result.layering.warningInsideCheckout && result.layering.checkoutReceivesOverlap);
      assert.ok(result.layering.maxHeight <= result.layering.viewportHeight * 0.25 + 1, "Warning stack max-height must be at most 25dvh");
      assert.ok(result.layering.height <= result.layering.viewportHeight * 0.25 + 1);
      assert.ok(result.samples.every(sample => sample.maxHeight <= sample.viewportHeight * 0.25 + 1 && sample.height <= sample.viewportHeight * 0.25 + 1), "Every captured reminder state must respect the 25dvh cap");
    }
    result.status = stage === "before" ? "observed" : "pass";
  } catch (error) {
    result.status = "fail"; result.error = error.stack || error.message;
  } finally {
    closing = true;
    result.counts = { alertReads, blockedBrowserWrites: browserWrites, acknowledgementAttempts: ackAttempts };
    await context.close();
  }
}

let browser;
await fs.mkdir(output, { recursive: true });
try {
  // Sole POST exception: one real, explicit local QA admin login. Never retry failed credentials.
  report.safety.localAdminLoginAttempts += 1;
  const response = await fetch(`${api}/auth/login`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.REMINDER_QA_USERNAME || "admin", password: process.env.REMINDER_QA_PASSWORD || "admin123" }),
  });
  assert.ok(response.ok, `Local QA admin login failed (${response.status}); no retries or browser cases attempted`);
  const auth = await response.json();
  assert.ok(auth.token && auth.username && auth.role === "admin", "A real local admin token is required");
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
  for (const stage of stages) for (const theme of themes) for (const width of widths) {
    await runCase(browser, auth, stage, theme, width);
    console.log(`Reminder stack ${stage} ${theme} ${width}px: ${report.cases.at(-1).status}`);
  }
} catch (error) {
  report.errors.push(error.stack || error.message);
} finally {
  if (browser) await browser.close().catch(error => report.errors.push(error.message));
  report.finishedAt = new Date().toISOString();
  report.summary = {
    expectedCases: stages.length * themes.length * widths.length,
    passedAfter: report.cases.filter(row => row.status === "pass").length,
    observedBefore: report.cases.filter(row => row.status === "observed").length,
    failed: report.cases.filter(row => row.status === "fail").length,
    screenshots: report.cases.reduce((count, row) => count + row.samples.length, 0),
    violations: report.cases.reduce((count, row) => count + row.violations.length, 0),
  };
  report.status = !report.errors.length && !report.summary.failed && !report.summary.violations && report.cases.length === report.summary.expectedCases ? "pass" : "fail";
  await fs.writeFile(new URL(`${stageArgument}-results.json`, output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: new URL(`${stageArgument}-results.json`, output).pathname, status: report.status, ...report.summary }, null, 2));
  if (report.status !== "pass") process.exitCode = 1;
}
