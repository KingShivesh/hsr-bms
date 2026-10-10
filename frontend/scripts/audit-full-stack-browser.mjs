import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const app = process.env.AUDIT_APP_URL || "http://127.0.0.1:5178";
const api = process.env.AUDIT_API_URL || "http://127.0.0.1:8003";
if (!new URL(app).hostname.match(/^(127\.0\.0\.1|localhost)$/) || !new URL(api).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw new Error("Use disposable local QA only");
const stage = process.env.AUDIT_STAGE || "after";
const dir = path.resolve(`../docs/full-stack-audit/${stage}`);
await fs.mkdir(dir, { recursive: true });
const authResponse = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
if (!authResponse.ok) throw new Error("QA login failed");
const auth = await authResponse.json();
const axe = await fs.readFile(process.env.AXE_SCRIPT || "/tmp/hsr-audit-tools/node_modules/axe-core/axe.min.js", "utf8");
const source = await fs.readFile("src/App.jsx", "utf8");
const routes = [...new Set([...source.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map(m => m[1]))];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, pages: [], crash: [], mobile: [], errors: [], limitations: ["Chromium/local QA; not an exhaustive device or assistive-technology audit"] };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ theme, auth }) => {
      localStorage.setItem("theme", theme);
      if (location.pathname !== "/login") for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { theme, auth });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    for (const route of ["/login", ...routes.filter(r => r !== "/login")]) {
      await page.goto(app + route);
      await page.waitForTimeout(1000);
      await page.locator(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton").waitFor({ state: "hidden" });
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: axe });
      const result = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
        return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) })), passes: r.passes.length, incomplete: r.incomplete.map(v => ({ id: v.id, nodes: v.nodes.length })) };
      });
      const measurements = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
        fonts: [...new Set([...document.querySelectorAll("h1,h2,h3,button,input")].map(e => getComputedStyle(e).fontFamily))],
        nativeScheme: getComputedStyle(document.documentElement).colorScheme,
        title: document.title }));
      const name = route === "/" ? "home" : route.slice(1);
      await page.screenshot({ path: `${dir}/${name}-${theme}.png`, fullPage: true });
      report.pages.push({ route, theme, ...result, ...measurements, screenshot: `${stage}/${name}-${theme}.png` });
      if (["/live-floor", "/bookings", "/cafe-pos", "/settings"].includes(route)) {
        for (const width of [375, 414]) {
          await page.setViewportSize({ width, height: 844 });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          await page.screenshot({ path: `${dir}/${name}-${theme}-${width}.png`, fullPage: true });
          report.mobile.push({ route, theme, width, overflow });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
    }
    await context.close();
    const crashContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await crashContext.addInitScript(({ theme, auth }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { theme, auth });
    const crashPage = await crashContext.newPage();
    await crashPage.route("**/features/sales/SalesPage.jsx*", route => route.fulfill({ status: 503, body: "QA route chunk failure" }));
    await crashPage.goto(app + "/sales");
    await crashPage.waitForTimeout(1500);
    await crashPage.screenshot({ path: `${dir}/route-crash-${theme}.png` });
    report.crash.push({ theme, shellVisible: await crashPage.locator(".shell").count() > 0, alertVisible: await crashPage.getByRole("alert").count() > 0, text: (await crashPage.locator("body").innerText()).slice(0, 1000), screenshot: `${stage}/route-crash-${theme}.png` });
    await crashContext.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(dir, "browser.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ stage, pages: report.pages.length, axeViolations: report.pages.reduce((n, p) => n + p.violations.length, 0), ruleIds: [...new Set(report.pages.flatMap(p => p.violations.map(v => v.id)))], mobileOverflow: report.mobile.filter(v => v.overflow), crash: report.crash, errors: report.errors }, null, 2));
