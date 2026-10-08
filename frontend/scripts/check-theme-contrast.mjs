import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const sources = ["style.css", "design-tokens.css", "table-states.css"].map((name) => ({
  name: `src/${name}`,
  text: fs.readFileSync(path.join(srcDir, name), "utf8"),
}));
const css = sources.map((source) => source.text).join("\n");

const defined = new Set();
for (const match of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)) {
  defined.add(`--${match[1]}`);
}

const issues = [];
const addIssue = (message, source = "src/style.css", index = 0) => {
  let offset = index;
  for (const candidate of sources) {
    if (offset <= candidate.text.length) {
      const line = candidate.text.slice(0, offset).split("\n").length;
      issues.push(`${candidate.name}:${line} ${message}`);
      return;
    }
    offset -= candidate.text.length + 1;
  }
  issues.push(`${source}:1 ${message}`);
};

for (const match of css.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)) {
  const token = match[1];
  if (!defined.has(token)) {
    addIssue(`uses undefined CSS token ${token}`, "src/style.css", match.index);
  }
}

const dangerousRolePatterns = [
  {
    regex: /(?:^|[;{}]\s*)(background(?:-color)?|background-image)\s*:[^;{}]*var\(--(?:text-[a-zA-Z0-9_-]*|(?:premium|luxury|venue|club)-(?:ink|heading|text))[a-zA-Z0-9_-]*\)/g,
    message: "uses a text token as a background/fill color",
  },
  {
    regex: /(?:^|[;{}]\s*)color\s*:[^;{}]*var\(--(?:surface|bg|.*surface)[a-zA-Z0-9_-]*\)/g,
    message: "uses a surface/background token as text color",
  },
  {
    regex: /(?:^|[;{}]\s*)fill\s*:[^;{}]*var\(--(?:surface|bg|.*surface)[a-zA-Z0-9_-]*\)/g,
    message: "uses a surface/background token as SVG/text fill",
  },
];

for (const { regex, message } of dangerousRolePatterns) {
  for (const match of css.matchAll(regex)) {
    addIssue(`${message}: ${match[0].trim()}`, "src/style.css", match.index);
  }
}

if (issues.length) {
  console.error("Theme contrast guardrail failed:\n");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("\nUse semantic pairs: --text-* for text, --surface/--bg-* for fills, and --text-on-accent for text on accent/dark fills.");
  process.exit(1);
}

console.log("Theme contrast guardrail passed.");
