import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const stage=process.argv[2]||"after",api="http://127.0.0.1:8006",origin=`http://127.0.0.1:${stage==="before"?5180:5181}`;
const output=`../docs/ui-readiness/bookings/feedback-${stage}`;await fs.mkdir(output,{recursive:true});
const report={stage,checks:[],productionWrites:0};
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try {
  for(const theme of ["light","dark"]) {
    const auth=await fetch(api+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"admin123"})}).then(r=>r.json());
    const page=await browser.newPage({viewport:{width:375,height:844}});
    await page.addInitScript(({auth,theme})=>{localStorage.setItem("theme",theme);for(const k of ["token","role","username"])localStorage.setItem(k,auth[k]);},{auth,theme});
    let release,posts=0;const gate=new Promise(resolve=>{release=resolve;});
    await page.route(api+"/bookings",async handler=>{
      if(handler.request().method()!=="POST")return handler.continue();
      posts++;await gate;return handler.fulfill({status:503,json:{detail:"QA simulated failed creation; no booking saved"}});
    });
    await page.goto(origin+"/bookings");await page.locator(".op2-panel").waitFor();
    const opener=page.getByRole("button",{name:"New Booking",exact:true}).first();await opener.click();
    const dialog=page.getByRole("dialog",{name:"Reserve a table"});await dialog.getByLabel("Customer name",{exact:true}).fill("QA unsaved booking");
    const submit=dialog.getByRole("button",{name:"Create booking",exact:true});
    await submit.evaluate(node=>node.addEventListener("click",()=>{const at=performance.now();const watch=new MutationObserver(()=>{if(node.getAttribute("aria-busy")==="true"){window.__feedbackMs=performance.now()-at;watch.disconnect();}});watch.observe(node,{attributes:true});},{once:true,capture:true}));
    await submit.click();await page.waitForFunction(()=>Number.isFinite(window.__feedbackMs));
    const cancel=dialog.getByRole("button",{name:stage==="before"?"Discard Booking":"Cancel",exact:true});
    const feedbackMs=await page.evaluate(()=>window.__feedbackMs),cancelDisabled=await cancel.isDisabled();
    await page.screenshot({path:`${output}/${theme}-pending.png`,animations:"disabled"});
    await page.keyboard.press("Escape");const escapeBlocked=await dialog.isVisible();
    if(!cancelDisabled)await cancel.click();
    const retainedWhilePending=await dialog.isVisible();release();
    if(stage==="after") {
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.getByLabel("Customer name",{exact:true}).inputValue(),"QA unsaved booking");
      await page.screenshot({path:`${output}/${theme}-failure.png`,animations:"disabled"});
      assert.ok(feedbackMs<200);assert.ok(cancelDisabled&&escapeBlocked&&retainedWhilePending);assert.equal(posts,1);
    }
    report.checks.push({theme,feedbackMs,cancelDisabled,escapeBlocked,retainedWhilePending,posts,actualBookingsSaved:0});
    await page.close();
  }
} finally {await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
