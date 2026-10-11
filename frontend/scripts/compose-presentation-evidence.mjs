import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const directory = path.resolve("../docs/presentation-polish");
const before = JSON.parse(await fs.readFile(path.join(directory, "before/measurements.json")));
const after = JSON.parse(await fs.readFile(path.join(directory, "after/measurements.json")));
const pairs = after.routes.filter(row => row.route !== "/");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const entries = pairs.map(row => {
  const previous = before.routes.find(item => item.route === row.route && item.theme === row.theme && item.width === row.width);
  const filename = `${row.route.slice(1)}-${row.theme}-${row.width}.png`;
  return `<section id="${filename.slice(0,-4)}"><h2>${escape(row.route)} / ${row.theme} / ${row.width}px</h2><p>Visible text sizes: ${previous.fontSizes.join(", ")} &rarr; ${row.fontSizes.join(", ")} px. Horizontal overflow: ${previous.overflow} &rarr; ${row.overflow} px.</p><div class="pair"><figure><figcaption>Before: untouched main</figcaption><a href="before/${filename}"><img src="before/${filename}" loading="lazy"></a></figure><figure><figcaption>After: shared presentation</figcaption><a href="after/${filename}"><img src="after/${filename}" loading="lazy"></a></figure></div></section>`;
});
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HSR presentation evidence</title><style>body{margin:0;background:#eee;color:#17171a;font:14px system-ui;padding:24px}main{max-width:1800px;margin:auto}h1{font-size:24px}h2{font-size:16px;margin:32px 0 8px}p{line-height:1.5}a{color:inherit}figure{margin:0}figcaption{padding:8px 0;font-size:13px;font-weight:600}img{width:100%;display:block}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{border-top:1px solid #ccc;margin-top:32px}nav{display:flex;gap:16px;flex-wrap:wrap}@media(max-width:700px){body{padding:16px}.pair{grid-template-columns:1fr}}</style></head><body><main><h1>HSR: presentation pass</h1><p>Actual local Chrome screenshots. Same disposable database, approved colors and Syne + DM Mono. Desktop: 1440px. Mobile: 375px / 414px. Inter is a separate preview, not an application font switch.</p><nav><a href="README.md">Results and limitations</a><a href="font-comparison/index.html">Syne / Inter comparison</a><a href="after/measurements.json">After measurements</a><a href="before/measurements.json">Before measurements</a></nav>${entries.join("")}</main></body></html>`;
await fs.writeFile(path.join(directory, "index.html"), html);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1450 } });
  const sections = [];
  for (const theme of ["dark", "light"]) {
    const images = [];
    for (const stage of ["before", "after"]) images.push(`<figure><figcaption>${stage.toUpperCase()} / ${theme.toUpperCase()}</figcaption><img src="data:image/png;base64,${(await fs.readFile(path.join(directory, stage, `dashboard-${theme}-1440.png`))).toString("base64")}"></figure>`);
    sections.push(`<section><h2>Dashboard / ${theme}</h2><div class="pair">${images.join("")}</div></section>`);
  }
  await page.setContent(`<style>body{margin:0;padding:24px;background:#eee;font:14px system-ui}h1{font-size:24px}h2{font-size:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{padding:8px 0;font-weight:600}img{width:100%;display:block}</style><h1>Dashboard: actual before / after</h1>${sections.join("")}`);
  await page.screenshot({ path: path.join(directory, "dashboard-before-after.png"), fullPage: true });
} finally { await browser.close(); }
console.log(path.join(directory, "index.html"));
