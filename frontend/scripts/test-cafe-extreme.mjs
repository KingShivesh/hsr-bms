/* global process, URL, console, window, document, localStorage, getComputedStyle, fetch, AbortSignal */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

// Uses existing immutable previews only. Never builds or starts a server.
// node frontend/scripts/test-cafe-extreme.mjs [before|after] (default: before)
// The after stage is configured for the parent; do not run it until authorized.
// CAFE_EXTREME_WIDTHS/THEMES and CAFE_EXTREME_REPORT_PATH support bounded retries.
const stage = process.argv[2] || "before";
if (!["before", "after"].includes(stage) || process.argv.length > 3) throw new Error("Use before or after");
const origins = { before: "http://127.0.0.1:5180", after: "http://127.0.0.1:5181" };
const app = origins[stage];
const api = "http://127.0.0.1:8006";
const widths = [...new Set((process.env.CAFE_EXTREME_WIDTHS || "375,768,1024,1440,1920").split(",").map(Number))];
const themes = [...new Set((process.env.CAFE_EXTREME_THEMES || "light,dark").split(","))];
if (!widths.length || widths.some(width => !Number.isInteger(width) || width < 320 || width > 3840)) throw new Error("Invalid widths");
if (!themes.length || themes.some(theme => !["light", "dark"].includes(theme))) throw new Error("Invalid themes");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.resolve(root, process.env.CAFE_EXTREME_REPORT_PATH || `docs/ui-readiness/cafe-extreme/${stage}/results.json`);
const hundredNames = ["W".repeat(100), ...Array.from({ length: 99 }, (_, index) => `QA Veg Snack ${String(index + 2).padStart(3, "0")}`)];
const report = {
  startedAt: new Date().toISOString(), stage, app, api, widths, themes, cases: [], findings: [], errors: [],
  safety: { actualLocalAuthPosts: 0, forwardedBrowserApiRequests: 0, forwardedBusinessWrites: 0, blockedWrites: [], blockedOrigins: [], blockedWebSockets: 0 },
  method: {
    hundredItems: "100 distinct Veg Snacks names, including 100 unbroken W characters; all prices 10; GET food stats/orders are empty arrays",
    cartPopulation: "Native menu-card element.click(), invoking each real React handler exactly once; no direct React state or DOM content edits",
    reachability: "Real page.mouse.wheel vertical scrolling over the visible order-region edge; no scrollIntoView, style changes, fake layout, submit clicks or order POSTs",
    screenshots: "Full-page captures retain the full natural cart layout. Selected footer viewport images show the actual scroll endpoint.",
    largeAmount: "Separate one-line browser menu fixture priced at 12345678.99, at 375 and 1440px where selected",
    limitations: "UI fixture tests only, not settlement/backend success. Offscreen JS menu clicks intentionally bypass pointer hit-testing. No after-stage comparison is inferred from a before run.",
  },
};
function guardedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || ![app, api].includes(url.origin)) throw new Error(`Disallowed origin: ${url.origin}`);
  return url;
}
guardedUrl(app); guardedUrl(api);
const numericMoney = value => Number(String(value).replace(/[^\d.-]/g, ""));
function check(result, name, passed, details) {
  const entry = { name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) };
  result.checks.push(entry);
  if (!entry.passed) report.findings.push({ scenario: result.scenario, theme: result.theme, width: result.width, ...entry });
}
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  do { if (await predicate()) return true; await delay(60); } while (Date.now() < end);
  return false;
}
function fixture(pathname, auth, menu) {
  const reads = {
    "/settings/menu": menu, "/food/stats": [], "/food/orders": [],
    "/ready": { status: "ready" }, "/health": { status: "ok" },
    "/auth/me": { role: auth.role, username: auth.username },
    "/reports/summary": { sale: 0, cust: 0, food: 0, active_tables: 0, sessions: 0, avg_time: 0, top_table: "-" },
    "/product/context": { version: 1, profile: { name: "HSR QA browser fixture", logo: "", address: "", phone: "", gst: "", upiId: "" } },
    "/product/setup": { setup: { dismissed: true, collapsed: true }, steps: [{ id: "fixture", done: false }] },
    "/sessions/alerts": { alerts: [], owner_summaries: [], config: {} },
    "/sessions/live-floor": { floor: { sessions: [] }, active_sessions: [], tables: [], summary: {}, attention: [] },
  };
  return reads[pathname];
}
async function authenticate() {
  const response = await fetch(`${api}/auth/login`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.UI_QA_USERNAME || "admin", password: process.env.UI_QA_PASSWORD || "admin123" }),
  });
  report.safety.actualLocalAuthPosts += 1;
  if (!response.ok) throw new Error(`Local QA login failed: HTTP ${response.status}`);
  const auth = await response.json();
  if (!auth.token || auth.role !== "admin" || !auth.username) throw new Error("An actual local QA admin login is required");
  return auth;
}

