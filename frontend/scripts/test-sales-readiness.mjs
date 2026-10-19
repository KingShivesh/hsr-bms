import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const stage=process.argv[2]||"after",api="http://127.0.0.1:8006",origin=`http://127.0.0.1:${stage==="before"?5180:5181}`;
const output=`../docs/ui-readiness/sales/detail-${stage}`;await fs.mkdir(output,{recursive:true});
const report={stage,samples:[],pagination:[],errors:[],writes:0};
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try {
  for(const theme of ["dark","light"]) {
    const auth=await fetch(api+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json());
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
    await context.addInitScript(({auth,theme})=>{localStorage.setItem("theme",theme);for(const k of ["token","role","username"])localStorage.setItem(k,auth[k]);},{auth,theme});
    await context.route(api+"/reports/history",handler=>handler.fulfill({json:Array.from({length:1000},(_,i)=>({id:99001+i,nm:i?`QA Customer ${i}`:"W".repeat(100),tbl:"T1",ts:Date.now(),date:"18/10/2026",dur:1200,ply:12345678.99,famt:0,tot:12345678.99,payment_method:"Cash",tariff_mode:"hourly"}))}));
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    page.on("request",r=>{if(r.url().startsWith(api)&&!["GET","OPTIONS"].includes(r.method()))report.writes++;});
    await page.goto(origin+"/sales");await page.locator(".sales-table tbody tr").first().waitFor();
    if(stage==="after") {
      const seen=new Set();let pages=0;
      const next=page.getByRole("navigation",{name:"Sales pagination"}).getByRole("button",{name:"Next page",exact:true});
      for(;;) {
        const ids=await page.locator(".sales-table tbody tr").evaluateAll(nodes=>nodes.map(n=>n.dataset.receiptId));
        assert.ok(ids.length<=25);for(const id of ids){assert.ok(!seen.has(id));seen.add(id);}pages++;
        if(await next.isDisabled())break;await next.click();
      }
      assert.equal(seen.size,1000);assert.equal(pages,40);report.pagination.push({theme,records:seen.size,pages,maxRowsPerPage:25,duplicates:0});
      const search=page.getByRole("textbox",{name:"Search sales"});await search.fill("QA Customer 999");assert.equal(await page.locator(".sales-table tbody tr").count(),1);
      await search.fill("");assert.equal(await page.locator(".sales-table tbody tr").count(),25);
      await page.getByRole("button",{name:"Open receipt 99001",exact:true}).focus();await page.keyboard.press("Enter");
    } else { report.pagination.push({theme,records:1000,rendered:await page.locator(".sales-table tbody tr").count(),pager:false});await page.locator(".sales-table tbody tr").first().click(); }
    const dialog=page.getByRole("dialog");await dialog.waitFor();
    for(const width of [375,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:width===375?844:1000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
      const metrics=await page.evaluate(measureUi),bounds=await dialog.boundingBox(),close=await dialog.getByRole("button",{name:"Close panel",exact:true}).boundingBox();
      const file=`${theme}-${width}.png`;await page.screenshot({path:`${output}/${file}`,animations:"disabled"});
      report.samples.push({theme,width,file,...metrics,closeVisible:close.x>=bounds.x&&close.x+close.width<=width+1,contrast:await scanRenderedContrast(page,{theme,route:"sales",state:"long-name-receipt"})});
    }
    if(stage==="after") {await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});}
    await context.close();
  }
} finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
const faults=report.samples.filter(s=>s.applicationCrashed||s.overflow||!s.closeVisible||s.contrast.length||s.shortTargets.length||s.invalidCopy.length||s.unlabeledInputs.length||s.contentOverflow.length);
console.log(JSON.stringify({stage,samples:report.samples.length,pagination:report.pagination,faults,errors:report.errors,writes:report.writes},null,2));
if(stage==="after"){assert.equal(faults.length,0);assert.equal(report.errors.length,0);assert.equal(report.writes,0);}
