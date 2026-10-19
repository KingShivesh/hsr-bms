import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

// Default is immutable baseline only. Parent runs "after" after rebuilding preview 5181.
// From frontend: node scripts/test-command-readiness.mjs [before|after]
const stage = process.argv[2] || "before";
assert.ok(["before", "after"].includes(stage), "Expected before or after; there is deliberately no both mode");
const app = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
const api = "http://127.0.0.1:8006";
const output = new URL(`../../docs/ui-readiness/command/${stage}/`, import.meta.url);
const themes = ["light", "dark"], widths = [375, 768, 1024, 1440, 1920];
const livePaths = new Map([
  ["/sessions/tables", "tables"], ["/waitlist", "waitlist"], ["/bookings", "bookings"],
  ["/food/orders", "food"], ["/operations/audit-logs", "audit"], ["/members/", "members"], ["/settings/menu", "menu"],
]);
const reads = [
  /^\/(?:ready|auth\/me)\/?$/, /^\/product\/(?:context|setup|account)\/?$/,
  /^\/reports\/(?:summary|closing-report|closing-insights)\/?$/,
  ...[...livePaths.keys()].map(value => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
];
const cors = { "access-control-allow-origin": app, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, X-Client-Request-Id", "cache-control": "no-store" };
const report = {
  startedAt: new Date().toISOString(), stage, app, api, themes, widths,
  safety: { localAdminLoginAttempts: 0, forwardedBusinessWrites: 0,
    policy: "One explicit Node-side admin login at API8006. Browser mutations, external origins, redirects, source modules and WebSockets blocked. Exact seven command reads intercepted only after authenticated Help loads; no command actions with business effects are invoked." },
  limitations: [
    "Before measures unfiltered pending commands only; it does not type a query that would mask the loading defect.",
    "After-only scenarios are never executed by before mode. Mocked live records never enter the QA database.",
    "Forwarded local bootstrap and navigation GETs may reconcile QA data; database side effects are not measured or claimed absent.",
  ], cases: [], errors: [],
};

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function fixture(mode, id) {
  if (mode !== "partial") return id === "tables" ? { tables: [], active_sessions: [] } : [];
  return {
    tables: { tables: [null, { id: "t1", label: "QA partial table", rate: 320 }], active_sessions: { invalid: true } },
    waitlist: null,
    bookings: [null, { id: "qa-command-booking", customer_name: "QA partial booking" }],
    food: { items: null },
    audit: [null, { id: "qa-command-audit", action: "QA_PARTIAL_AUDIT" }],
    members: [null, { id: "qa-command-member", nm: "QA partial member" }],
    menu: [null, { name: "QA partial menu", price: 20 }],
  }[id];
}

async function capture(page, result, state) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const metrics = await page.evaluate(measureUi);
  const contrast = await scanRenderedContrast(page, { route: "/help", theme: result.theme, state });
  const file = `${result.theme}-${result.width}-${state}.png`;
  await page.screenshot({ path: new URL(file, output).pathname, fullPage: true, animations: "disabled" });
  const sample = { state, file, ...metrics, contrast };
  result.samples.push(sample);
  return sample;
}

async function runCase(browser, auth, theme, width) {
  const result = { theme, width, status: "running", samples: [], cycles: [], violations: [], pageErrors: [] };
  report.cases.push(result);
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 844 : 1000 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false });
  let armed = false, closing = false, activeCycle = null, browserWrites = 0;
  const violation = (kind, entry) => result.violations.push({ kind, ...entry });
  function cycle(mode, held = false) {
    const next = { mode, held: new Set(), completed: new Set(), attempts: 0, gate: gate(), released: !held, cancelled: false };
    if (!held) next.gate.resolve();
    activeCycle = next;
    result.cycles.push(next);
    return next;
  }
  function release(current) { current.released = true; current.gate.resolve(); }
  async function complete(current) {
    await bounded(() => current.completed.size === 7, `Not all seven ${current.mode} reads completed`);
  }
  try {
    await context.addInitScript(({ app, theme }) => {
      if (location.origin === app) localStorage.setItem("theme", theme);
    }, { app, theme });
    await context.routeWebSocket("**/*", socket => { violation("blocked-websocket", { url: socket.url() }); socket.close(); });
    await context.route("**/*", async handler => {
      const request = handler.request(), url = new URL(request.url()), method = request.method();
      const entry = { method, url: `${url.origin}${url.pathname}`, resourceType: request.resourceType() };
      try {
        if (![app, api].includes(url.origin)) { violation("blocked-origin", entry); return await handler.abort("blockedbyclient"); }
        if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
          browserWrites += 1; violation("blocked-browser-write", entry); return await handler.abort("blockedbyclient");
        }
        if (url.origin === api && method === "OPTIONS") return await handler.fulfill({ status: 204, headers: cors });
        if (url.origin === api && url.pathname === "/events/stream") {
          return await handler.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: "event: system.connected\ndata: {}\n\n" });
        }
        if (url.origin === api && url.pathname === "/sessions/alerts") {
          return await handler.fulfill({ headers: cors, json: { config: { soundEnabled: false }, alerts: [], owner_summaries: [] } });
        }
        const id = livePaths.get(url.pathname);
        const exactQuery = id === "audit" ? url.search === "?limit=8" : !url.search;
        if (url.origin === api && method === "GET" && armed && id && exactQuery) {
          assert.ok(activeCycle, "Command read has no test cycle");
          const current = activeCycle;
          current.attempts += 1; current.held.add(id);
          await current.gate.promise;
          if (closing || current.cancelled) return await handler.abort("aborted");
          await handler.fulfill({ status: current.mode === "failure" ? 503 : 200, headers: cors,
            json: current.mode === "failure" ? { detail: "QA command live-read failure" } : fixture(current.mode, id) });
          current.completed.add(id);
          return;
        }
        if (url.origin === api && !reads.some(pattern => pattern.test(url.pathname))) {
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
        if (response.status() >= 300 && response.status() < 400) { violation("blocked-redirect", entry); return await handler.abort("blockedbyclient"); }
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
    await page.evaluate(auth => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, auth);
    async function help() {
      await page.goto(`${app}/help`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Help & documentation", exact: true }).waitFor();
      await page.waitForFunction(() => !!document.querySelector(".product-help") && !document.querySelector('.product-help [aria-busy="true"]'));
    }
    await help();
    armed = true;
    const held = cycle("held", true);
    const opener = page.getByRole("button", { name: "Shortcuts", exact: true });
    await opener.focus();
    await page.evaluate(() => {
      window.__commandReadinessFeedback = null;
      const keydown = event => {
        if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
        window.removeEventListener("keydown", keydown, true);
        const start = performance.now();
        const observer = new MutationObserver(() => {
          const dialog = document.querySelector(".command-palette");
          if (!dialog?.getClientRects().length) return;
          requestAnimationFrame(() => {
            if (window.__commandReadinessFeedback) return;
            window.__commandReadinessFeedback = {
              paintedMs: performance.now() - start,
              staticClosingAtFirstPaint: dialog.querySelectorAll("#command-result-closing").length,
              skeletonAtFirstPaint: !!dialog.querySelector(".ui-skeleton-stack"),
            };
            observer.disconnect();
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 3000);
      };
      window.addEventListener("keydown", keydown, true);
    });
    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog", { name: "Command palette", exact: true });
    const search = dialog.getByRole("textbox", { name: "Search commands", exact: true });
    await dialog.waitFor();
    await bounded(() => held.held.size === 7, "The exact seven command live GETs were not all held");
    await page.waitForFunction(() => !!window.__commandReadinessFeedback);
    result.loading = await page.evaluate(() => ({
      feedback: window.__commandReadinessFeedback,
      dailyClosingCount: document.querySelectorAll(".command-palette #command-result-closing").length,
      plainLoading: [...document.querySelectorAll(".command-palette .command-empty")].some(node => /Loading live results/.test(node.textContent)),
      skeletonCount: document.querySelectorAll(".command-palette .ui-skeleton-stack").length,
      searchFocused: document.activeElement?.getAttribute("aria-label") === "Search commands",
      scrollLocked: getComputedStyle(document.body).overflow === "hidden",
    }));
    assert.equal(held.released, false);
    assert.equal(held.completed.size, 0);
    const sample = await capture(page, result, "seven-live-reads-held");
    const controls = dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),textarea:visible:not(:disabled),[tabindex]:visible:not([tabindex="-1"])');
    await controls.first().focus(); await page.keyboard.press("Shift+Tab");
    const reverseTrap = await controls.last().evaluate(node => document.activeElement === node);
    await controls.last().focus(); await page.keyboard.press("Tab");
    const forwardTrap = await controls.first().evaluate(node => document.activeElement === node);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Shortcuts");
    result.keyboard = { forwardTrap, reverseTrap, escapeClosed: true, openerRestored: await opener.evaluate(node => document.activeElement === node), scrollRestored: await page.evaluate(() => getComputedStyle(document.body).overflow !== "hidden") };

    if (stage === "after") {
      assert.ok(result.loading.feedback.paintedMs < 200, "Command opening feedback must paint within 200ms of the real keyboard event");
      assert.equal(result.loading.dailyClosingCount, 1);
      assert.ok(result.loading.skeletonCount > 0 && result.loading.searchFocused && result.loading.scrollLocked);
      assert.ok(forwardTrap && reverseTrap && result.keyboard.openerRestored && result.keyboard.scrollRestored);
      assert.equal(sample.overflow, 0); assert.deepEqual(sample.contrast, []);
      await page.keyboard.press("Meta+k");
      await dialog.waitFor();
      await search.fill("Daily closing");
      await dialog.locator("#command-result-closing").waitFor();
      assert.equal(held.released, false);
      await page.keyboard.press("Enter");
      await page.waitForURL(url => url.pathname === "/daily-closing");
      result.navigation = { pathname: new URL(page.url()).pathname, gateReleased: held.released, liveResponsesCompleted: held.completed.size };
      assert.equal(held.released, false);
      release(held); await complete(held);
      await help();

      const failure = cycle("failure");
      await opener.focus(); await page.keyboard.press("Meta+k"); await dialog.waitFor();
      const retry = dialog.getByRole("button", { name: "Retry", exact: true });
      await retry.waitFor();
      assert.equal(await dialog.locator("#command-result-closing").count(), 1);
      await capture(page, result, "failed-live-reads-retry");
      const recovery = cycle("recovery");
      await retry.click();
      await complete(recovery);
      await retry.waitFor({ state: "hidden" });
      await dialog.locator(".ui-skeleton-stack").waitFor({ state: "hidden" });
      result.recovery = { failedReadAttempts: failure.attempts, recoveryReads: recovery.completed.size, retryRemoved: true, staticCommandsRetained: await dialog.locator("#command-result-closing").count() === 1 };
      assert.equal(recovery.completed.size, 7);
      await capture(page, result, "retry-recovered");
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });

      const partial = cycle("partial");
      await opener.focus(); await page.keyboard.press("Meta+k"); await dialog.waitFor();
      await complete(partial);
      await dialog.locator(".ui-skeleton-stack").waitFor({ state: "hidden" });
      await search.fill("QA partial");
      await dialog.locator("#command-result-member-qa-command-member").waitFor();
      result.partial = { validMember: await dialog.locator("#command-result-member-qa-command-member").count(), results: await dialog.getByRole("option").count(), pageErrors: [...result.pageErrors] };
      assert.equal(result.partial.validMember, 1); assert.ok(result.partial.results >= 4);
      await capture(page, result, "partial-null-and-array-rows");
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });

      const empty = cycle("empty");
      await opener.focus(); await page.keyboard.press("Meta+k"); await dialog.waitFor();
      await complete(empty);
      await dialog.locator(".ui-skeleton-stack").waitFor({ state: "hidden" });
      await search.fill("qa-command-no-match-891732");
      const clear = dialog.getByRole("button", { name: "Clear search", exact: true });
      await clear.waitFor();
      await capture(page, result, "empty-search-clear-action");
      await clear.click();
      assert.equal(await search.inputValue(), "");
      assert.equal(await dialog.locator("#command-result-closing").count(), 1);
      assert.ok(await search.evaluate(node => document.activeElement === node));
      result.empty = { clearSearchRecovered: true, searchFocused: true };
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    }
    assert.equal(browserWrites, 0);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.pageErrors, []);
    result.status = stage === "before" ? "observed" : "pass";
  } catch (error) {
    result.status = "fail"; result.error = error.stack || error.message;
  } finally {
    closing = true;
    for (const current of result.cycles) { current.cancelled = true; current.gate.resolve(); }
    await context.close();
    result.browserWrites = browserWrites;
    result.cycles = result.cycles.map(current => ({ mode: current.mode, requested: [...current.held], completed: [...current.completed], attempts: current.attempts, gateReleased: current.released }));
  }
}

