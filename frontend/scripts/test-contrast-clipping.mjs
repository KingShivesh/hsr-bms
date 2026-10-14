import { chromium } from "playwright";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
  await page.setContent(`<style>body{height:2000px;background:#000}aside{position:fixed;top:50px;left:20px;width:450px;height:300px;background:linear-gradient(white,white);color:#000;font:14px sans-serif}.scroll{height:200px;overflow:auto}.spacer{height:250px}.bad{color:#ddd}.hidden{color:white}</style><aside role="dialog" aria-modal="true"><div class="scroll"><p class="hidden">Clipped low contrast</p><div class="spacer"></div><p>Visible good contrast</p><p class="bad">Visible low contrast</p><div class="spacer"></div></div></aside>`);
  await page.evaluate(() => { scrollTo(0, 700); document.querySelector(".scroll").scrollTop = 275; });
  const rows = await scanRenderedContrast(page, { route: "fixture", theme: "light", state: "fixed-scrolled-dialog" });
  assert.equal(rows.some(row => row.text === "Clipped low contrast"), false);
  assert.equal(rows.some(row => row.text === "Visible good contrast"), false);
  assert.equal(rows.some(row => row.text === "Visible low contrast"), true);
  console.log(JSON.stringify({ clippedTextExcluded: true, fixedModalPixelOffsetCorrect: true, realVisibleViolationDetected: true }));
} finally { await browser.close(); }
