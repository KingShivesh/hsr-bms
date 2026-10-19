import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const stages = (process.argv[2] || "both") === "both" ? ["before", "after"] : [process.argv[2]];
assert.ok(stages.every(stage => ["before", "after"].includes(stage)));
const api = "http://127.0.0.1:8006", output = "../docs/ui-readiness/shared";
await fs.mkdir(output, { recursive: true });
const report = { samples: [], behavior: [], errors: [], forwardedBusinessWrites: 0 };
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const stage of stages) for (const theme of ["light", "dark"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({username:"admin",password:"admin123"}) }).then(response => response.json());
    const context = await browser.newContext({ viewport: {width:1440,height:1000}, reducedMotion:"reduce" });
    await context.addInitScript(({auth,theme}) => { localStorage.setItem("theme",theme); for (const key of ["token","role","username"]) localStorage.setItem(key,auth[key]); },{auth,theme});
    await context.route(url => url.origin === api, handler => ["GET","HEAD","OPTIONS"].includes(handler.request().method()) ? handler.continue() : handler.fulfill({status:409,json:{detail:"QA blocked this write"}}));
    const page = await context.newPage(); page.on("pageerror",error=>report.errors.push({stage,theme,message:error.message}));
    await page.goto(`http://127.0.0.1:${stage === "before" ? 5180 : 5181}/customers`);
    const card = page.locator(".op2-customer-card").first(); await card.waitFor(); await card.focus(); await card.press("Enter");
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    const scrollLocked = await page.evaluate(()=>getComputedStyle(document.body).overflow === "hidden");
    for (const width of [375,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:width===375?844:1000}); await page.evaluate(()=>document.fonts.ready);
      const close = dialog.getByRole("button",{name:"Close panel",exact:true}); await close.focus(); await close.hover(); await page.waitForTimeout(450);
      let tooltip;
      if (stage === "after") tooltip = await page.getByRole("tooltip").boundingBox();
      else tooltip = await close.evaluate(node=>{const button=node.getBoundingClientRect(),style=getComputedStyle(node,"::after"),height=parseFloat(style.height);return {x:button.right-parseFloat(style.width),y:button.top-8-height,width:parseFloat(style.width),height};});
      const tooltipInViewport = !!tooltip && tooltip.x>=0 && tooltip.y>=0 && tooltip.x+tooltip.width<=width+1 && tooltip.y+tooltip.height<=(width===375?844:1000)+1;
      const file=`${stage}-${theme}-${width}-tooltip.png`; await page.screenshot({path:`${output}/${file}`,animations:"disabled"});
      report.samples.push({stage,theme,width,file,tooltip,tooltipInViewport,scrollLocked,...await page.evaluate(measureUi),contrast:await scanRenderedContrast(page,{route:"customers",theme,state:"shared-tooltip"})});
      if(stage==="after") { assert.ok(tooltipInViewport); assert.ok(scrollLocked); }
      await page.mouse.move(0,0); await dialog.locator("h2").click();
    }
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent("hsr:action-failed",{detail:"QA request failed. Please try again."})));
    const toast=page.locator(".app-toast-error").filter({hasText:"QA request failed"}); await toast.waitFor(); await page.waitForTimeout(200);
    const toastInDialog = await toast.evaluate(node=>!!node.closest('[role="dialog"]'));
    await page.screenshot({path:`${output}/${stage}-${theme}-error-toast.png`,animations:"disabled"});
    await page.waitForTimeout(6100);
    const errorPersists = await toast.isVisible();
    let dismissible=false,keyboardReachable=false;
    if(stage==="after") {
      const dismiss=toast.getByRole("button",{name:"Dismiss notification"});
      await dismiss.focus(); keyboardReachable=await dismiss.evaluate(node=>document.activeElement===node);
      await dismiss.press("Enter"); await toast.waitFor({state:"hidden"}); dismissible=true;
      assert.ok(errorPersists && toastInDialog && keyboardReachable);
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({state:"hidden"}); await page.waitForTimeout(150);
    const restored=await page.evaluate(()=>getComputedStyle(document.body).overflow!=="hidden");
    report.behavior.push({stage,theme,scrollLocked,errorPersistsAfter6100ms:errorPersists,toastInDialog,keyboardReachable,dismissible,scrollRestored:restored});
    if(stage==="after") assert.ok(restored);
    await context.unrouteAll({behavior:"wait"}); await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2)); }
assert.equal(report.errors.length,0);
console.log(JSON.stringify({samples:report.samples.length,behavior:report.behavior,errors:report.errors},null,2));
