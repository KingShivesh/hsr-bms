import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const git = args => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git inspection failed: ${result.stderr}`);
  return result;
};
const root = git(["rev-parse", "--show-toplevel"]).stdout.trim();
const output = path.resolve(process.argv[2] || path.join(root, "docs/daily-use-readiness/phase-3/secrets-history.json"));
const refs = git(["for-each-ref", "--format=%(objectname)"]);
const tips = [...new Set(refs.stdout.trim().split("\n").filter(value => /^[0-9a-f]{40}$/.test(value)))];
if (!tips.length) throw new Error("No valid Git refs to scan");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "hsr-redacted-secrets-"));
try {
  const reportPath = path.join(temporary, "report.json");
  const result = spawnSync(process.env.GITLEAKS_PATH || "gitleaks", ["git", root,
    "--log-opts", tips.join(" "), "--redact=100", "--no-banner", "--no-color", "--timeout", "120",
    "--gitleaks-ignore-path", path.join(root, ".gitleaksignore"), "--report-path", reportPath,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error("Secret scan failed; install the official Gitleaks release or set GITLEAKS_PATH.");
  const raw = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const report = {
    scanner: "Gitleaks", scope: "History reachable from all valid local refs; no history rewritten",
    validTips: tips.length, commits: Number(git(["rev-list", "--count", ...tips]).stdout.trim()),
    ignoredMalformedRefs: refs.stderr.split("\n").filter(Boolean), exitCode: result.status,
    findings: raw.map(({ RuleID, File, StartLine, Commit, Fingerprint }) => ({
      rule: RuleID, file: File, line: StartLine, commit: Commit, fingerprint: Fingerprint,
    })),
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ commits: report.commits, findings: report.findings.length, output }));
  process.exitCode = result.status;
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
