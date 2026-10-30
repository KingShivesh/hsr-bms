import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { scanRenderedContrast } from "./rendered-contrast.mjs";
import { measureUi } from "./ui-readiness-metrics.mjs";

const route = process.argv[2] || "/dashboard", stage = process.argv[3] || "after";
const origin = `http://127.0.0.1:${stage === "before" ? 5180 : 5181}`, api = "http://127.0.0.1:8006";
const key = route.replaceAll(/[/?=]/g, "-").replace(/^-/, "");
const output = process.env.UI_OUTPUT_DIR || `../docs/ui-readiness/${key}/${stage}`;
const strict = process.env.UI_STRICT_PILOT === "true";
await fs.mkdir(output, { recursive: true });
const domains = {
  "/dashboard": /^\/reports\/dashboard$/, "/live-floor": /^\/sessions\/live-floor$/,
  "/customers": /^\/members(?:\/duplicates)?\/?$/, "/bookings": /^\/(bookings|sessions\/tables)$/,
  "/cafe-pos": /^\/(settings\/menu|sessions\/live-floor|food\/(orders|stats))$/,
  "/sales": /^\/(reports\/history|food\/orders)$/, "/analytics": /^\/reports\/(summary|history|analytics)$/,
  "/inventory": /^\/(settings\/menu|sessions\/tables)$/,
  "/waitlist": /^\/(waitlist|bookings|sessions\/tables)$/,
  "/legacy-table-controls": /^\/(sessions\/(active|tables|live-floor|maintenance)|waitlist|bookings|settings\/rates|operations\/(gst|current-rate))$/,
  "/tournaments": /^\/tournaments(?:\/\d+)?\/?$/, "/daily-closing": /^\/reports\/closing-report$/,
  "/pricing-rules": /^\/operations\//, "/audit-log": /^\/operations\/audit-logs$/,
  "/settings": /^\/settings\/(rates|tariffs|min-session|booking-grace|session-controls)$/,
};
const target = process.env.UI_DATA_PATH ? new RegExp(process.env.UI_DATA_PATH) : domains[route] || (route.startsWith("/settings?") ? /^\/product\// : /^\/ready$/);
const states = process.env.UI_STATES?.split(",") || ["default", "loading", "error", "empty", "partial", "extreme"];
const username = process.env.UI_USERNAME || "admin";
const report = { route, stage, username, samples: [], errors: [], productionWrites: 0 };
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
const tournamentFixture = { id: 99001, name: "QA read-only tournament", game_type: "8 Ball", entry_fee: 100, status: "active", winner_name: "", created_at: "28 Oct 2026", players: [{ id: 99001, name: "QA Player One", seed: 1, eliminated: false }, { id: 99002, name: "QA Player Two", seed: 2, eliminated: false }], matches: [{ id: 99001, round_no: 1, match_no: 1, player1: "QA Player One", player2: "QA Player Two", winner: "", status: "scheduled", completed_at: "" }] };
function fixture(data, pathname, state) {
  pathname = pathname.replace(/\/$/, "");
  if (pathname === "/tournaments/99001") return tournamentFixture;
  if (pathname === "/tournaments" && Array.isArray(data) && !data.length) return [tournamentFixture];
  if (pathname === "/waitlist" && Array.isArray(data) && !data.length) return [{ id: 99001, position: 1, customer_name: "QA Waiting Guest", party_size: 2, preferred_type: "ANY", wait_mins: 10, recommended_table: { id: "t3" } }];
  if (state === "partial" && process.env.UI_PARTIAL_NULL_ROWS === "true" && Array.isArray(data) && ["/members", "/members/duplicates", "/bookings", "/food/orders", "/food/stats", "/reports/history"].includes(pathname)) return [null, ...fixture(data, pathname, "default")];
  if (state === "missing-payment" && Array.isArray(data) && ["/reports/history", "/food/orders"].includes(pathname)) return fixture(data, pathname, "default").map(row => ({ ...row, payment_method: null }));
  if (pathname === "/sessions/live-floor" && state === "table-states") {
    const template = data.tables.find(table => table.session).session;
    const states = ["running", "paused", "available", "reserved", "maintenance"];
    const tables = data.tables.map((table, index) => ({ ...table, status_key: states[index], status_label: states[index][0].toUpperCase() + states[index].slice(1), elapsed_seconds: index < 2 ? 7200 : 0, running_total: index < 2 ? 500 : 0,
      session: index < 2 ? { ...template, table_id: table.id, session_key: `qa-ui-state-${table.id}`, customer_name: "QA Current Player", paused: index === 1, elapsed_seconds: 7200, food_items: [] } : null,
      booking: index === 3 ? { customer_name: "QA Reserved Player", booking_time: "2099-10-22T18:00:00+05:30" } : null,
      maintenance: index === 4 ? { reason: "QA maintenance fixture" } : null }));
    return { ...data, tables, ...(data.floor ? { floor: { ...data.floor, tables, summary: { ...data.floor.summary, active_tables: 2, idle_tables: 1 } } } : {}) };
  }
  if (pathname === "/sessions/live-floor" && state === "partial" && process.env.UI_PARTIAL_NULL_ROWS === "true") {
    const inject = tables => [null, ...tables.map(table => table.session ? { ...table, session: { ...table.session, food_items: [null, ...table.session.food_items] } } : table)];
    return { ...data, tables: inject(data.tables), ...(data.floor ? { floor: { ...data.floor, tables: inject(data.floor.tables) } } : {}) };
  }
  if (pathname === "/sessions/live-floor" && state === "partial" && process.env.UI_UNKNOWN_FLOOR_STATUS === "true") {
    const obscure = tables => tables.map((table, index) => index === 2 ? { ...table, status_key: null } : table);
    return { ...data, tables: obscure(data.tables), ...(data.floor ? { floor: { ...data.floor, tables: obscure(data.floor.tables) } } : {}) };
  }
  if(pathname === "/product/account" && state === "partial") return {...data, team:null, members:null, tables:null};
  if(pathname === "/ready" && state === "partial") return {...data, status:null, database:null};
  if(pathname === "/operations/current-rate" && state === "partial") return {...data, is_peak:null, multiplier:null, label:null};
  if(pathname === "/operations/audit-logs" && state === "partial") return [{id:99001,ts:null,date:null,staff:null,action:null,detail:null}];
  if(pathname === "/reports/top-customers") return {...data,customers:[{name:"QA Regular",visits:12,play:3200,food:400,spent:3600}]};
  if (!Array.isArray(data)) return data;
  if (pathname === "/operations/peak-hours" && !data.length) return [{ id: 99001, start_hour: 18, end_hour: 22, multiplier: 1.5, label: "QA Peak Rule" }];
  if (pathname === "/operations/audit-logs" && !data.length) return [{ id: 99001, date: "29 Oct 2026", ts: Date.now(), staff: "QA Staff", action: "qa_read_fixture", detail: "Read-only fixture", severity: "info", amount: 0 }];
  if (pathname === "/reports/session-edits" && state === "extreme") return Array.from({ length: 1000 }, (_, i) => ({ ...fixture(data, pathname, "default")[0], id: 99001 + i }));
  if (pathname === "/reports/session-edits" && !data.length) return [{ id: 99001, date: "22/10/2026", table: "T1", staff: "QA Staff", original_duration: 60, new_duration: 59, reason_label: "Started too early", category: "correction", notes: "QA read fixture", delta: -5 }];
  if (["/food/orders", "/food/stats"].includes(pathname) && state === "extreme") return Array.from({ length: pathname === "/food/orders" ? 1000 : 60 }, (_, i) => ({ ...fixture(data, pathname, "default")[0], id: 99001 + i }));
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
    const auth = await fetch(api + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: process.env.UI_PASSWORD || (username === "staff" ? "staff123" : "admin123") }) }).then(r => r.json());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(({auth,theme,reportTab}) => { localStorage.setItem("theme",theme); if(reportTab)localStorage.setItem("reportsDefaultTab",reportTab); for (const k of ["token","role","username"]) localStorage.setItem(k,auth[k]); }, {auth,theme,reportTab:process.env.UI_REPORT_TAB});
    const page = await context.newPage();
    if (states.includes("table-states")) await context.route(api + "/sessions/alerts", handler => handler.fulfill({ json: { alerts: [], owner_summaries: [], config: {} } }));
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
        const payload = state === "empty" ? pathname === "/settings/menu" ? {} : empty(data) : ["table-states", "missing-payment"].includes(state) ? fixture(data,pathname,state) : state === "extreme" ? extreme(fixture(data,pathname,state)) : partial(fixture(data,pathname,state));
        return handler.fulfill({ response, status: pathname === "/tournaments/99001" ? 200 : response.status(), json: payload });
      });
      await page.goto(origin + route, {waitUntil:"domcontentloaded"});
      await page.locator(".topbar-title").waitFor();
      let tabSelected = !process.env.UI_TAB;
      if (process.env.UI_TAB && (state !== "loading" || stage === "after")) {
        const tab = page.getByRole("button", { name: process.env.UI_TAB, exact: true });
        await tab.click();
        tabSelected = (await tab.getAttribute("class", { timeout: 1000 }).catch(() => null))?.split(/\s+/).includes("active") || false;
      }
      let loadingIndicator = true, settled = true;
      if (state === "loading") loadingIndicator = await page.locator(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton").first().waitFor({timeout:3000}).then(()=>true,()=>false);
      else settled = await page.waitForFunction(() => ![...document.querySelectorAll(".page-skeleton,.ui-skeleton-stack,.ui-skeleton-grid,.lf-skeleton")].some(n => n.getClientRects().length), null, {timeout:12000}).then(()=>true,()=>false);
      await page.evaluate(() => document.fonts.ready);
      for (const width of process.env.UI_WIDTHS?.split(",").map(Number) || [375,768,1024,1440,1920]) {
        await page.setViewportSize({width,height:width===375?844:1000});
        await page.waitForTimeout(100);
        await page.mouse.move(0,0);
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const metrics = await page.evaluate(measureUi, { minimumTextSize: strict ? 12 : 0 });
        const populatedBracketVisible = route === "/tournaments" && ["partial", "extreme"].includes(state) ? await page.getByRole("button", { name: /QA Player One/ }).count() > 0 : undefined;
        const paymentSummary = route === "/sales" ? await page.evaluate(() => ({
          values: Object.fromEntries([...document.querySelectorAll(".sales-metrics > *")].map(node => [node.querySelector("span")?.textContent, node.querySelector("strong")?.textContent])),
          unspecifiedWarning: document.body.textContent.includes("Some payment methods are unspecified"),
        })) : undefined;
        const viewportOnly = await page.evaluate(()=>document.documentElement.scrollHeight >= 16000);
        const contrast = await scanRenderedContrast(page,{route,theme,state,viewportOnly,...(strict ? { minimumContrast: 4.5, includeDisabled: true } : {})});
        const file = `${theme}-${width}-${state}.png`;
        const fullPage = ["default","extreme","table-states","missing-payment"].includes(state) && await page.evaluate(()=>document.documentElement.scrollHeight < 16000);
        await page.screenshot({path:`${output}/${file}`,animations:"disabled",fullPage});
        if (state === "table-states") {
          for (const card of await page.locator(".lf-table-card").all()) {
            const key = await card.getAttribute("data-table-state");
            await card.screenshot({ path: `${output}/${theme}-${width}-card-${key}.png`, animations: "disabled" });
          }
        }
        const noRequestNeeded = route === "/settings?section=billing" && stage === "after";
        const retry = state === "error" && !noRequestNeeded ? await page.getByRole("button",{name:/retry|try again|check again/i}).count() > 0 : true;
        report.samples.push({theme,width,state,file,requestedTab:process.env.UI_TAB,tabSelected,paymentSummary,populatedBracketVisible,...metrics,loadingIndicator,settled,contrast,contrastScope:viewportOnly?"visible viewport only; unpaginated baseline":"all rendered page text",retry,errors:[...errors]});
      }
      release(); await page.unrouteAll({ behavior: "wait" }); errors=[];
      console.log(`${stage} ${route} ${theme} ${state}`);
    }
    await context.close();
  }
} finally { await browser.close(); await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2)); }
const faults = report.samples.filter(r => !r.loadingIndicator || !r.settled || r.applicationCrashed || r.overflow || r.smallText.length || r.contentOverflow.length || r.shortTargets.length || r.clipped.length || r.clippedControls.length || r.invalidCopy.length || r.unlabeledButtons.length || r.unlabeledInputs.length || r.brokenImages.length || r.contrast.length || r.errors.length || !r.retry);
console.log(JSON.stringify({route,stage,samples:report.samples.length,faults:faults.map(r=>({theme:r.theme,width:r.width,state:r.state,loadingIndicator:r.loadingIndicator,settled:r.settled,applicationCrashed:r.applicationCrashed,overflow:r.overflow,contentOverflow:r.contentOverflow,shortTargets:r.shortTargets,clipped:r.clipped,clippedControls:r.clippedControls,unlabeledInputs:r.unlabeledInputs,contrast:r.contrast,errors:r.errors,retry:r.retry}))},null,2));
if (stage === "after") {
  assert.equal(faults.length,0); assert.equal(report.errors.length,0);
  assert.ok(report.samples.every(row => row.populatedBracketVisible !== false), "Populated bracket fixture must actually load, not pass as a failed detail request");
  assert.ok(report.samples.every(row => row.tabSelected), "Requested sub-tab must actually be selected, including loading state");
  if (process.env.UI_PARTIAL_NULL_ROWS === "true" && route === "/live-floor") assert.ok(report.samples.every(row => row.collectionSizes[".lf-table-card"] === 5));
  if (process.env.UI_UNKNOWN_FLOOR_STATUS === "true") assert.ok(report.samples.every(row => row.collectionSizes[".lf-table-card"] === 0));
  if (route === "/bookings" && !process.env.UI_DATA_PATH) assert.ok(report.samples.filter(row => ["empty", "error"].includes(row.state)).every(row => row.collectionSizes[".op2-table-booking-card"] === 0), "Unknown availability must not render available table cards");
  if (route === "/sales") assert.ok(report.samples.filter(row => row.state === "missing-payment").every(row => row.paymentSummary.unspecifiedWarning && Number(row.paymentSummary.values.Cash?.replace(/[^\d.-]/g, "")) === 0), "Missing payment methods must not be reported as Cash");
}
