import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const directory = path.resolve("../docs/empty-state-polish");
const before = JSON.parse(await fs.readFile(path.join(directory, "before/measurements.json")));
const after = JSON.parse(await fs.readFile(path.join(directory, "after/measurements.json")));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const filename = row => `${row.route.slice(1)}-${row.state}-${row.theme}-${row.width}`;
const pairs = after.samples.filter(row => before.samples.some(previous => previous.route === row.route && previous.state === row.state && previous.theme === row.theme && previous.width === row.width));
const styles = "body{margin:0;padding:24px;background:#eee;color:#17171a;font:14px system-ui;letter-spacing:0}main{max-width:1800px;margin:auto}h1{font-size:24px}h2{font-size:16px}p{line-height:1.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{padding:8px 0;font-weight:600}img{width:100%;display:block}section{border-top:1px solid #ccc;margin-top:24px;padding-top:8px}a{color:inherit}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:16px}}";
const entries = pairs.map(row => {
  const name = filename(row);
  return `<section><h2>${escape(row.route)} / ${escape(row.state)} / ${row.theme} / ${row.width}px</h2><div class="pair">${["before", "after"].map(stage => `<figure><figcaption>${stage.toUpperCase()}</figcaption><a href="${stage}/${name}.png"><img src="${stage}/${name}.png" loading="lazy"></a></figure>`).join("")}</div></section>`;
});
await fs.writeFile(path.join(directory, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HSR empty-state evidence</title><style>${styles}</style></head><body><main><h1>HSR: empty-state polish</h1><p>Actual Chrome screenshots in both themes at 1440px, 375px and 414px. Same browser-only fixtures before and after; no records were created. Syne, DM Mono and approved theme tokens remain unchanged.</p><p><a href="README.md">Results and scope</a> · <a href="after/measurements.json">After measurements</a> · <a href="before/measurements.json">Before measurements</a></p>${entries.join("")}</main></body></html>`);
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const sections = [];
  for (const [route, state] of [["/customers", "filtered"], ["/bookings", "filtered"], ["/waitlist", "empty"]]) {
    for (const theme of ["dark", "light"]) {
      const name = filename({ route, state, theme, width: 1440 });
      const images = [];
      for (const stage of ["before", "after"]) {
        const data = await fs.readFile(path.join(directory, stage, `${name}-detail.png`));
        images.push(`<figure><figcaption>${stage.toUpperCase()}</figcaption><img src="data:image/png;base64,${data.toString("base64")}"></figure>`);
      }
      sections.push(`<section><h2>${escape(route)} / ${theme}</h2><div class="pair">${images.join("")}</div></section>`);
    }
  }
  await page.setContent(`<style>${styles}</style><h1>Before / after: empty-state actions and copy</h1><p>Current Syne + DM Mono and approved colors retained. Actual desktop screenshot details.</p>${sections.join("")}`);
  await page.screenshot({ path: path.join(directory, "before-after.png"), fullPage: true });
} finally { await browser.close(); }
console.log(path.join(directory, "index.html"));
