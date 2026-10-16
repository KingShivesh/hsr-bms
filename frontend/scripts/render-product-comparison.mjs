import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("../docs/product-shell");
const panels = [];
for (const theme of ["light", "dark"]) {
  for (const state of ["before", "after"]) {
    const png = await fs.readFile(path.join(directory, "verification", `${state}-dashboard-${theme}.png`));
    panels.push(`<section><h2>${state === "before" ? "Before" : "After"} / ${theme}</h2><img src="data:image/png;base64,${png.toString("base64")}" alt="Actual ${state} Dashboard screenshot, ${theme}" /></section>`);
  }
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1840, height: 1550 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><head><style>body{margin:20px;font:14px Arial,sans-serif;background:#fff;color:#18181b}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 18px;color:#52525b}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}h2{font-size:16px;margin:0 0 8px}img{display:block;width:100%;height:auto;border:1px solid #dedee4;box-sizing:border-box}</style></head><body><h1>HSR product shell: actual before / after</h1><p>Local QA screenshots. Original Syne + DM Mono fonts and approved light/dark colors retained. Sample data never enters production.</p><main class="grid">${panels.join("")}</main></body></html>`);
  await page.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({ path: path.join(directory, "comparison.png"), fullPage: true });
  console.log("Rendered comparison.png from the four actual browser screenshots");
} finally { await browser.close(); }
