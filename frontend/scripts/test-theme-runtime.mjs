import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const app = process.env.CONTRAST_APP_URL || "http://127.0.0.1:5175";
const api = process.env.CONTRAST_API_URL || "http://127.0.0.1:8002";
const directory = "../docs/theme-contrast-audit";
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { bootstrap: [], pairs: [], interaction: [], mobile: [], errors: [] };
try {
  for (const test of [
    { scheme: "dark", stored: "light", expected: "light" },
    { scheme: "light", stored: "dark", expected: "dark" },
    { scheme: "light", legacy: "true", expected: "dark" },
    { scheme: "dark", legacy: "false", expected: "light" },
    { scheme: "dark", stored: "invalid", expected: "dark" },
    { scheme: "light", expected: "light" },
    { scheme: "dark", blocked: true, expected: "dark" },
  ]) {
    const context = await browser.newContext({ colorScheme: test.scheme });
    const page = await context.newPage();
    await page.addInitScript(test => {
      if (test.stored) localStorage.setItem("theme", test.stored);
      if (test.legacy) localStorage.setItem("darkMode", test.legacy);
      if (test.blocked) { Storage.prototype.getItem = () => { throw new Error("QA denied storage"); }; Storage.prototype.setItem = () => { throw new Error("QA denied storage"); }; }
    }, test);
    await page.route("**/src/main.jsx*", r => r.abort());
    await page.goto(app + "/login", { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, canvas: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color, appNotMounted: document.getElementById("root").children.length === 0 }));
    assert.equal(result.theme, test.expected);
    assert.equal(result.canvas, test.expected === "dark" ? "rgb(11, 11, 15)" : "rgb(250, 250, 250)");
    assert.ok(result.appNotMounted);
    report.bootstrap.push({ ...test, ...result });
    await context.close();
  }
  const auth = await (await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) })).json();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(auth => { for (const k of ["token", "role", "username"]) if (location.pathname !== "/login") localStorage.setItem(k, auth[k]); }, auth);
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(e.message));
  await page.goto(app + "/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Switch to .* mode/ }).waitFor();
  await page.evaluate(() => window.HSRTheme.set("light"));
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("theme")), "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Switch to light mode" }).waitFor();
  await page.goto(app + "/live-floor", { waitUntil: "domcontentloaded" });
  await page.locator(".lf-table-card").last().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => document.body.classList.contains("dark")), true);
  report.interaction.push("Toggle writes canonical theme; reload and navigation retain it; html/body stay synchronized");
  const other = await context.newPage();
  await other.goto(app + "/login", { waitUntil: "domcontentloaded" });
  await other.evaluate(() => window.HSRTheme.set("light"));
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  report.interaction.push("Second tab preference change synchronizes the open application");
  await other.close();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => window.HSRTheme.set(t), theme);
    const pairs = await page.evaluate(() => {
      const samples = [
        ["--text-primary", "--bg-base", 4.5], ["--text-primary", "--bg-raised", 4.5],
        ["--text-secondary", "--bg-raised", 4.5], ["--text-muted", "--bg-raised", 4.5],
        ["--input-placeholder", "--input-bg", 4.5], ["--text-on-brand", "--action-primary", 4.5],
        ["--status-error-text", "--status-error-bg", 4.5], ["--status-success-text", "--status-success-bg", 4.5],
        ["--status-warning-text", "--status-warning-bg", 4.5], ["--text-disabled", "--bg-surface-hover", 4.5],
        ["--input-border", "--input-bg", 3],
      ];
      const el = document.createElement("span"); document.body.append(el);
      const l = value => {
        const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const result = samples.map(([foreground, background, minimum]) => {
        el.style.color = `var(${foreground})`; el.style.background = `var(${background})`;
        const s = getComputedStyle(el), a = l(s.color), b = l(s.backgroundColor);
        return { foreground, background, color: s.color, fill: s.backgroundColor, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2), minimum };
      });
      el.remove(); return result;
    });
    for (const pair of pairs) assert.ok(pair.ratio >= pair.minimum, JSON.stringify({ theme, ...pair }));
    report.pairs.push({ theme, pairs });
    const cards = await page.locator(".lf-table-card").evaluateAll(els => els.map(e => ({ state: e.dataset.tableState, background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color })));
    const expected = { running: "rgb(220, 38, 38)", available: "rgb(21, 128, 61)", paused: "rgb(180, 83, 9)", reserved: "rgb(37, 99, 235)" };
    for (const [state, fill] of Object.entries(expected)) {
      const card = cards.find(c => c.state === state);
      assert.equal(card?.background, fill, `${theme} ${state} fill changed`);
      assert.equal(card?.color, "rgb(255, 255, 255)");
    }
    report.interaction.push(`${theme}: all four saturated state colors and white foreground preserved`);
  }
  for (const width of [375, 414]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 896 });
    await page.evaluate(t => window.HSRTheme.set(t), theme);
    for (const route of ["/login", "/live-floor"]) {
      if (route === "/login") await page.evaluate(() => localStorage.removeItem("token"));
      await page.goto(app + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      if (route === "/live-floor") await page.locator(".lf-table-card").last().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const violations = await scanRenderedContrast(page, { route, theme, state: `mobile-${width}` });
      assert.equal(violations.length, 0, JSON.stringify(violations));
      await page.screenshot({ path: `${directory}/after/mobile-${route.slice(1)}-${width}-${theme}.png`, fullPage: true });
      report.mobile.push({ width, theme, route, overflow: 0, violations: 0 });
    }
  }
  await context.close();
} finally {
  await browser.close();
  await fs.writeFile(`${directory}/runtime.json`, JSON.stringify(report, null, 2));
}
assert.equal(report.errors.length, 0);
console.log(JSON.stringify(report, null, 2));
