import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const stage = process.argv[2] || "after", api = "http://127.0.0.1:8006";
const origin = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`;
const output = process.env.UI_OUTPUT_DIR || `../docs/ui-readiness/checkout/${stage}`;
await fs.mkdir(output,{recursive:true});
const report = {stage,samples:[],errors:[],settlementRequests:0,recoveryChecks:[]};
const browser = await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try {
  for(const theme of ["dark","light"]) {
    const auth = await fetch(api+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"staff",password:"staff123"})}).then(r=>r.json());
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
    await context.addInitScript(({auth,theme})=>{localStorage.setItem("theme",theme);for(const k of ["token","role","username"])localStorage.setItem(k,auth[k]);},{auth,theme});
    await context.route(/\/sessions\/(stop|checkout-close)\//, handler=>{report.settlementRequests++;return handler.abort();});
    const page = await context.newPage();
    page.on("pageerror",e=>report.errors.push(e.message));
    for(const state of process.env.UI_STATES?.split(",") || ["default","loading","error","empty","partial","extreme"]) {
      let release; const gate = new Promise(resolve=>{release=resolve;});
      await page.route(/\/sessions\/quote\/t1\?/,async handler=>{
        if(state==="loading")await gate;
        if(state==="error")return handler.fulfill({status:500,json:{detail:"QA failure"}});
        if(state==="empty")return handler.fulfill({json:null});
        if(["partial","extreme"].includes(state)) {
          const response=await handler.fetch(),data=await response.json();
          return handler.fulfill({response,json:state==="partial"?{...data,nm:null,session_started_at:null,famt:null}:{...data,nm:"Very long checkout customer name ".repeat(5),tot:12345678.99,total:12345678.99,raw_total:12345678.99,ply:12345678.99}});
        }
        return handler.continue();
      });
      await page.goto(origin+"/live-floor?table=t1&action=checkout");
      const dialog=page.locator(".checkout-panel");await dialog.waitFor();
      if(state==="loading")await dialog.getByRole("status",{name:"Preparing frozen bill"}).waitFor();
      else await page.waitForFunction(()=>!document.querySelector('.checkout-panel .page-skeleton'),null,{timeout:12000});
      await page.evaluate(()=>document.fonts.ready);
      for(const width of [375,768,1024,1440,1920]) {
        await page.setViewportSize({width,height:width===375?844:1000});
        await page.waitForTimeout(150);
        const metrics=await page.evaluate(measureUi);
        const rect=await dialog.boundingBox();
        const retry=!["error","empty"].includes(state)||await dialog.getByRole("button",{name:/retry/i}).count()>0;
        const file=`${theme}-${width}-${state}.png`;
        await page.screenshot({path:`${output}/${file}`,animations:"disabled"});
        report.samples.push({theme,width,state,file,...metrics,withinViewport:rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.height<=(width===375?844:1000)+1,retry,contrast:await scanRenderedContrast(page,{theme,state,route:"checkout"})});
      }
      release();await page.unrouteAll({behavior:"wait"});
      if(stage==="after"&&["error","empty"].includes(state)) {
        await dialog.getByRole("button",{name:"Retry quote",exact:true}).click();
        await dialog.getByText("Payment method",{exact:true}).waitFor();
        assert.equal(await dialog.getByRole("alert").count(),0);
        report.recoveryChecks.push({theme,state,quoteReloaded:true,settlementRequests:report.settlementRequests});
      }
      console.log(`${stage} checkout ${theme} ${state}`);
    }
    await context.close();
  }
} finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
const faults=report.samples.filter(r=>!r.withinViewport||!r.retry||r.overflow||r.shortTargets.length||r.clipped.length||r.invalidCopy.length||r.unlabeledButtons.length||r.unlabeledInputs.length||r.contrast.length);
console.log(JSON.stringify({stage,samples:report.samples.length,faults,errors:report.errors,settlementRequests:report.settlementRequests},null,2));
if(stage==="after"){assert.equal(faults.length,0);assert.equal(report.errors.length,0);assert.equal(report.settlementRequests,0);}
