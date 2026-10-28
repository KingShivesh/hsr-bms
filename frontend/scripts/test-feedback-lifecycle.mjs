import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";

const app = "http://127.0.0.1:5182", output = process.env.UI_FEEDBACK_OUTPUT_DIR || "../docs/ui-readiness/feedback-lifecycle";
await fs.mkdir(output, {recursive:true});
const report = {checks:[],errors:[],scope:"Isolated real-component lifecycle tests, not business-action success",businessWrites:0,diagnostics:[],isolation:"Vite reload/update/prune messages are recorded but not applied; component code and lifecycle assertions are unchanged."};
const browser = await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try {
  for(const theme of ["light","dark"]) {
    const context = await browser.newContext({viewport:{width:375,height:844}});
    await context.addInitScript(theme=>localStorage.setItem("theme",theme),theme);
    await context.route(url=>url.port==="8006",handler=>handler.fulfill({json:{status:"ready"}}));
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
    page.setDefaultTimeout(10000);
    const diagnostic={theme,step:"setup",status:"running",documents:[],devMessages:[],heldHmrMessages:[]};report.diagnostics.push(diagnostic);
    await context.routeWebSocket(url=>url.origin===app.replace("http:","ws:"),socket=>{
      const server=socket.connectToServer();
      server.onMessage(message=>{
        let event;try{event=JSON.parse(message.toString());}catch{socket.send(message);return;}
        if(["full-reload","update","prune"].includes(event.type)){diagnostic.heldHmrMessages.push({event,at:Date.now(),step:diagnostic.step});return;}
        socket.send(message);
      });
    });
    page.on("framenavigated",frame=>{if(frame===page.mainFrame())diagnostic.documents.push({url:frame.url(),at:Date.now(),step:diagnostic.step});});
    page.on("console",message=>{if(/vite|optimizing|reload|outdated/i.test(message.text()))diagnostic.devMessages.push({text:message.text(),at:Date.now(),step:diagnostic.step});});
    try {
    await page.goto(app+"/login");
    // A first dynamic import can restart Vite's dependency optimizer and reload the
    // document. Warm it before mounting the isolated root or starting any clock.
    for(let attempt=0;attempt<2;attempt++){
      try{await page.evaluate(async()=>{await import("/scripts/feedback-fixtures.jsx");});await page.waitForLoadState("networkidle");await page.waitForTimeout(750);break;}
      catch(error){if(attempt===1)throw error;await page.waitForLoadState("domcontentloaded");}
    }
    await page.evaluate(async()=>{ const fixture=await import("/scripts/feedback-fixtures.jsx"); fixture.mountFeedbackFixture(); });
    await page.getByRole("button",{name:"Open QA dialog"}).waitFor();
    await page.evaluate(()=>{
      window.__toastLifecycleTrace=[];
      const trace=(kind,target)=>window.__toastLifecycleTrace.push({kind,at:performance.now(),target:target?.outerHTML?.slice(0,240),active:document.activeElement?.outerHTML?.slice(0,240),toasts:[...document.querySelectorAll(".app-toast")].map(node=>({message:node.querySelector(".app-toast-message")?.textContent,exiting:node.classList.contains("is-exiting"),focused:node.contains(document.activeElement)}))});
      for(const kind of ["focusin","focusout","pointerover","pointerout"])document.addEventListener(kind,event=>{if(event.target.closest?.(".app-toast"))trace(kind,event.target);},true);
      let previous="";new MutationObserver(()=>{const current=[...document.querySelectorAll(".app-toast")].map(node=>`${node.textContent}:${node.className}`).join("|");if(current!==previous){previous=current;trace("toast-dom-change");}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
    });
    async function show(message,type,options){await page.mouse.move(0,0);await page.evaluate(({message,type,options})=>window.__notify(message,type,options),{message,type,options});await page.getByText(message,{exact:true}).waitFor();}
    diagnostic.step="success-default";
    await show("QA success","success");await page.waitForTimeout(3600);assert.ok(await page.getByText("QA success",{exact:true}).isVisible());await page.getByText("QA success",{exact:true}).waitFor({state:"hidden",timeout:1500});
    diagnostic.step="information-default";await show("QA information","info");await page.waitForTimeout(5600);assert.ok(await page.getByText("QA information",{exact:true}).isVisible());await page.getByText("QA information",{exact:true}).waitFor({state:"hidden",timeout:1500});
    diagnostic.step="persistent-error";await show("QA failure","error");await page.waitForTimeout(6100);assert.ok(await page.getByText("QA failure",{exact:true}).isVisible());
    await page.screenshot({path:`${output}/${theme}-manual-error.png`,animations:"disabled"});
    const contrast=await scanRenderedContrast(page,{theme,route:"component-lifecycle",state:"error-toast"});assert.equal(contrast.length,0);
    await page.locator(".app-toast-error").getByRole("button",{name:"Dismiss notification"}).click();await page.getByText("QA failure",{exact:true}).waitFor({state:"hidden"});
    diagnostic.step="hover-pause";await show("QA hover pause","success");const hovered=page.locator(".app-toast").filter({hasText:"QA hover pause"});await page.waitForTimeout(2500);await hovered.hover();await page.waitForTimeout(5000);assert.ok(await hovered.isVisible());await page.mouse.move(0,0);await hovered.waitFor({state:"hidden",timeout:2500});
    diagnostic.step="focused-undo";
    await page.evaluate(()=>window.__notify("QA undo","success",{duration:5000,actionLabel:"Undo",onAction:()=>window.__undoCalls++}));const undo=page.locator(".app-toast").filter({hasText:"QA undo"}).getByRole("button",{name:"Undo",exact:true});await undo.waitFor();await undo.focus();await page.waitForTimeout(5500);assert.ok(await undo.isVisible());await undo.press("Enter");assert.equal(await page.evaluate(()=>window.__undoCalls),1);
    diagnostic.step="dialog-relocation";await page.evaluate(()=>window.__showModal(true));await page.getByRole("dialog",{name:"QA lifecycle"}).waitFor();await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.body.style.overflow),"hidden");
    await page.evaluate(()=>window.__notify("QA relocation","success",{duration:700,actionLabel:"Details"}));const relocating=page.locator(".app-toast").filter({hasText:"QA relocation"});await relocating.getByRole("button",{name:"Details",exact:true}).focus();await page.waitForTimeout(100);
    await page.evaluate(()=>{const node=document.querySelector('#qa-feedback-fixture ~ .ui-overlay [role="dialog"]') || [...document.querySelectorAll('[role="dialog"]')].at(-1);const overlay=node.closest(".ui-overlay");window.__exitMs=null;window.__exitPhaseObserved=false;const start=performance.now();const observer=new MutationObserver(()=>{if(overlay.getAttribute("data-exiting")==="true")window.__exitPhaseObserved=true;if(!node.isConnected){window.__exitMs=performance.now()-start;observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["data-exiting"]});window.__showModal(false);});await page.waitForFunction(()=>Number.isFinite(window.__exitMs));assert.equal(await page.evaluate(()=>window.__exitPhaseObserved),true,"In-page observer must see the exiting phase");const exitMs=await page.evaluate(()=>window.__exitMs);assert.ok(exitMs>=100&&exitMs<250,`Measured in-page exit: ${exitMs}ms`);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),"hidden");
    await relocating.waitFor({state:"hidden",timeout:1800});
    report.checks.push({theme,successDefault4000ms:true,infoDefault6000ms:true,errorVisibleAfter6100ms:true,hoverSurvives5000ms:true,focusedUndoSurvives5500ms:true,undoCalls:1,exitMs,scrollRestored:true,focusedToastResumesAfterHostCloses:true,contrast});
    diagnostic.status="pass";
    }catch(error){diagnostic.status="fail";diagnostic.error=error.stack||error.message;diagnostic.fixturePresent=await page.locator("#qa-feedback-fixture").count().then(count=>count===1).catch(()=>false);diagnostic.failureKind=diagnostic.fixturePresent?"component-assertion":"fixture-document-replaced";await page.screenshot({path:`${output}/${theme}-failure.png`,animations:"disabled"}).catch(()=>{});}
    finally{diagnostic.trace=await page.evaluate(()=>window.__toastLifecycleTrace||[]).catch(()=>[]);await context.close();}
  }
}finally{await browser.close();await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));assert.equal(report.errors.length,0);assert.ok(report.diagnostics.every(row=>row.status==="pass"),"Lifecycle assertion failed; inspect diagnostics in results.json");
