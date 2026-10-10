import fs from "node:fs/promises";
import path from "node:path";

const entries = [];
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(css|jsx?|html)$/.test(file)) {
      const lines = (await fs.readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        const utilities = [...line.matchAll(/\b(?:text|bg|border)-(?:white|black|gray-\d+|\[#[\da-f]+\])\b|\bdark:[\w-]+/gi)].map(m => m[0]);
        const hex = [...line.matchAll(/#[\da-f]{3,8}\b/gi)].map(m => m[0]);
        const inlineColor = /\b(?:color|backgroundColor|borderColor|fill|stroke)\s*:/.test(line) && /\.(?:jsx?|html)$/.test(file);
        if (utilities.length || hex.length || inlineColor) entries.push({ file, line: index + 1, source: line.trim(), utilities, hex, classification: utilities.length ? "review utility" : file.endsWith("design-tokens.css") ? "legitimate canonical tokens" : hex.length && /\.(?:jsx?|html)$/.test(file) ? "review literal" : inlineColor && line.includes("var(--") ? "legitimate semantic inline style" : "CSS rule or dynamic value; not a component utility violation" });
      });
    }
  }
}
await visit("src");
const report = { method: "Line-based source inventory, not computed contrast or an AST proof", componentUtilities: entries.filter(e => e.utilities.length), componentLiterals: entries.filter(e => e.hex.length && /\.(?:jsx?|html)$/.test(e.file)), entries };
await fs.writeFile("../docs/full-stack-audit/source-colors.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ inventoryLines: entries.length, componentUtilities: report.componentUtilities, componentLiterals: report.componentLiterals }));
