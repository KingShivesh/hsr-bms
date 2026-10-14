import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const phase = process.env.SPEED_PHASE || "before";
const directory = path.resolve(`../docs/perceived-speed/${phase}`);
await fs.mkdir(directory, { recursive: true });
const api = "http://127.0.0.1:8006";
const auth = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
assert.ok(auth.token);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = { phase, localOnly: true, interactions: [], requests: [], screenshots: [] };
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript(({ auth, theme }) => {
      for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]);
      localStorage.setItem("theme", theme);
      sessionStorage.setItem("hsr:profile", "1");
      window.__speed = [];
      document.addEventListener("pointerdown", event => {
        const button = event.target.closest("button");
        if (!button) return;
        const card = button.closest(".lf-table-card");
        const start = performance.now();
        const before = { label: button.textContent.trim(), status: card?.getAttribute("data-table-state"), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height };
        const row = { ...before, start, frames: [] };
        window.__speed.push(row);
        function sample() {
          const t = performance.now() - start;
          row.frames.push({ ms: +t.toFixed(1), busy: button.getAttribute("aria-busy"), disabled: button.disabled, label: button.textContent.trim(), status: card?.getAttribute("data-table-state"), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height, transform: getComputedStyle(button).transform });
          if (t < 1250) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }, true);
    }, { auth, theme });
    const page = await context.newPage();
    const starts = new Map();
    page.on("request", r => { if (r.url().startsWith(api) && !r.url().includes("events/stream")) starts.set(r, performance.now()); });
    page.on("response", r => { if (starts.has(r.request())) results.requests.push({ theme, path: new URL(r.url()).pathname, method: r.request().method(), status: r.status(), ms: Math.round(performance.now() - starts.get(r.request())) }); });
    await page.goto("http://127.0.0.1:5181/live-floor");
    await page.locator(".lf-table-card").first().waitFor();
    await page.waitForTimeout(2000);
    for (const width of [1440, 375, 414]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
      const file = `floor-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(directory, file), animations: "disabled", fullPage: true });
      results.screenshots.push(file);
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForTimeout(1500);
    await page.route("**/sessions/pause/t1**", async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
    const card = page.locator(".lf-table-card").first();
    const pause = card.getByRole("button", { name: /^(Pause|Resume)$/ });
    await pause.click();
    await page.waitForTimeout(1350);
    results.interactions.push({ theme, action: "pause/resume with 800ms transport delay", frames: (await page.evaluate(() => window.__speed)).at(-1) });
    await page.unroute("**/sessions/pause/t1**");
    const beforeQuote = results.requests.length;
    await card.getByRole("button", { name: "End", exact: true }).click();
    await page.getByText("Payment method", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Add name", exact: true }).click();
    await page.getByLabel("Name (optional)").pressSequentially("Test Name", { delay: 70 });
    await page.waitForTimeout(650);
    results.interactions.push({ theme, action: "type nine-character optional name", requests: results.requests.slice(beforeQuote) });
    await page.keyboard.press("Escape");
    await fs.writeFile(path.join(directory, `profiler-${theme}.json`), JSON.stringify(await page.evaluate(() => window.__hsrProfile || []), null, 2));
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ phase, requests: results.requests, interactions: results.interactions.map(r => ({ ...r, frames: r.frames ? { ...r.frames, frames: r.frames.frames.filter((_, i) => i < 4 || i % 10 === 0) } : undefined })) }, null, 2));
