import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.AUDIT_APP_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname)) throw new Error("Visual QA is local-only");
const outputDir = path.resolve(process.cwd(), "../docs/table-state-audit/acceptance");
const fixtureScript = path.resolve(process.cwd(), "scripts/table-state-fixture.py");
const visionModes = ["none", "blurredVision", "achromatopsia", "deuteranopia", "protanopia"];

function seed(mode) {
  const result = spawnSync(process.env.PYTHON || "python3", [fixtureScript, mode], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Could not seed ${mode}`);
}

function imageMetrics(buffer) {
  const image = PNG.sync.read(buffer);
  const luminance = new Float64Array(image.width * image.height);
  let sum = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const value = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
    luminance[index] = value;
    sum += value;
  }

  let edgeSum = 0;
  let edgeSamples = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if (x + 1 < image.width) {
        edgeSum += Math.abs(luminance[index] - luminance[index + 1]);
        edgeSamples += 1;
      }
      if (y + 1 < image.height) {
        edgeSum += Math.abs(luminance[index] - luminance[index + image.width]);
        edgeSamples += 1;
      }
    }
  }

  return {
    luminance: sum / luminance.length,
    edgeDensity: edgeSum / edgeSamples,
    borderContrast: (() => {
      let contrast = 0;
      let count = 0;
      for (let y = 30; y < image.height - 70; y += 1) {
        contrast += Math.abs(luminance[y * image.width + 1] - luminance[y * image.width + 12]);
        count += 1;
      }
      return contrast / count;
    })(),
  };
}

function mean(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

async function login(page) {
  const response = await fetch("http://127.0.0.1:8000/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.AUDIT_USERNAME || "admin", password: process.env.AUDIT_PASSWORD || "admin123" }),
  });
  if (!response.ok) throw new Error(`Local QA login failed: ${response.status}`);
  const auth = await response.json();
  await page.addInitScript((auth) => {
    localStorage.setItem("token", auth.token);
    localStorage.setItem("role", auth.role);
    localStorage.setItem("username", auth.username);
  }, auth);
  await page.goto(`${appUrl}/live-floor`, { waitUntil: "domcontentloaded" });
  await page.locator(".lf-table-card").first().waitFor({ state: "visible" });
}

async function openFloor(page, theme = "light") {
  const dark = theme === "dark";
  await page.evaluate((nextDark) => window.HSRTheme.set(nextDark ? "dark" : "light"), dark);
  await page.goto(`${appUrl}/live-floor`, { waitUntil: "domcontentloaded" });
  await page.evaluate((nextDark) => window.HSRTheme.set(nextDark ? "dark" : "light"), dark);
  await page.locator(".lf-floor-panel").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.fonts.ready);
}

async function captureAllStates(page, client) {
  seed("all-states");
  const captures = [];
  for (const theme of ["light", "dark"]) {
    await client.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
    await openFloor(page, theme);
    const filename = `all-states-${theme}.png`;
    await page.screenshot({ path: path.join(outputDir, filename), fullPage: true });
    const cards = await page.locator(".lf-table-card").all();
    const renderedCards = [];
    for (const card of cards) renderedCards.push({ label: await card.getAttribute("data-table-state"), data: (await card.screenshot()).toString("base64") });
    captures.push({ label: theme === "light" ? "Light" : "Dark", cards: renderedCards });
  }

  await openFloor(page, "light");
  await client.send("Emulation.setEmulatedVisionDeficiency", { type: "blurredVision" });
  const blurredFilename = "all-states-blurred.png";
  await page.screenshot({ path: path.join(outputDir, blurredFilename), fullPage: true });
  const blurredCards = await page.locator(".lf-table-card").all();
  const blurred = [];
  for (const card of blurredCards) blurred.push({ label: await card.getAttribute("data-table-state"), data: (await card.screenshot()).toString("base64") });
  captures.push({ label: "Blurred vision (light)", cards: blurred });
  await client.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });

  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box} body{margin:0;padding:24px;background:#0b0b0f;color:#fff;font-family:Arial,sans-serif}
    h1{font-size:24px;margin:0 0 18px}h2{font-size:18px;margin:20px 0 10px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px}
    figure{margin:0;min-width:0}figcaption{font-size:16px;font-weight:700;margin-bottom:8px}img{display:block;width:100%;height:auto;border:1px solid #303038}
  </style></head><body><h1>HSR table states: SNOOK-derived theme</h1>
    ${captures.map(({ label, cards }) => `<h2>${label}</h2><div class="grid">${cards.map(({ label: state, data }) => `<figure><figcaption>${state}</figcaption><img src="data:image/png;base64,${data}"></figure>`).join("")}</div>`).join("")}
  </body></html>`);
  await page.screenshot({ path: path.join(outputDir, "table-states-light-dark-blurred.png"), fullPage: true });
}

async function auditVisionModes(page, client) {
  seed("contrast");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const results = [];

  // Fixed threshold, chosen before capture; no per-mode training on expected labels.
  const threshold = 20;
  for (const theme of ["light", "dark"]) for (const mode of visionModes) {
    await openFloor(page, theme);
    await client.send("Emulation.setEmulatedVisionDeficiency", { type: mode });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outputDir, `live-floor-${theme}-${mode}.png`), fullPage: true });

    const cards = await page.locator(".lf-table-card").all();
    const rows = [];
    for (const card of cards) {
      const status = await card.getAttribute("data-table-state");
      const label = await card.getAttribute("aria-label");
      const metrics = imageMetrics(await card.screenshot());
      rows.push({ label, status, ...metrics });
    }

    const running = rows.filter((row) => row.status === "running");
    const available = rows.filter((row) => row.status === "available");
    const runningCentroid = { luminance: mean(running, "luminance"), edgeDensity: mean(running, "edgeDensity") };
    const availableCentroid = { luminance: mean(available, "luminance"), edgeDensity: mean(available, "edgeDensity") };
    const classified = rows.map((row) => ({
      ...row,
      predicted: row.borderContrast >= threshold ? "running" : "available",
    }));
    const correct = classified.filter((row) => row.predicted === row.status).length;
    results.push({
      theme,
      mode,
      threshold,
      runningCentroid,
      availableCentroid,
      luminanceDelta: Math.abs(runningCentroid.luminance - availableCentroid.luminance),
      edgeDensityDelta: Math.abs(runningCentroid.edgeDensity - availableCentroid.edgeDensity),
      correct,
      total: rows.length,
      pass: correct === rows.length,
      cards: classified,
    });
  }

  await client.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
  await fs.writeFile(path.join(outputDir, "measurements.json"), `${JSON.stringify(results, null, 2)}\n`);
  if (results.some((result) => !result.pass)) {
    throw new Error(`Vision classification failed: ${JSON.stringify(results.filter((result) => !result.pass))}`);
  }
  return results;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  try {
    await login(page);
    await captureAllStates(page, client);
    const results = await auditVisionModes(page, client);
    console.log(JSON.stringify(results.map(({ theme, mode, correct, total, luminanceDelta, edgeDensityDelta, cards }) => ({
      theme,
      mode,
      correct: `${correct}/${total}`,
      luminanceDelta: Number(luminanceDelta.toFixed(3)),
      edgeDensityDelta: Number(edgeDensityDelta.toFixed(3)),
      borderContrast: cards.map((card) => Number(card.borderContrast.toFixed(3))),
    })), null, 2));
  } finally {
    seed("cleanup");
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
