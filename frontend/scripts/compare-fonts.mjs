import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const app = process.env.POLISH_APP_URL || "http://127.0.0.1:5177";
const api = process.env.POLISH_API_URL || "http://127.0.0.1:8003";
for (const url of [app, api]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const fontPath = process.env.INTER_PREVIEW_FONT || "/tmp/hsr-inter-preview/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
const font = (await fs.readFile(fontPath)).toString("base64");
const authResponse = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
assert.equal(authResponse.status, 200);
const auth = await authResponse.json();
const directory = path.resolve("../docs/presentation-polish/font-comparison");
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = { method: "Browser-only Inter injection. Same local app, data, colors, type sizes, and spacing. DM Mono numbers retained in both variants. No application dependency or font token changed.", samples: [] };
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    await context.addInitScript(({ auth, theme }) => { localStorage.setItem("theme", theme); for (const key of ["token", "role", "username"]) localStorage.setItem(key, auth[key]); }, { auth, theme });
    const page = await context.newPage();
    for (const route of ["/dashboard", "/live-floor", "/settings"]) {
      for (const width of [1440, ...(route === "/dashboard" ? [375] : [])]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.goto(app + route);
        await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(node => node.getClientRects().length));
        await page.evaluate(() => document.fonts.ready);
        if (route === "/dashboard") await page.locator(".ops-kpi-lead-value strong").waitFor();
        for (const variant of ["syne", "inter"]) {
          if (variant === "inter") {
            await page.addStyleTag({ content: `@font-face { font-family: "Inter Comparison"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-style: normal; font-display: block; } :root, body { --font-sans: "Inter Comparison", sans-serif !important; --font-family: "Inter Comparison", sans-serif !important; } body { font-family: "Inter Comparison", sans-serif !important; }` });
            await page.evaluate(() => document.fonts.load('500 14px "Inter Comparison"'));
            await page.evaluate(() => document.fonts.ready);
          }
          await page.waitForTimeout(250);
          const measurement = await page.evaluate(() => {
            const select = selector => [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).slice(0, 8).map(node => {
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(node);
              return { text: node.textContent.trim().slice(0, 70), font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, width: rect.width, height: rect.height, textWidth: range.getBoundingClientRect().width };
            });
            return { bodyFont: getComputedStyle(document.body).fontFamily, canvas: getComputedStyle(document.body).backgroundColor, overflow: document.documentElement.scrollWidth - innerWidth, titles: select("h1,h2,.topbar-title"), labels: select(".ops-kpi-top span,.form-label,.sb-label"), numbers: select(".ops-kpi-lead-value strong,.ops-kpi > strong,.lf-table-rate") };
          });
          assert.equal(measurement.overflow, 0);
          if (route === "/dashboard") assert.ok(measurement.numbers.length, "Comparison must show actual KPI content, not an error state");
          const filename = `${route.slice(1)}-${theme}-${width}-${variant}.png`;
          await page.screenshot({ path: path.join(directory, filename) });
          report.samples.push({ route, theme, width, variant, filename, ...measurement });
        }
      }
    }
    await context.close();
  }
  const groups = report.samples.filter(row => row.variant === "syne").sort((a,b) => (a.route === "/dashboard" && a.width === 1440 ? -1 : 0) - (b.route === "/dashboard" && b.width === 1440 ? -1 : 0));
  const sections = [];
  for (const row of groups) {
    const other = report.samples.find(item => item.route === row.route && item.theme === row.theme && item.width === row.width && item.variant === "inter");
    const data = async filename => `data:image/png;base64,${(await fs.readFile(path.join(directory, filename))).toString("base64")}`;
    sections.push(`<section><h2>${row.route} / ${row.theme} / ${row.width}px</h2><div class="pair"><figure><figcaption>Current: Syne + DM Mono</figcaption><img src="${await data(row.filename)}"></figure><figure><figcaption>Comparison: Inter + DM Mono</figcaption><img src="${await data(other.filename)}"></figure></div></section>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>HSR font comparison</title><style>body{margin:0;padding:24px;background:#e9e9eb;color:#151519;font:14px system-ui}h1{font-size:24px}h2{font-size:16px;margin:24px 0 12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{font-size:13px;font-weight:600;padding:8px 0}img{width:100%;display:block}section{break-inside:avoid}</style></head><body><h1>Same application. Font is the only variable.</h1><p>Left: approved Syne. Right: Inter preview. DM Mono numbers and existing colors stay unchanged. Preview only, no font switch.</p>${sections.join("")}</body></html>`;
  await fs.writeFile(path.join(directory, "index.html"), html);
  const gallery = await browser.newPage({ viewport: { width: 1800, height: 1450 } });
  await gallery.goto("file://" + path.join(directory, "index.html"));
  await gallery.screenshot({ path: path.join(directory, "dashboard-side-by-side.png"), fullPage: false });
  await fs.writeFile(path.join(directory, "measurements.json"), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
console.log(JSON.stringify({ samples: report.samples.length, comparison: path.join(directory, "index.html"), productionFontsChanged: false }));
