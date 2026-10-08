import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve("../docs/table-state-audit");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const name of ["dashboard", "live-floor", "advanced-controls", "reservations", "tournament"]) {
    const rows = [];
    for (const theme of ["light", "dark"]) {
      const images = [];
      for (const phase of ["before", "after"]) {
        const data = (await fs.readFile(path.join(root, phase, `${name}-${theme}.png`))).toString("base64");
        images.push(`<figure><figcaption>${phase} · ${theme}</figcaption><img src="data:image/png;base64,${data}"></figure>`);
      }
      rows.push(`<section>${images.join("")}</section>`);
    }
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#0b0b0f;color:#fafafa;font-family:Arial,sans-serif}
      h1{font-size:26px;margin:0 0 10px}p{font-size:16px;color:#b4b4bd;margin:0 0 20px}
      section{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
      figure{margin:0;min-width:0}figcaption{font-size:18px;margin-bottom:10px;text-transform:capitalize}
      img{width:100%;display:block;border:1px solid #25252c}
    </style></head><body><h1>${name.replaceAll("-", " ")} | Before and after</h1>
      <p>Same local QA states in both builds. Before: deployed main d5fe8d6. After: SNOOK-derived theme and shared table states.</p>
      ${rows.join("")}</body></html>`);
    await page.screenshot({ path: path.join(root, `${name}-before-after.png`), fullPage: true });
  }
} finally {
  await browser.close();
}
