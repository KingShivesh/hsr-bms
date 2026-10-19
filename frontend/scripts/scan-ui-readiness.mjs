import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const route = process.argv[2] || "/dashboard", stage = process.argv[3] || "after";
const origin = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const key = route.replaceAll(/[/?=]/g, "-").replace(/^-/, "");
const output = process.env.UI_OUTPUT_DIR || `../docs/ui-readiness/${key}/${stage}`;
await fs.mkdir(output, { recursive: true });
const domains = {
  "/dashboard": /^\/reports\/dashboard$/, "/live-floor": /^\/sessions\/live-floor$/,
  "/customers": /^\/members(?:\/duplicates)?\/?$/, "/bookings": /^\/(bookings|sessions\/tables)$/,
  "/cafe-pos": /^\/(settings\/menu|sessions\/live-floor|food\/(orders|stats))$/,
  "/sales": /^\/reports\/history$/, "/analytics": /^\/reports\/(summary|history|analytics)$/,
  "/inventory": /^\/(settings\/menu|sessions\/tables)$/,
  "/waitlist": /^\/(waitlist|bookings|sessions\/tables)$/,
  "/legacy-table-controls": /^\/(sessions\/(active|tables|live-floor|maintenance)|waitlist|bookings|settings\/rates|operations\/(gst|current-rate))$/,
  "/tournaments": /^\/tournaments\/?$/, "/daily-closing": /^\/reports\/closing-report$/,
  "/pricing-rules": /^\/operations\//, "/audit-log": /^\/operations\/audit-logs$/,
  "/settings": /^\/settings\/(rates|tariffs|min-session|booking-grace|session-controls)$/,
};
const target = process.env.UI_DATA_PATH ? new RegExp(process.env.UI_DATA_PATH) : domains[route] || (route.startsWith("/settings?") ? /^\/product\// : /^\/ready$/);
const states = process.env.UI_STATES?.split(",") || ["default", "loading", "error", "empty", "partial", "extreme"];
const report = { route, stage, samples: [], errors: [], productionWrites: 0 };
function empty(value, field = "") {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, empty(v,k)]));
  if (typeof value === "number") return /rate|hourly|multiplier/.test(field) ? value : 0;
  return value;
}
function extreme(value, field = "") {
  if (Array.isArray(value)) return value.map(row => extreme(row,field));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,extreme(v,k)]));
  if ((typeof value === "string" || value === null) && /^(nm|name|customer_name|item|player_name|notes|label)$/.test(field)) return "Very long QA name for overflow verification ".repeat(3).trim();
  if (field === "elapsed_seconds") return 72000;
  if (typeof value === "number" && /^(tot|total|revenue|total_revenue|running_total|spend|spt|current_balance)$/.test(field)) return 12345678.99;
  return value;
}
function partial(value, field = "") {
  if (field === "items") return null;
  if (Array.isArray(value)) return value.map(row => partial(row,field));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,partial(v,k)]));
  return /^(phone|notes|nm|customer_name|booking_time|lst|ts|tot|total|revenue|total_revenue|famt|food_rev|spent|play|food|retention_rate|repeat_customers|food_attachment_rate)$/.test(field) ? null : value;
}
const bookingFixture = {id:99001,customer_name:"QA Booking",phone:"9000000000",table_id:"t3",table_type:"SNOOKER",booking_time:"2099-10-18T18:00:00",duration_mins:60,status:"booked"};
const billFixture = {id:99001,nm:"QA Customer",tbl:"T1",ts:Date.now(),date:new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date()),dur:60,ply:320,famt:120,tot:440,payment_method:"Cash",tariff_mode:"hourly"};
function fixture(data, pathname, state) {
  pathname = pathname.replace(/\/$/, "");
  if(pathname === "/product/account" && state === "partial") return {...data, team:null, members:null, tables:null};
  if(pathname === "/operations/audit-logs" && state === "partial") return [{id:99001,ts:null,date:null,staff:null,action:null,detail:null}];
  if(pathname === "/reports/top-customers") return {...data,customers:[{name:"QA Regular",visits:12,play:3200,food:400,spent:3600}]};
  if (!Array.isArray(data)) return data;
  if (pathname === "/bookings" && !data.length) return [bookingFixture];
  if (pathname === "/reports/history" && state === "extreme") return Array.from({length:1000},(_,i)=>({...billFixture,id:99001+i}));
  if (pathname === "/reports/history" && !data.length) return [billFixture];
  if (pathname === "/food/orders" && !data.length) return [{id:99001,customer_name:"QA Counter",date:"18 Oct, 2:00 PM",ts:1792264200000,items:[{item:"QA Samosa",qty:2,price:30}],total:60,payment_method:"Cash"}];
  if (pathname === "/food/stats" && !data.length) return [{name:"QA Samosa",qty:2,revenue:60}];
  if (pathname === "/members" && state === "extreme" && data.length) return Array.from({length:500},(_,i)=>({...data[0],id:`QA-${i}`}));
  return data;
}
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const theme of ["dark", "light"]) {
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({auth,theme,reportTab}) => { localStorage.setItem("theme",theme); if(reportTab)localStorage.setItem("reportsDefaultTab",reportTab); for (const k of ["token","role","username"]) localStorage.setItem(k,auth[k]); }, {auth,theme,reportTab:process.env.UI_REPORT_TAB});
    const page = await context.newPage();
    await context.route(api + "/product/setup", async handler => {
      const response = await handler.fetch(), data = await response.json();
      await handler.fulfill({response, json:{...data,setup:{...data.setup,collapsed:true}}});
    });
    let errors = [];
    page.on("pageerror",e => { errors.push(e.message); report.errors.push({theme,message:e.message}); });
    for (const state of states) {
      let release; const gate = new Promise(resolve => { release = resolve; });
      await page.route(url => url.origin === api && target.test(url.pathname), async handler => {
        const request = handler.request(), pathname = new URL(request.url()).pathname;
        if (request.method() !== "GET") return handler.continue();
        if (state === "loading") { await gate; return handler.continue(); }
        if (state === "error") return handler.fulfill({ status: 500, json: {detail:"QA simulated service failure"} });
        if (state === "default") return handler.continue();
        const response = await handler.fetch(), data = await response.json();
        const payload = state === "empty" ? pathname === "/settings/menu" ? {} : empty(data) : state === "extreme" ? extreme(fixture(data,pathname,state)) : partial(fixture(data,pathname,state));
        return handler.fulfill({ response, json: payload });
      });
      await page.goto(origin + route, {waitUntil:"domcontentloaded"});
      await page.locator(".topbar-title").waitFor();
      let loadingIndicator = true, settled = true;
      if (state === "loading") loadingIndicator = await page.locator(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton").first().waitFor({timeout:3000}).then(()=>true,()=>false);
      else settled = await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(n => n.getClientRects().length), null, {timeout:12000}).then(()=>true,()=>false);
      if (process.env.UI_TAB && state !== "loading") {
        await page.getByRole("button",{name:process.env.UI_TAB,exact:true}).click();
        await page.waitForTimeout(200);
      }
      await page.evaluate(() => document.fonts.ready);
      for (const width of process.env.UI_WIDTHS?.split(",").map(Number) || [375,768,1024,1440,1920]) {
        await page.setViewportSize({width,height:width===375?844:1000});
        await page.waitForTimeout(100);
        await page.mouse.move(0,0);
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const metrics = await page.evaluate(measureUi);
        const viewportOnly = await page.evaluate(()=>document.documentElement.scrollHeight >= 16000);
        const contrast = await scanRenderedContrast(page,{route,theme,state,viewportOnly});
        const file = `${theme}-${width}-${state}.png`;
        const fullPage = ["default","extreme"].includes(state) && await page.evaluate(()=>document.documentElement.scrollHeight < 16000);
        await page.screenshot({path:`${output}/${file}`,animations:"disabled",fullPage});
        const noRequestNeeded = route === "/settings?section=billing" && stage === "after";
        const retry = state === "error" && !noRequestNeeded ? await page.getByRole("button",{name:/retry|try again|check again/i}).count() > 0 : true;
        report.samples.push({theme,width,state,file,...metrics,loadingIndicator,settled,contrast,contrastScope:viewportOnly?"visible viewport only; unpaginated baseline":"all rendered page text",retry,errors:[...errors]});
      }
      release(); await page.unrouteAll({ behavior: "wait" }); errors=[];
      console.log(`${stage} ${route} ${theme} ${state}`);
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2)); }
const faults = report.samples.filter(r => !r.loadingIndicator || !r.settled || r.applicationCrashed || r.overflow || r.contentOverflow.length || r.shortTargets.length || r.clipped.length || r.invalidCopy.length || r.unlabeledButtons.length || r.unlabeledInputs.length || r.brokenImages.length || r.contrast.length || r.errors.length || !r.retry);
console.log(JSON.stringify({route,stage,samples:report.samples.length,faults:faults.map(r=>({theme:r.theme,width:r.width,state:r.state,applicationCrashed:r.applicationCrashed,overflow:r.overflow,contentOverflow:r.contentOverflow,shortTargets:r.shortTargets,clipped:r.clipped,unlabeledInputs:r.unlabeledInputs,contrast:r.contrast,errors:r.errors,retry:r.retry}))},null,2));
if (stage === "after") { assert.equal(faults.length,0); assert.equal(report.errors.length,0); }