let browser;
await fs.mkdir(output, { recursive: true });
try {
  report.safety.localAdminLoginAttempts += 1;
  const response = await fetch(`${api}/auth/login`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12000), headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.COMMAND_QA_USERNAME || "admin", password: process.env.COMMAND_QA_PASSWORD || "admin123" }) });
  assert.ok(response.ok, `Local QA login failed (${response.status}); no credential retries`);
  const auth = await response.json();
  assert.ok(auth.token && auth.username && auth.role === "admin", "Local QA admin identity required");
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
  for (const theme of themes) for (const width of widths) {
    await runCase(browser, auth, theme, width);
    console.log(`Command ${stage} ${theme} ${width}px: ${report.cases.at(-1).status}`);
  }
} catch (error) {
  report.errors.push(error.stack || error.message);
} finally {
  if (browser) await browser.close().catch(error => report.errors.push(error.message));
  report.finishedAt = new Date().toISOString();
  report.summary = {
    expectedCases: themes.length * widths.length, cases: report.cases.length,
    observed: report.cases.filter(row => row.status === "observed").length,
    passed: report.cases.filter(row => row.status === "pass").length,
    failed: report.cases.filter(row => row.status === "fail").length,
    hiddenStaticClosingWhileHeld: report.cases.filter(row => row.loading?.dailyClosingCount === 0).length,
    violations: report.cases.reduce((sum, row) => sum + row.violations.length, 0),
  };
  report.status = !report.errors.length && !report.summary.failed && !report.summary.violations && report.summary.cases === report.summary.expectedCases ? (stage === "before" ? "observed" : "pass") : "fail";
  await fs.writeFile(new URL("results.json", output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: new URL("results.json", output).pathname, status: report.status, ...report.summary }, null, 2));
  if (report.status === "fail") process.exitCode = 1;
}
