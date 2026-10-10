import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const output = path.resolve("../docs/table-state-audit");
const app = process.env.AUDIT_APP_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(app).hostname)) throw new Error("Visual QA is local-only");
const routes = ["/dashboard", "/live-floor", "/legacy-table-controls", "/bookings", "/tournaments"];
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = { reference: {}, themes: [], actions: [], mobile: [], errors };

function seed(mode) {
  const result = spawnSync("python3", ["scripts/table-state-fixture.py", mode], { encoding: "utf8" });
  if (result.status) throw new Error(result.stderr);
}

async function open(route, theme = "dark") {
  if (page.url().startsWith(app)) await page.evaluate((dark) => window.HSRTheme.set(dark ? "dark" : "light"), theme === "dark");
  await page.goto(`${app}${route}`, { waitUntil: "domcontentloaded" });
  await page.locator(".table-state-card").first().waitFor({ state: "visible" });
  await page.evaluate((dark) => window.HSRTheme.set(dark ? "dark" : "light"), theme === "dark");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.fonts.load('500 28px "DM Mono"', "0123456789"));
  await page.waitForTimeout(350);
}

try {
  await fs.mkdir(path.join(output, "reference"), { recursive: true });
  await fs.mkdir(path.join(output, "mobile"), { recursive: true });
  const referencePage = await context.newPage();
  await referencePage.goto("https://www.snook.in/#modes", { waitUntil: "domcontentloaded" });
  await referencePage.evaluate(() => document.fonts.ready);
  results.reference = await referencePage.evaluate(() => {
    const style = (element) => {
      const s = getComputedStyle(element);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, background: s.backgroundColor, color: s.color };
    };
    const all = [...document.querySelectorAll("body *")];
    const mono = all.find((el) => getComputedStyle(el).fontFamily.includes("DM Mono"));
    const card = all.find((el) => getComputedStyle(el).backgroundColor === "rgb(17, 17, 22)");
    const accent = all.find((el) => getComputedStyle(el).backgroundColor === "rgb(0, 255, 127)");
    return {
      url: location.href, body: style(document.body), heading: style(document.querySelector("h1")),
      numeric: mono ? style(mono) : null, card: card ? style(card) : null, accent: accent ? style(accent) : null,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content,
    };
  });
  await referencePage.screenshot({ path: path.join(output, "reference/snook-modes.png"), fullPage: false });
  await referencePage.close();

  const response = await fetch("http://127.0.0.1:8000/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.AUDIT_USERNAME || "admin", password: process.env.AUDIT_PASSWORD || "admin123" }),
  });
  if (!response.ok) throw new Error(`Local QA login failed: ${response.status}`);
  const auth = await response.json();
  await context.addInitScript((auth) => {
    localStorage.setItem("token", auth.token);
    localStorage.setItem("role", auth.role);
    localStorage.setItem("username", auth.username);
  }, auth);
  await page.goto(`${app}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator(".ops-kpi-lead").waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  seed("all-states");

  for (const theme of ["light", "dark"]) {
    await open("/dashboard", theme);
    results.themes.push(await page.evaluate((theme) => {
      const body = getComputedStyle(document.body);
      const value = getComputedStyle(document.querySelector(".ops-kpi-lead-value > strong"));
      const label = getComputedStyle(document.querySelector(".ops-kpi-lead .ops-kpi-top > span"));
      const card = getComputedStyle(document.querySelector(".ops-kpi-lead"));
      return {
        theme, font: body.fontFamily, numericFont: value.fontFamily,
        canvas: body.backgroundColor, card: card.backgroundColor, border: card.borderColor,
        accent: body.getPropertyValue("--accent").trim(), valueSize: value.fontSize, valueWeight: value.fontWeight,
        labelSize: label.fontSize, ratio: parseFloat(value.fontSize) / parseFloat(label.fontSize),
        fontsLoaded: document.fonts.check('400 14px "Syne Variable"') && document.fonts.check('500 28px "DM Mono"'),
      };
    }, theme));

    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width < 500 ? 850 : 1000 });
      for (const route of routes) {
        await open(route, theme);
        const measurement = await page.evaluate(() => {
          const title = document.querySelector(".cf-title-block").getBoundingClientRect();
          const actions = document.querySelector(".topbar-right").getBoundingClientRect();
          const sameRow = title.top < actions.bottom && actions.top < title.bottom;
          const sizes = [...document.querySelectorAll(".table-state-primary")].map((el) => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
          });
          return {
            viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            titleOverlapsActions: sameRow && title.right > actions.left + 1,
            primaryTargets: sizes, minPrimaryHeight: Math.min(...sizes.map((r) => r.height)),
          };
        });
        results.mobile.push({ theme, width, route, ...measurement });
        if (width < 500) await page.screenshot({ path: path.join(output, `mobile/${route.slice(1)}-${theme}-${width}.png`), fullPage: true });
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.close();
  for (const route of routes) {
    for (const state of ["available", "running", "paused", "reserved"]) {
      page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await open(route);
      const card = page.locator(`.table-state-card[data-table-state="${state}"]`).first();
      const button = route === "/dashboard" ? card : card.locator(".table-state-primary");
      await button.scrollIntoViewIfNeeded();
      await button.hover();
      const primary = card.locator(".table-state-primary");
      const beforePress = await primary.evaluate((el) => getComputedStyle(el).backgroundColor);
      const box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const pressedAt = Date.now();
      await page.mouse.down();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const afterPress = await primary.evaluate((el) => getComputedStyle(el).backgroundColor);
      const pressFeedbackMs = Date.now() - pressedAt;
      const started = Date.now();
      await page.mouse.up();
      const feedback = state === "available" ? ".lf-new-session, .quick-session-backdrop"
        : state === "running" || state === "paused" ? ".checkout-panel, .checkout-bill-screen, .table-state-primary:disabled"
        : ".op2-board";
      await page.locator(feedback).first().waitFor({ state: "visible", timeout: 10000 });
      results.actions.push({ route, state, feedback, latencyMs: Date.now() - started, pressFeedbackMs, pressFeedbackVisible: beforePress !== afterPress, resultingUrl: page.url() });
      await page.close();
    }
  }
  await fs.writeFile(path.join(output, "acceptance/theme-interaction-measurements.json"), `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.mobile.filter((row) => row.scrollWidth > row.width || row.titleOverlapsActions || row.minPrimaryHeight < 44);
  const feedbackFailures = results.actions.filter((action) => !action.pressFeedbackVisible || action.pressFeedbackMs > 200);
  if (failed.length || errors.length || feedbackFailures.length || results.themes.some((theme) => !theme.fontsLoaded)) throw new Error(JSON.stringify({ failed, errors, feedbackFailures }));
  console.log(JSON.stringify({ reference: results.reference, themes: results.themes, responsiveChecks: results.mobile.length, actions: results.actions, errors }, null, 2));
} finally {
  await fs.writeFile(path.join(output, "acceptance/theme-interaction-measurements.json"), `${JSON.stringify(results, null, 2)}\n`);
  seed("cleanup");
  await browser.close();
}
