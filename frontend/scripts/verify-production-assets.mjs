import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const site = "https://hsr-bms.vercel.app";
const backend = "https://hsr-bms-backend.onrender.com";
const release = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const html = await (await fetch(site + "/login?verify=" + Date.now(), { cache: "no-store" })).text();
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(entry, "Production entry missing");
const assets = [];
for (const file of (await fs.readdir("dist/assets")).filter(f => /\.(js|css|woff2?)$/.test(f))) {
  const local = await fs.readFile("dist/assets/" + file);
  const response = await fetch(site + "/assets/" + file, { cache: "no-store" });
  assert.ok(response.ok, `Asset unavailable: ${file}`);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(remote), hash(local), `Asset mismatch: ${file}`);
  assets.push({ path: "/assets/" + file, bytes: local.length, sha256: hash(local) });
}
assert.ok(assets.some(a => a.path === entry), "Production still serves another entry");
assert.ok(html.includes("window.HSRTheme"), "Early theme bootstrap missing in production");
assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", release, "origin/main"]).status, 0);
const health = await (await fetch(backend + "/health")).json();
const ready = await (await fetch(backend + "/ready")).json();
assert.equal(health.status, "ok"); assert.equal(ready.database, "ok");
if (process.env.VERIFY_FINANCIAL_PROTOCOL) assert.equal(ready.financial_integrity_version, Number(process.env.VERIFY_FINANCIAL_PROTOCOL));
assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", health.revision, release]).status, 0);
assert.equal(spawnSync("git", ["diff", "--quiet", health.revision, release, "--", "backend"]).status, 0);
const report = { verifiedAt: new Date().toISOString(), release, site, entry, allAssetsMatch: true, assetCount: assets.length, earlyThemeBootstrapPresent: true, releaseOnOriginMain: true, health, ready, backendRevisionIsAncestor: true, backendCodeUnchanged: true, productionMutations: 0, assets };
const output = process.env.PRODUCTION_REPORT_PATH || "../docs/theme-contrast-audit/production.json";
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, assets: undefined }, null, 2));
