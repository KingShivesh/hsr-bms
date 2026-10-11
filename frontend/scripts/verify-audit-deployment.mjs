import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const backendFix = process.env.DEPLOY_EXPECTED_BACKEND_COMMIT || "aa8b5cf";
const outputPath = process.env.DEPLOY_REPORT_PATH || "../docs/full-stack-audit/deployment.json";
const base = "https://hsr-bms.vercel.app";
const api = "https://hsr-bms-backend.onrender.com";
// Build dist with the production VITE_API_URL; localhost configuration changes bundle bytes.
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const expected = (await fs.readdir("dist/assets")).filter(name => /\.(js|css)$/.test(name));
const expectedFiles = await Promise.all(expected.map(async name => ({ name, sha256: sha(await fs.readFile(`dist/assets/${name}`)) })));
const observations = [];
let lastState;
for (let attempt = 0; attempt < 24; attempt++) {
  const row = { at: new Date().toISOString(), frontendMatches: false, backendContainsFix: false };
  try {
    const html = await fetch(base, { signal: AbortSignal.timeout(30000), cache: "no-store" });
    row.frontendStatus = html.status;
    const content = await html.text();
    const entry = expectedFiles.find(f => /^index-.*\.js$/.test(f.name));
    if (content.includes(entry.name)) {
      row.assets = [];
      for (const file of expectedFiles) {
        const response = await fetch(`${base}/assets/${file.name}`, { signal: AbortSignal.timeout(30000) });
        const hash = sha(Buffer.from(await response.arrayBuffer()));
        row.assets.push({ name: file.name, status: response.status, sha256: hash, expectedSha256: file.sha256, matches: response.ok && hash === file.sha256 });
      }
      row.frontendMatches = row.assets.every(f => f.matches);
    }
    const health = await fetch(api + "/health", { signal: AbortSignal.timeout(30000) });
    row.healthStatus = health.status;
    row.health = await health.json();
    const ready = await fetch(api + "/ready", { signal: AbortSignal.timeout(30000) });
    row.readyStatus = ready.status;
    row.ready = await ready.json();
    if (row.health.revision) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", backendFix, row.health.revision], { stdio: "ignore" });
        row.backendContainsFix = true;
      } catch { /* A previous release or unknown revision is not proof of deployment. */ }
    }
  } catch (error) { row.error = error.message; }
  observations.push(row);
  const state = `${row.frontendMatches}/${row.backendContainsFix}/${row.healthStatus}/${row.readyStatus}`;
  if (state !== lastState) { console.log(JSON.stringify(row)); lastState = state; }
  if (row.frontendMatches && row.backendContainsFix && row.readyStatus === 200) {
    await fs.writeFile(outputPath, JSON.stringify({ verified: true, backendFixCommit: backendFix, localHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), observations }, null, 2));
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 30000));
}
await fs.writeFile(outputPath, JSON.stringify({ verified: false, observations }, null, 2));
throw new Error("Deployment not verified within the bounded window");
