import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

const root = new URL("../../docs/ui-readiness/", import.meta.url);
const items = [
  ["login", "login/before/{theme}-375-error.png", "login/after/{theme}-375-error.png"],
  ["dashboard", "dashboard/before/{theme}-768-default.png", "dashboard/after/{theme}-768-default.png"],
  ["live-floor", "live-floor/before/{theme}-375-empty.png", "live-floor/after/{theme}-375-empty.png"],
  ["checkout", "checkout/before/{theme}-375-error.png", "checkout/after/{theme}-375-error.png"],
  ["members", "customers/detail-before/{theme}-375.png", "customers/detail-after/{theme}-375.png"],
  ["bookings", "bookings/feedback-before/{theme}-pending.png", "bookings/feedback-after/{theme}-pending.png"],
  ["cafe-stats", "cafe-stats/before/{theme}-375-partial.png", "cafe-stats/after/{theme}-375-partial.png"],
  ["cafe-history", "cafe-history/before/{theme}-375-partial.png", "cafe-history/after/{theme}-375-partial.png"],
  ["sales", "sales/detail-before/{theme}-375.png", "sales/detail-after/{theme}-375.png"],
  ["reports-bills", "analytics/before/{theme}-375-loading.png", "analytics/after/{theme}-375-loading.png"],
  ["reports-tables", "reports-tables/before/{theme}-375-partial.png", "reports-tables/after/{theme}-375-partial.png"],
  ["reports-analytics", "reports-advanced/before/{theme}-375-error.png", "reports-advanced/after/{theme}-375-error.png"],
  ["reports-session-edits", "reports-session-edits/before/{theme}-375-loading.png", "reports-session-edits/after/{theme}-375-loading.png"],
  ["settings", "settings/before/{theme}-375-default.png", "settings/after/{theme}-375-default.png"],
  ["settings-account", "settings-account/before/{theme}-375-partial.png", "settings-account/after/{theme}-375-partial.png"],
  ["settings-activity", "settings-activity/before/{theme}-375-partial.png", "settings-activity/after/{theme}-375-partial.png"],
  ["inventory", "inventory/before/{theme}-375-default.png", "inventory/after/{theme}-375-default.png"],
  ["legacy-controls", "legacy-table-controls/before/{theme}-1024-default.png", "legacy-table-controls/after/{theme}-1024-default.png"],
  ["tournaments", "tournaments/before/{theme}-375-default.png", "tournaments/after/{theme}-375-default.png"],
  ["closing", "daily-closing/before/{theme}-375-default.png", "daily-closing/after/{theme}-375-default.png"],
  ["pricing", "pricing-rules/before/{theme}-375-default.png", "pricing-rules/after/{theme}-375-default.png"],
  ["status", "status/before/{theme}-375-loading.png", "status/after/{theme}-375-loading.png"],
  ["tooltips", "shared/before-{theme}-375-tooltip.png", "shared/after-{theme}-375-tooltip.png"],
  ["reminders", "reminder-stack/before-{theme}-375-120-minute-replacement.png", "reminder-stack/after-{theme}-375-120-minute-replacement.png"],
  ["command", "command/before/{theme}-375-seven-live-reads-held.png", "command/after/{theme}-375-seven-live-reads-held.png"],
  ["cafe-cart", "cafe-extreme/before/{theme}/375-hundred-items-submit-viewport.png", "cafe-extreme/after/{theme}/375-hundred-items-submit-viewport.png"],
  ["cafe-large-amount", "cafe-extreme/before/{theme}/375-large-amount-full-cart.png", "cafe-extreme/after/{theme}/375-large-amount-full-cart.png"],
];
await fs.mkdir(new URL("comparisons/", root), {recursive:true});
const manifest = {legend:"Before on the left, after on the right. Light on top, dark below. Original pixels, no resizing; first 1000px of tall captures. Full source captures are retained.",images:[]};
for (const [name,before,after] of items) {
  const sources=[];
  for(const theme of ["light","dark"]) for(const [stage,template] of [["before",before],["after",after]]) {
    const path=template.replace("{theme}",theme), bytes=await fs.readFile(new URL(path,root));
    sources.push({theme,stage,path,image:PNG.sync.read(bytes),sha256:createHash("sha256").update(bytes).digest("hex")});
  }
  const tileWidth=Math.max(...sources.map(source=>source.image.width));
  const tileHeight=Math.min(1000,Math.max(...sources.map(source=>source.image.height)));
  const image=new PNG({width:tileWidth*2+8,height:tileHeight*2+8});image.data.fill(128);
  for(let index=3;index<image.data.length;index+=4)image.data[index]=255;
  for(const source of sources) PNG.bitblt(source.image,image,0,0,source.image.width,Math.min(tileHeight,source.image.height),source.stage==="after"?tileWidth+8:0,source.theme==="dark"?tileHeight+8:0);
  const path=`comparisons/${name}.png`;await fs.writeFile(new URL(path,root),PNG.sync.write(image));
  manifest.images.push({name,path,width:image.width,height:image.height,sources:sources.map(({image,...source})=>({...source,width:image.width,height:image.height,croppedHeight:Math.min(tileHeight,image.height)}))});
}
await fs.writeFile(new URL("comparisons/manifest.json",root),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({images:manifest.images.length,legend:manifest.legend}));
