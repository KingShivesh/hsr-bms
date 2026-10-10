import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const app = process.env.CONTRAST_APP_URL || "http://127.0.0.1:5175";
const api = process.env.CONTRAST_API_URL || "http://127.0.0.1:8002";
const stage = process.env.THEME_AUDIT_STAGE || "after";
const directory = path.resolve(`../docs/theme-contrast-audit/${stage}`);
await fs.mkdir(directory, { recursive: true });
const source = await fs.readFile("src/App.jsx", "utf8");
const routes = [...new Set([...source.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map(m => m[1]))];
const auth = await (await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) })).json();
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, routes, violations: [], gradients: [], errors: [], cards: [], login: [], screenshots: [] };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(e.message));
    page.on("requestfailed", r => { if (r.url().startsWith(api) && !r.url().includes("/events/stream") && r.failure()?.errorText !== "net::ERR_ABORTED") report.errors.push(`${r.url()}: ${r.failure()?.errorText}`); });
    await page.addInitScript(theme => { localStorage.setItem("theme", theme); localStorage.setItem("darkMode", String(theme === "dark")); }, theme);
    for (const route of ["/login", ...routes.filter(r => r !== "/login")]) {
      if (route !== "/login") await page.addInitScript(auth => { for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, auth);
      await page.goto(app + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await page.locator(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton").waitFor({ state: "hidden" });
      if (route === "/live-floor") await page.locator(".lf-table-card").last().waitFor();
      await page.evaluate(() => document.fonts.ready);
      report.violations.push(...await scanRenderedContrast(page, { route, theme, state: "default" }));
      report.gradients.push(...await page.locator("h1,h2,p,button,input,small").evaluateAll(els => els.filter(e => {
        if (!e.getBoundingClientRect().width) return false;
        for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).backgroundImage !== "none") return true;
        return false;
      }).map(e => ({ text: e.textContent.slice(0, 60), selector: e.className }))).then(items => items.map(i => ({ route, theme, ...i }))));
      const name = route === "/" ? "dashboard" : route.slice(1);
      await page.screenshot({ path: path.join(directory, `${name}-${theme}.png`), fullPage: true });
      report.screenshots.push(`${stage}/${name}-${theme}.png`);
      if (route === "/login") {
        report.login.push(await page.locator(".login-title,.cf-login-copy h2,.login-showcase-footer small").evaluateAll(els => els.map(e => ({ text: e.textContent, color: getComputedStyle(e).color }))));
        await page.route("**/auth/login", r => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Invalid credentials" }) }));
        await page.getByTestId("username-input").fill("QA invalid");
        await page.getByTestId("password-input").fill("QA invalid");
        await page.getByTestId("login-button").click();
        await page.getByText("Invalid username or password", { exact: true }).waitFor();
        report.violations.push(...await scanRenderedContrast(page, { route, theme, state: "login-error-and-filled-inputs" }));
        await page.screenshot({ path: path.join(directory, `login-error-${theme}.png`), fullPage: true });
        await page.unroute("**/auth/login");
      }
      if (route === "/live-floor") report.cards.push({ theme, cards: await page.locator(".lf-table-card").evaluateAll(els => els.map(e => ({ state: e.dataset.tableState, background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }))) });
    }
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ stage, routes: routes.length, violations: report.violations.length, errors: report.errors, uniqueFailures: [...new Set(report.violations.map(v => `${v.theme} ${v.route} ${v.selector} ${v.kind} ${v.ratio} ${v.text}`))], gradientTextCount: report.gradients.length }, null, 2));
process.exitCode = report.violations.length || report.errors.length ? 2 : 0;
