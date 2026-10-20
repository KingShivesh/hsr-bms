/* global process, URL, console, fetch, AbortSignal, window, document, localStorage, getComputedStyle, performance */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Both phases intentionally use current preview 5181; parent owns rebuilds/Git.
// node frontend/scripts/test-advanced-book-pointer.mjs [before|after]
// Read-only pointer/HTML validation test: leave customer name blank; never create a booking.
const phase = process.argv[2] || "before";
if (!["before", "after"].includes(phase) || process.argv.length > 3) throw new Error("Use before or after");
const app = "http://127.0.0.1:5181", api = "http://127.0.0.1:8006";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "docs/ui-readiness/advanced-book-pointer", phase);
const report = { phase, app, api, startedAt: new Date().toISOString(), cases: [], errors: [], safety: { authPosts: 0, forwardedBusinessWrites: 0 }, limits: "375/414 mobile and 1440 desktop, both themes. Alerts isolated, no modal dismissed or CSS injected. Booking name remains empty; all browser write methods blocked. Reviewed QA GETs may reconcile isolated local data." };
const reads = /^\/(?:auth\/me|ready|health|reports\/summary|product\/(?:context|setup)|sessions\/(?:live-floor|maintenance|alerts)|settings\/(?:rates|session-controls)|operations\/(?:current-rate|gst)|waitlist|bookings)\/?$/;
function local(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || ![app, api].includes(url.origin) || url.username || url.password) throw new Error(`Blocked origin ${url.origin}`);
  return url;
}
function inspect(button) {
  const rect = button.getBoundingClientRect(), center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const hit = document.elementFromPoint(center.x, center.y);
  const workspace = document.querySelector(".advanced-table-controls-page .table-floor-layout .session-workspace");
  const style = workspace ? getComputedStyle(workspace) : null;
  return {
    button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, center,
    hit: hit ? { tag: hit.tagName, className: hit.className, text: hit.textContent.slice(0, 160) } : null,
    unobscured: hit === button || button.contains(hit), viewport: { width: window.innerWidth, height: window.innerHeight },
    workspace: style ? { position: style.position, top: style.top, bottom: style.bottom, left: style.left, zIndex: style.zIndex, maxHeight: style.maxHeight } : null,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node => node.getClientRects().length).length,
  };
}
await fs.mkdir(output, { recursive: true });
let browser;
try {
  const response = await fetch(`${api}/auth/login`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.UI_QA_USERNAME || "admin", password: process.env.UI_QA_PASSWORD || "admin123" }) });
  report.safety.authPosts += 1;
  if (!response.ok) throw new Error(`QA login HTTP ${response.status}`);
  const auth = await response.json();
  if (!auth.token || auth.role !== "admin") throw new Error("Local QA admin login required");
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const theme of ["light", "dark"]) for (const width of [375, 414, 1440]) {
    const result = { theme, width, writes: [], blockedReads: [], errors: [], hover: false, trustedClick: false };
    report.cases.push(result);
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
    let closing = false;
    try {
      await context.addInitScript(({ auth, theme, app }) => {
        if (window.location.origin !== app) return;
        localStorage.clear(); localStorage.setItem("theme", theme);
        for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
      }, { auth, theme, app });
      await context.routeWebSocket("**/*", socket => socket.close());
      await context.route("**/*", async handler => {
        const request = handler.request();
        try {
          const url = local(request.url()), method = request.method();
          const headers = { "access-control-allow-origin": app, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,HEAD,OPTIONS", "cache-control": "no-store" };
          if (method === "OPTIONS") return await handler.fulfill({ status: 204, headers });
          if (!["GET", "HEAD"].includes(method)) {
            result.writes.push({ method, path: url.pathname, disposition: "blocked-not-forwarded" });
            return await handler.fulfill({ status: 409, headers, json: { detail: "Pointer QA blocks business writes" } });
          }
          if (url.origin === api && url.pathname === "/sessions/alerts") return await handler.fulfill({ headers, json: { alerts: [], owner_summaries: [], config: {} } });
          if (url.origin === api && url.pathname === "/events/stream") return await handler.fulfill({ status: 204, headers });
          const favicon = url.origin === app && request.resourceType() === "other" && url.pathname === "/favicon.svg" && !url.search;
          if ((url.origin === api && !reads.test(url.pathname)) || (url.origin === app && !favicon && !["document", "script", "stylesheet", "font", "image", "manifest"].includes(request.resourceType()))) {
            result.blockedReads.push({ method, url: `${url.origin}${url.pathname}` });
            return await handler.abort("blockedbyclient");
          }
          const response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 12000 });
          if (response.status() >= 300 && response.status() < 400) throw new Error(`Redirect blocked: ${url.pathname}`);
          if (favicon && response.headers()["content-type"]?.split(";")[0].trim() !== "image/svg+xml") throw new Error("Favicon type changed");
          await handler.fulfill({ response });
        } catch (error) { if (!closing) { result.errors.push(error.message); await handler.abort("blockedbyclient").catch(() => {}); } }
      });
      const page = await context.newPage();
      page.on("pageerror", error => result.errors.push(error.message));
      await page.goto(`${app}/legacy-table-controls`, { waitUntil: "domcontentloaded", timeout: 20000 });
      const button = page.getByRole("button", { name: "Book table", exact: true });
      await button.waitFor({ timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const name = page.getByRole("textbox", { name: "Booking customer name", exact: true });
      if (await name.inputValue()) throw new Error("Booking name must remain empty for read-only click validation");
      await button.evaluate(node => { window.__bookClick = null; node.addEventListener("click", event => { window.__bookClick = { trusted: event.isTrusted, at: performance.now() }; }, { once: true }); });
      await button.scrollIntoViewIfNeeded();
      result.beforeHover = await button.evaluate(inspect);
      try { await button.hover({ timeout: 1800 }); result.hover = true; } catch (error) { result.hoverError = error.message; }
      result.afterHover = await button.evaluate(inspect);
      result.screenshot = path.join(output, `${theme}-${width}-book-table.png`);
      await page.screenshot({ path: result.screenshot, animations: "disabled" });
      try { await button.click({ timeout: 1800 }); } catch (error) { result.clickError = error.message; }
      result.trustedClick = await page.evaluate(() => window.__bookClick?.trusted === true);
      result.afterClick = await button.evaluate(inspect);
      result.workspaceInNormalFlow = result.afterClick.workspace?.position === "static";
      result.passed = result.hover && result.trustedClick && result.afterHover.unobscured && !result.writes.length && !result.errors.length && !result.blockedReads.length;
    } catch (error) { result.errors.push(error.stack || error.message); result.passed = false; }
    finally { closing = true; await context.close(); }
    console.log(`${phase} ${theme} ${width}px: hover=${result.hover} click=${result.trustedClick} passed=${result.passed}`);
  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { cases: report.cases.length, passed: report.cases.filter(result => result.passed).length, failed: report.cases.filter(result => !result.passed).length, errors: report.errors.length, forwardedBusinessWrites: 0 };
  await fs.writeFile(path.join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: path.join(output, "results.json"), ...report.summary }, null, 2));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