async function openCase(browser, auth, result, menu) {
  const context = await browser.newContext({ viewport: { width: result.width, height: result.width === 375 ? 844 : 1000 }, colorScheme: result.theme, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false, timezoneId: "Asia/Kolkata" });
  const state = { reads: [], writes: [], unknownReads: [], pageErrors: [], consoleErrors: [], closing: false };
  await context.addInitScript(({ app, auth, theme }) => {
    if (window.location.origin !== app) return;
    localStorage.clear(); localStorage.setItem("theme", theme);
    for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
  }, { app, auth, theme: result.theme });
  await context.routeWebSocket("**/*", socket => { report.safety.blockedWebSockets += 1; socket.close(); });
  await context.route("**/*", async handler => {
    const request = handler.request();
    const method = request.method();
    let url;
    try { url = guardedUrl(request.url()); }
    catch (error) { report.safety.blockedOrigins.push({ method, url: request.url().split("?")[0], reason: error.message }); await handler.abort("blockedbyclient"); return; }
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const headers = { "access-control-allow-origin": app, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE", "cache-control": "no-store" };
    try {
      if (method === "OPTIONS") { await handler.fulfill({ status: 204, headers }); return; }
      if (!["GET", "HEAD"].includes(method)) {
        const entry = { method, pathname, origin: url.origin, disposition: "blocked-not-forwarded" };
        state.writes.push(entry); report.safety.blockedWrites.push({ ...entry, theme: result.theme, width: result.width, scenario: result.scenario });
        await handler.fulfill({ status: 409, headers, json: { detail: "QA blocked this business write; no order was sent." } }); return;
      }
      if (url.origin === api) {
        state.reads.push({ method, pathname, disposition: "browser-fixture" });
        if (pathname === "/events/stream") { await handler.fulfill({ status: 204, headers }); return; }
        const body = fixture(pathname, auth, menu);
        if (body === undefined) state.unknownReads.push({ method, pathname });
        await handler.fulfill({ status: body === undefined ? 404 : 200, headers, json: body ?? { detail: "Unconfigured browser fixture; not forwarded" } }); return;
      }
      const favicon = request.resourceType() === "other" && url.origin === app && url.pathname === "/favicon.svg" && !url.search;
      const sourcePath = /^\/(?:src|node_modules|@vite|@react-refresh|@fs|@id)(?:\/|$)/.test(url.pathname);
      if (sourcePath || (!favicon && !["document", "script", "stylesheet", "font", "image", "manifest"].includes(request.resourceType()))) {
        state.unknownReads.push({ method, pathname, reason: "Non-built-preview read blocked" }); await handler.abort("blockedbyclient"); return;
      }
      const response = await handler.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      if (response.status() >= 300 && response.status() < 400) throw new Error("Preview redirect blocked");
      if (favicon && response.headers()["content-type"]?.split(";")[0].trim() !== "image/svg+xml") throw new Error("Favicon must remain an SVG asset");
      await handler.fulfill({ response });
    } catch (error) { if (!state.closing) { state.pageErrors.push(`Interception: ${error.message}`); await handler.abort("failed").catch(() => {}); } }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => state.pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") state.consoleErrors.push(message.text()); });
  page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
  return { page, state, async close() { state.closing = true; await context.close(); } };
}

async function measure(page) {
  return page.locator(".food-cart-panel").evaluate(panel => {
    const box = node => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowX: style.overflowX, overflowY: style.overflowY, position: style.position };
    };
    const textBox = node => {
      if (!node) return null;
      const range = document.createRange(); range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { text: node.textContent.trim(), left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom: rect.bottom };
    };
    const within = (child, parent) => !!child && !!parent && child.left >= parent.left - 1 && child.right <= parent.right + 1;
    const panelBox = box(panel);
    const lines = [...panel.querySelectorAll(".cart-line")].map((line, index) => {
      const rect = box(line), name = line.querySelector(".cart-line-name"), actions = box(line.querySelector(".cart-line-actions")), price = line.querySelector(".cart-line-price");
      const nameBox = box(name), nameStyle = name ? getComputedStyle(name) : null;
      const priceBox = box(price), paintedPrice = textBox(price);
      return { index, name: name?.textContent.trim(), quantity: Number(line.querySelector("input[type=number]")?.value), rect, nameBox, nameTitle: name?.getAttribute("title"), nameTextOverflow: nameStyle?.textOverflow,
        nameOverflowContained: !!nameStyle && ["hidden", "clip"].includes(nameStyle.overflowX), actions, price: price?.textContent.trim(), priceBox, paintedPrice,
        internalOverflowPx: Math.max(0, rect.scrollWidth - rect.clientWidth), lineWithinPanel: within(rect, panelBox), actionsWithinLine: within(actions, rect), priceWithinLine: within(paintedPrice, rect) };
    });
    const total = panel.querySelector(".food-cart-grand-total"), money = total?.querySelector("strong"), totalBox = box(total), moneyBox = box(money), moneyText = textBox(money), label = total?.querySelector("span");
    const labelText = textBox(label);
    const overlap = !!moneyText && !!labelText && moneyText.left < labelText.right - 1 && moneyText.top < labelText.bottom && moneyText.bottom > labelText.top;
    const submit = panel.querySelector(".primary-action-btn");
    const scrollContainers = [];
    for (let node = submit?.parentElement; node; node = node.parentElement) {
      const rect = box(node);
      if (rect.scrollHeight > rect.clientHeight + 1 && ["auto", "scroll"].includes(rect.overflowY)) scrollContainers.push({ tag: node.tagName, className: node.className, ...rect, scrollTop: node.scrollTop });
    }
    return { viewport: { width: window.innerWidth, height: window.innerHeight }, page: { scrollX: window.scrollX, scrollY: window.scrollY, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, height: document.documentElement.scrollHeight },
      panel: panelBox, lines, listHeight: lines.length ? lines.at(-1).rect.bottom - lines[0].rect.top : 0,
      itemText: panel.querySelector(".food-cart-total small")?.textContent.trim(), total: { row: totalBox, money: moneyBox, paintedMoney: moneyText, text: money?.textContent.trim(), moneyWithinRow: within(moneyText, totalBox), labelOverlap: overlap },
      submit: { rect: box(submit), text: submit?.textContent.trim(), disabled: submit?.disabled, display: submit ? getComputedStyle(submit).display : null }, scrollContainers };
  });
}

async function scrollToSubmit(page) {
  const viewport = page.viewportSize();
  const region = await page.locator(".cafe-order-region").boundingBox();
  if (!region) throw new Error("Order region is not rendered");
  const hoverTarget = {
    x: Math.max(1, Math.min(viewport.width - 26, region.x + region.width - 8)),
    y: Math.max(1, Math.min(viewport.height - 100, region.y + region.height - 8)),
  };
  await page.mouse.move(hoverTarget.x, hoverTarget.y);
  const history = [];
  let stationary = 0;
  let previousTop;
  for (let step = 0; step <= 120; step += 1) {
    const state = await page.locator(".food-cart-panel .primary-action-btn").evaluate(button => {
      const rect = button.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const target = document.elementFromPoint(center.x, center.y);
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, scrollY: window.scrollY,
        viewportHeight: window.innerHeight, viewportWidth: window.innerWidth, centerHit: target === button || button.contains(target),
        fullyVisible: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth };
    });
    history.push({ step, ...state });
    if (state.centerHit && state.fullyVisible) return { reached: true, method: "real-mouse-wheel", hoverTarget, wheelEvents: step, state, history };
    stationary = previousTop !== undefined && Math.abs(state.top - previousTop) < 0.5 ? stationary + 1 : 0;
    previousTop = state.top;
    if (stationary >= 4 || step === 120) return { reached: false, method: "real-mouse-wheel", hoverTarget, wheelEvents: step, state, history };
    await page.mouse.wheel(0, Math.round(viewport.height * 0.85));
    await delay(45);
  }
}

