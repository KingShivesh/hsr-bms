import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postcss from "postcss";

const apply = process.argv.includes("--apply");
const contract = "src/design-tokens.css";
const contractSource = await fs.readFile(contract, "utf8");
const colorTokens = new Map(), spaces = new Map();
const changes = [];
const literalColor = /rgba?\(\s*[-\d.%]+(?:[\s,/]+[-\d.%]+){2,3}\s*\)|#[\da-f]{3,8}\b|(?<![\w-])(?:white|black)(?![\w-])/gi;
const spacing = /^(padding|margin)(-|$)|^(gap|column-gap|row-gap)$/;
const category = property => /^(color|fill|stroke)$|text-shadow|text-decoration/.test(property) ? "ink" : /border|outline/.test(property) ? "line" : /shadow|filter/.test(property) ? "shadow" : "surface";
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!file.endsWith(".css") || file === contract) continue;
    const source = await fs.readFile(file, "utf8"), ast = postcss.parse(source, { from: file });
    ast.walkDecls(decl => {
      if (file.endsWith("table-states.css") && decl.prop.startsWith("--table-")) return;
      const before = decl.value;
      if (/url\(/i.test(before) && literalColor.test(before)) throw new Error(`Review URL color separately: ${file}:${decl.source.start.line}`);
      literalColor.lastIndex = 0;
      decl.value = decl.value.replace(literalColor, value => {
        const key = `--legacy-${category(decl.prop)}-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
        colorTokens.set(key, value);
        return `var(${key})`;
      });
      if (spacing.test(decl.prop)) decl.value = decl.value.replace(/(-?\d+(?:\.\d+)?)px\b/g, (_, raw) => {
        const value = Number(raw);
        if (!value) return "0";
        const snapped = Math.max(4, Math.round(Math.abs(value) / 4) * 4);
        const token = `--space-${snapped / 4}`;
        if (!new RegExp(`${token}:\\s*${snapped}px;`).test(contractSource)) spaces.set(token, `${snapped}px`);
        return value < 0 ? `calc(-1 * var(${token}))` : `var(${token})`;
      });
      if (before !== decl.value) changes.push({ file, line: decl.source.start.line, selector: decl.parent.selector, property: decl.prop, before, after: decl.value });
    });
    if (apply && ast.toString() !== source) await fs.writeFile(file, ast.toString());
  }
}
await visit("src");
const definitions = [...spaces, ...colorTokens].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `  ${name}: ${value};`).join("\n");
if (apply && definitions) await fs.writeFile(contract, contractSource + `\n/* Exact legacy paint values are retained by role; content spacing uses the 4px scale. */\n:root {\n${definitions}\n}\n`);
const report = { applied: apply, method: "PostCSS declarations; every extracted paint value is retained exactly, without palette or font changes. Padding, margins and gaps snap to the existing 4px scale; signed offsets retain their sign.", colorTokens: Object.fromEntries(colorTokens), newSpacingTokens: Object.fromEntries(spaces), changes };
await fs.mkdir("../docs/deployment-ui-completion/final-completion", { recursive: true });
await fs.writeFile("../docs/deployment-ui-completion/final-completion/token-migration.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ applied: apply, declarations: changes.length, paintTokens: colorTokens.size, spacingTokens: spaces.size }));
