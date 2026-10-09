import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve("../docs/inline-table-actions-audit");
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const screen of ["floor", "start"]) {
    const rows = [];
    for (const theme of ["light", "dark"]) {
      const columns = [];
      for (const phase of ["before", "after"]) {
        const data = (await fs.readFile(path.join(root, phase, `${screen}-${theme}.png`))).toString("base64");
        columns.push(`<figure><figcaption>${phase} / ${theme}</figcaption><img src="data:image/png;base64,${data}"></figure>`);
      }
      rows.push(`<section>${columns.join("")}</section>`);
    }
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#0b0b0f;color:#fafafa;font-family:Arial,sans-serif}
      h1{font-size:26px;margin:0 0 12px}p{font-size:16px;color:#b4b4bd;margin:0 0 20px}
      section{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
      figure{margin:0}figcaption{font-size:18px;margin-bottom:10px;text-transform:capitalize}img{width:100%;display:block}
      </style><h1>Live Floor / ${screen}</h1><p>Actual browser screenshots. Left: shipped baseline with side workspace. Right: inline controls and full-color status cards. Local-only QA fixtures; time-dependent amounts may differ.</p>${rows.join("")}`);
    await page.screenshot({ path: path.join(root, `${screen}-before-after.png`), fullPage: true });
  }
} finally { await browser.close(); }
