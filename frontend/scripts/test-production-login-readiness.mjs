import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const app = "https://hsr-bms.vercel.app";
const api = "https://hsr-bms-backend.onrender.com";
const output = "../docs/ui-readiness/production-login";
const report = { app, startedAt: new Date().toISOString(), cases: [], errors: [], blockedWrites: [], loginAttempts: 0, scope: "Unauthenticated live deployment; no business writes or credential submissions" };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await context.route("**/*", route => {
      const request = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.blockedWrites.push({ method: request.method(), path: new URL(request.url()).pathname });
        return route.abort("blockedbyclient");
      }
      if (![app, api].includes(new URL(request.url()).origin)) return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 375 ? 844 : 1000 });
      await page.goto(`${app}/login`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("login-button").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(measureUi);
      const contrast = await scanRenderedContrast(page, { theme, route: "/login", state: "live-production-default" });
      const image = `${theme}-${width}.png`;
      await page.screenshot({ path: `${output}/${image}`, fullPage: true, animations: "disabled" });
      report.cases.push({ theme, width, image, ...metrics, contrast });
    }
    await context.close();
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
}
const faults = report.cases.filter(row => row.applicationCrashed || row.overflow || row.shortTargets.length || row.invalidCopy.length || row.brokenImages.length || row.unlabeledButtons.length || row.unlabeledInputs.length || row.contrast.length);
assert.equal(report.cases.length, 10);
assert.equal(faults.length, 0, JSON.stringify(faults));
assert.equal(report.errors.length, 0);
assert.equal(report.blockedWrites.length, 0);
console.log(JSON.stringify({ cases: report.cases.length, faults: faults.length, pageErrors: report.errors.length, credentialSubmissions: 0 }));