async function emptyTabRecovery(page, result, expectedMenuItems) {
  const cafe = page.locator(".cafe-pos-page");
  for (const [tab, title] of [["Food Stats", "No food orders yet"], ["Order History", "No standalone food orders yet"]]) {
    await cafe.locator(".cafe-pos-tabs").getByRole("button", { name: tab, exact: true }).click();
    const empty = cafe.locator(".empty-state").filter({ hasText: title });
    await empty.waitFor();
    check(result, `${tab} has its fixture-empty state`, await empty.getByText(title, { exact: true }).isVisible());
    await empty.getByRole("button", { name: "New Order", exact: true }).click();
    const recovered = await until(async () => await cafe.locator(".food-menu-card").count() === expectedMenuItems);
    check(result, `${tab} empty-state New Order returns to menu`, recovered && await cafe.locator(".food-cart-panel").isVisible() && await cafe.locator(".cart-line").count() === 0);
  }
}

async function viewItemsAndCountMath(page, result) {
  const panel = page.locator(".food-cart-panel");
  const link = panel.getByRole("link", { name: "100+ items · View items", exact: true });
  await link.click();
  const focus = await panel.locator("#food-cart-items").evaluate(node => ({ focused: document.activeElement === node, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, label: node.getAttribute("aria-label") }));
  result.viewItemsFocus = focus;
  check(result, "100+ View items actually focuses the scrollable item list", focus.focused && focus.scrollHeight > focus.clientHeight && focus.label === "Order items", focus);
  const snapshot = () => panel.evaluate(node => ({
    lines: node.querySelectorAll(".cart-line").length,
    count: [...node.querySelectorAll(".cart-qty-control input")].reduce((sum, input) => sum + Number(input.value), 0),
    label: node.querySelector(".food-cart-total small")?.textContent.trim(),
    total: node.querySelector(".food-cart-grand-total strong")?.textContent.trim(),
    viewItems: !!node.querySelector(".food-cart-items-link"),
  }));
  const matches = (value, count, lines) => value.lines === lines && value.count === count && value.label === `${count} items` && Math.abs(numericMoney(value.total) - count * 10) < 0.001 && value.viewItems === (count >= 100);
  check(result, "View items preserves 100-line count and money", matches(await snapshot(), 100, 100));
  const firstName = hundredNames[0];
  await panel.getByRole("button", { name: `Increase ${firstName} quantity`, exact: true }).click();
  check(result, "101 items still means 100 distinct lines and 1010 rupees", await until(async () => matches(await snapshot(), 101, 100)));
  await panel.getByRole("button", { name: `Decrease ${firstName} quantity`, exact: true }).click();
  check(result, "Decrement restores 100 items and 1000 rupees", await until(async () => matches(await snapshot(), 100, 100)));
  await panel.getByRole("button", { name: `Decrease ${firstName} quantity`, exact: true }).click();
  check(result, "99-item boundary hides View items and shows 990 rupees", await until(async () => matches(await snapshot(), 99, 99)));
  await page.getByRole("button", { name: `Add ${firstName} to order`, exact: true }).evaluate(node => node.click());
  check(result, "Native menu click restores the 100-item boundary and total", await until(async () => matches(await snapshot(), 100, 100)));
  result.finalCart = await snapshot();
}

