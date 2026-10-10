import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src");
const sources = ["index.css", "style.css", "design-tokens.css", "table-states.css"].map((name) => ({
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

function auditComponents(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) auditComponents(file);
    else if (/\.[jt]sx?$/.test(entry.name)) {
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(/\b(?:(?:text|bg|border)-(?:white|black|(?:gray|slate|zinc|neutral|stone)-\d+|\[#[0-9a-fA-F]+\])|dark:(?:text|bg|border)-[\w[-]+)/g)) {
        issues.push(`${path.relative(root, file)}:${content.slice(0, match.index).split("\n").length} fixed/mode-specific color utility: ${match[0]}`);
      }
    }
  }
}
auditComponents(srcDir);
for (const source of sources.filter(s => s.name.endsWith("style.css"))) {
  if (/(?:^|\n)(?::root|body\.dark)\s*\{\s*--/.test(source.text)) issues.push(`${source.name}: theme declarations must live in design-tokens.css`);
}

if (issues.length) {
  console.error("Theme contrast guardrail failed:\n");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("\nUse semantic pairs: --text-* for neutral surfaces, --surface/--bg-* for fills, and --text-on-accent only on accent fills.");
  process.exit(1);
}

console.log("Theme contrast guardrail passed.");
