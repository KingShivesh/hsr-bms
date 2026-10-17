import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs/promises";

const directory = "../docs/interaction-polish";
function crop(buffer, width = 560) {
  const source = PNG.sync.read(buffer), target = new PNG({ width, height: source.height });
  PNG.bitblt(source, target, source.width - width, 0, width, source.height, 0, 0);
  return PNG.sync.write(target);
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1152, height: 2300 } });
  const images = [];
  for (const theme of ["dark", "light"]) for (const phase of ["before", "after"]) {
    const buffer = crop(await fs.readFile(`${directory}/${phase}/checkout-adjust-1440-${theme}.png`));
    images.push(`<figure><figcaption>${phase.toUpperCase()} · ${theme}</figcaption><img src="data:image/png;base64,${buffer.toString("base64")}" /></figure>`);
  }
  await page.setContent(`<style>body{margin:0;padding:8px;background:#eee;font:14px system-ui;color:#18181b}main{display:grid;grid-template-columns:560px 560px;gap:8px}figure{margin:0}figcaption{height:28px;padding-top:4px}img{display:block;width:100%}</style><main>${images.join("")}</main>`);
  await page.screenshot({ path: `${directory}/checkout-comparison.png`, fullPage: true });
  for (const theme of ["dark", "light"]) {
    const files = (await fs.readdir(`${directory}/after`)).filter(file => file.startsWith("-") && file.endsWith(`-${theme}.png`)).sort();
    const figures = [];
    for (const file of files) figures.push(`<figure><figcaption>${file.replace(`-${theme}.png`, "").replace(/^-/, "/")}</figcaption><img src="data:image/png;base64,${(await fs.readFile(`${directory}/after/${file}`)).toString("base64")}" /></figure>`);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.setContent(`<style>body{margin:0;padding:12px;background:#eee;font:14px system-ui}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}figcaption{height:24px}img{display:block;width:100%}</style><main>${figures.join("")}</main>`);
    await page.screenshot({ path: `${directory}/all-routes-${theme}.png`, fullPage: true });
  }
} finally { await browser.close(); }