async function runCase(browser, auth, theme, width, scenario) {
  const large = scenario === "large-amount";
  const names = large ? ["QA large amount display"] : hundredNames;
  const price = large ? 12345678.99 : 10;
  const expectedTotal = large ? 12345678.99 : 1000;
  const menu = Object.fromEntries(names.map(name => [name, { price, category: "Veg Snacks", available: true }]));
  const result = { scenario, theme, width, expected: { lines: names.length, items: names.length, total: expectedTotal }, checks: [], screenshots: [] };
  report.cases.push(result);
  let session;
  try {
    session = await openCase(browser, auth, result, menu);
    const { page } = session;
    await page.goto(`${app}/cafe-pos`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.locator(".food-menu-card").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    check(result, "All fixture menu cards render", await page.locator(".food-menu-card").count() === names.length);
    if (!large) await emptyTabRecovery(page, result, names.length);
    result.nativeMenuClicks = await page.locator(".food-menu-card").evaluateAll(nodes => { for (const node of nodes) node.click(); return nodes.length; });
    check(result, "Expected cart line count", await until(async () => await page.locator(".food-cart-panel .cart-line").count() === names.length));
    await page.locator('.food-cart-panel input[placeholder="Customer name"]').fill("QA local cart only");
    await delay(120);
    const initial = await measure(page);
    result.beforeScroll = initial;
    const actualNames = initial.lines.map(line => line.name);
    check(result, "Each distinct item added exactly once", actualNames.length === names.length && new Set(actualNames).size === names.length && names.every(name => actualNames.includes(name)) && initial.lines.every(line => line.quantity === 1));
    check(result, "Item count matches local cart", initial.lines.reduce((sum, line) => sum + line.quantity, 0) === names.length && initial.itemText === `${names.length} item${names.length === 1 ? "" : "s"}`, { itemText: initial.itemText });
    check(result, "Exact displayed total", Math.abs(numericMoney(initial.total.text) - expectedTotal) < 0.001, { displayed: initial.total.text, expected: expectedTotal });
    check(result, "No page-level horizontal overflow", initial.page.documentWidth <= width + 1 && initial.page.bodyWidth <= width + 1, initial.page);
    const overflowLines = initial.lines.filter(line => line.internalOverflowPx > 1 || !line.lineWithinPanel || !line.actionsWithinLine || !line.priceWithinLine);
    check(result, "No cart-line internal overflow", overflowLines.length === 0, overflowLines);
    check(result, "Total money is bounded and does not overlap its label", initial.total.moneyWithinRow && !initial.total.labelOverlap, initial.total);
    check(result, "Submit is present and enabled after a real customer input", !!initial.submit.rect && !initial.submit.disabled && initial.submit.display !== "none", initial.submit);
    const visibleText = await page.locator(".cafe-pos-page").innerText();
    check(result, "No NaN or Infinity in rendered Cafe", !/\b(?:NaN|Infinity)\b|₹\s*∞/.test(visibleText));
    result.reachability = await scrollToSubmit(page);
    check(result, "Submit reachable by real vertical wheel scrolling", result.reachability.reached, { wheelEvents: result.reachability.wheelEvents, endpoint: result.reachability.state });
    result.afterScroll = await measure(page);
    check(result, "Scrolling leaves all quantities and total unchanged", result.afterScroll.lines.every(line => line.quantity === 1) && Math.abs(numericMoney(result.afterScroll.total.text) - expectedTotal) < 0.001);
    const directory = path.join(path.dirname(reportPath), theme);
    await fs.mkdir(directory, { recursive: true });
    const full = path.join(directory, `${width}-${scenario}-full-cart.png`);
    await page.screenshot({ path: full, fullPage: true, animations: "disabled", timeout: 20000 });
    result.screenshots.push({ kind: "full-natural-page-and-cart", path: full });
    if ([375, 1440].includes(width)) {
      const footer = path.join(directory, `${width}-${scenario}-submit-viewport.png`);
      await page.screenshot({ path: footer, fullPage: false, animations: "disabled" });
      result.screenshots.push({ kind: "real-wheel-endpoint", path: footer });
    }
    if (!large) await viewItemsAndCountMath(page, result);
  } catch (error) {
    result.error = error.stack || error.message;
    report.errors.push({ scenario, theme, width, message: result.error });
  } finally {
    if (session) {
      result.reads = session.state.reads; result.blockedWrites = session.state.writes;
      result.unknownReads = session.state.unknownReads; result.pageErrors = session.state.pageErrors; result.consoleErrors = session.state.consoleErrors;
      check(result, "No browser business-write attempt", result.blockedWrites.length === 0, result.blockedWrites);
      check(result, "No unconfigured fixture reads", result.unknownReads.length === 0, result.unknownReads);
      check(result, "No browser runtime/interception errors", result.pageErrors.length === 0, result.pageErrors);
      check(result, "No browser console errors", result.consoleErrors.length === 0, result.consoleErrors);
      await session.close();
    }
  }
  console.log(`${stage} ${theme} ${width}px ${scenario}: ${result.checks.filter(item => item.passed).length}/${result.checks.length} checks`);
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
let browser;
try {
  const auth = await authenticate();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
  for (const theme of themes) for (const width of widths) await runCase(browser, auth, theme, width, "hundred-items");
  for (const theme of themes) for (const width of widths.filter(value => [375, 1440].includes(value))) await runCase(browser, auth, theme, width, "large-amount");
} catch (error) { report.errors.push({ kind: "fatal", message: error.stack || error.message }); }
finally {
  if (browser) await browser.close().catch(error => report.errors.push({ kind: "browser-close", message: error.message }));
  report.finishedAt = new Date().toISOString();
  report.summary = { cases: report.cases.length, findings: report.findings.length, errors: report.errors.length, screenshots: report.cases.reduce((sum, result) => sum + result.screenshots.length, 0), forwardedBusinessWrites: report.safety.forwardedBusinessWrites, businessSuccessClaims: 0 };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, ...report.summary }, null, 2));
  if (report.findings.length || report.errors.length) process.exitCode = 1;
}
