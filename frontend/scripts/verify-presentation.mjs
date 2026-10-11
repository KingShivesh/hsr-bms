import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const app = process.env.POLISH_APP_URL || "http://127.0.0.1:5177";
const api = process.env.POLISH_API_URL || "http://127.0.0.1:8003";
for (const url of [app, api]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Local QA only");
const stage = process.env.POLISH_STAGE || "before";
const directory = path.resolve(`../docs/presentation-polish/${stage}`);
await fs.mkdir(directory, { recursive: true });
const authResponse = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(authResponse.status, 200);
const auth = await authResponse.json();
const source = await fs.readFile("src/App.jsx", "utf8");
const routes = [...new Set([...source.matchAll(/<Route\s+path="([^"*][^"]*)"/g)].map(match => match[1]))];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { stage, generatedAt: new Date().toISOString(), routes: [], errors: [], keyboard: [], interactions: [] };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => {
      localStorage.setItem("theme", theme);
      if (location.pathname !== "/login") for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
    }, { auth, theme });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("requestfailed", request => {
      if (request.url().startsWith(api) && !request.url().includes("/events/stream") && request.failure()?.errorText !== "net::ERR_ABORTED") report.errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    for (const route of routes) {
      await page.goto(app + route);
      await page.waitForTimeout(700);
      await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
      await page.evaluate(() => document.fonts.ready);
      const widths = [1440, ...(["/dashboard", "/live-floor", "/bookings", "/customers", "/sales", "/cafe-pos", "/inventory", "/settings"].includes(route) ? [375, 414] : [])];
      for (const width of widths) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.waitForTimeout(150);
        const measurement = await page.evaluate(() => {
          const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden" && !node.closest(".sr-only,[aria-hidden=true]");
          const fontSizes = new Set();
          const weights = new Set();
          const offScale = [];
          for (const node of document.querySelectorAll("body *")) {
            if (!visible(node) || node.closest("svg") || ![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) continue;
            const style = getComputedStyle(node);
            const size = parseFloat(style.fontSize);
            fontSizes.add(size); weights.add(style.fontWeight);
            if (![11,13,14,16,20,24,32].includes(size)) offScale.push({ text: node.textContent.trim().slice(0,60), size, className: node.className });
          }
          const controls = [...document.querySelectorAll("button,input:not([type=checkbox]):not([type=radio]),select,textarea")].filter(visible);
          const rows = [...document.querySelectorAll("tbody tr")].filter(visible).slice(0,5).map(node => Math.round(node.getBoundingClientRect().height));
          return { overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), fontSizes: [...fontSizes].sort((a,b)=>a-b), weights: [...weights], offScale, rows,
            unsharedControls: controls.filter(node => !node.matches(".ui-button,.ui-input,.ui-select,.ui-textarea")).map(node => ({ tag:node.tagName, label:node.textContent.trim().slice(0,50) })),
            topbarHeight: document.querySelector(".cf-topbar")?.getBoundingClientRect().height,
            palette: { canvas: getComputedStyle(document.body).getPropertyValue("--surface-base").trim(), accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(), font: getComputedStyle(document.body).fontFamily } };
        });
        report.routes.push({ route, theme, width, ...measurement });
        await page.screenshot({ path: `${directory}/${route.slice(1)}-${theme}-${width}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(app + "/live-floor?action=start&table=t1");
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${directory}/start-dialog-${theme}.png` });
    if (stage === "before") await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.keyboard.press("Meta+k");
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("Search commands").fill("inventory");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/inventory");
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    report.keyboard.push({ theme, metaK: true, ctrlK: true, arrowsEnter: true, escape: true });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${directory}/measurements.json`, JSON.stringify(report, null, 2));
}
assert.equal(report.errors.length, 0);
if (stage === "after") {
  const faults = report.routes.filter(row => row.overflow || row.offScale.length || row.unsharedControls.length);
  assert.equal(faults.length, 0, JSON.stringify(faults.map(row => ({ route: row.route, theme: row.theme, width: row.width, overflow: row.overflow, offScale: row.offScale, unsharedControls: row.unsharedControls }))));
}
console.log(JSON.stringify({ stage, samples: report.routes.length, errors: report.errors, keyboard: report.keyboard }));
