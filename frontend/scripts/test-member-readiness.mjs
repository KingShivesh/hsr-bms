import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { measureUi } from "./ui-readiness-metrics.mjs";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
const stage=process.argv[2]||"after",api="http://127.0.0.1:8006",origin=`http://127.0.0.1:${stage==="before"?5180:5181}`;
const output=`../docs/ui-readiness/customers/detail-${stage}`;
await fs.mkdir(output,{recursive:true});
const report={stage,samples:[],pagination:[],errors:[],writes:0};
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try {
  for(const theme of ["dark","light"]) {
    const auth=await fetch(api+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json());
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
    await context.addInitScript(({auth,theme})=>{localStorage.setItem("theme",theme);for(const k of ["token","role","username"])localStorage.setItem(k,auth[k]);},{auth,theme});
    await context.route(url=>url.origin===api&&/^\/members\/?$/.test(url.pathname),handler=>handler.fulfill({json:Array.from({length:500},(_,i)=>({id:`QA-${i}`,nm:"W".repeat(100),typ:"Regular",vis:5,spt:12345678.99,lst:null,phone:null,current_balance:0}))}));
    await context.route(api+"/members/duplicates",handler=>handler.fulfill({json:[]}));
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    page.on("request",r=>{if(r.url().startsWith(api)&&!["GET","OPTIONS"].includes(r.method()))report.writes++;});
    await page.goto(origin+"/customers");await page.locator(".op2-customer-card").first().waitFor();
    if(stage==="after") {
      const seen=new Set();let pages=0;
      const next=page.getByRole("navigation",{name:"Customers pagination"}).getByRole("button",{name:"Next page",exact:true});
      for(;;) {
        const ids=await page.locator(".op2-customer-card").evaluateAll(nodes=>nodes.map(n=>n.dataset.customerId));
        assert.ok(ids.length<=24);for(const id of ids){assert.ok(!seen.has(id));seen.add(id);}pages++;
        if(await next.isDisabled())break;
        await next.click();
      }
      assert.equal(seen.size,500);assert.equal(pages,21);report.pagination.push({theme,records:seen.size,pages,maxCardsPerPage:24,duplicates:0});
      await page.getByRole("textbox",{name:"Search customers"}).fill("QA-0");
      assert.equal(await page.locator(".op2-customer-card").count(),1);
      await page.getByRole("textbox",{name:"Search customers"}).fill("");
      assert.equal(await page.locator(".op2-customer-card").count(),24);
    }
    await page.locator(".op2-customer-card").first().click();const dialog=page.getByRole("dialog");await dialog.waitFor();
    for(const width of [375,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:width===375?844:1000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
      const metrics=await page.evaluate(measureUi),bounds=await dialog.boundingBox();
      const close=await dialog.getByRole("button",{name:"Close panel",exact:true}).boundingBox();
      const file=`${theme}-${width}.png`;await page.screenshot({path:`${output}/${file}`,animations:"disabled"});
      report.samples.push({theme,width,file,...metrics,closeVisible:close.x>=bounds.x&&close.x+close.width<=width+1,contrast:await scanRenderedContrast(page,{theme,route:"customers",state:"long-name-detail"})});
    }
    if(stage==="after") {
      const controls=dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),summary:visible');
      await controls.last().focus();await page.keyboard.press("Tab");assert.ok(await controls.first().evaluate(n=>document.activeElement===n));
      await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
    }
    await context.close();
  }
} finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
const faults=report.samples.filter(s=>s.overflow||!s.closeVisible||s.contrast.length||s.shortTargets.length||s.invalidCopy.length||s.unlabeledInputs.length||s.contentOverflow.length);
console.log(JSON.stringify({stage,samples:report.samples.length,pagination:report.pagination,faults,errors:report.errors,writes:report.writes},null,2));
if(stage==="after"){assert.equal(faults.length,0);assert.equal(report.errors.length,0);assert.equal(report.writes,0);}
