import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const output = process.argv[2] || "../docs/deployment-ui-completion/source-before.json";
const report = { method: "PostCSS declarations and Babel JSX AST; source inventory, not a computed visual pass", colors: [], componentColors: [], rawControls: [], surfaceRoots: [], dialogRoots: [], typeLiterals: [], spacingLiterals: [], transitions: [] };
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    const source = await fs.readFile(file, "utf8");
    if (file.endsWith(".css")) postcss.parse(source, { from: file }).walkDecls(declaration => {
      const record = { file, line: declaration.source.start.line, selector: declaration.parent.selector || declaration.parent.name, property: declaration.prop, value: declaration.value };
      const literals = [...declaration.value.matchAll(/rgba?\([^)]*\)|#[\da-f]{3,8}\b|(?<![\w-])(?:white|black)(?![\w-])/gi)].map(match => match[0]);
      if (literals.length) report.colors.push({ ...record, literals, status: file.endsWith("design-tokens.css") ? "canonical token contract" : file.endsWith("table-states.css") && declaration.prop.startsWith("--table-") ? "approved saturated table palette" : "needs token" });
      if (declaration.prop === "font-size" && /\d(?:px|rem|em)\b/.test(declaration.value) && !declaration.prop.startsWith("--")) report.typeLiterals.push(record);
      if (/^(padding|margin)(-|$)|^(gap|column-gap|row-gap)$/.test(declaration.prop) && /-?\d+(?:\.\d+)?px\b/.test(declaration.value) && !file.endsWith("design-tokens.css")) report.spacingLiterals.push(record);
      if (/^transition/.test(declaration.prop) && /\ball\b|(?:[3-9]\d\d|[1-9]\d{3,})ms|0\.[3-9]s|(?<![\d.])[1-9]s/.test(declaration.value)) report.transitions.push(record);
    });
    if (!file.endsWith(".jsx")) continue;
    const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
    traverse(ast, { JSXOpeningElement({ node }) {
      const name = node.name.name;
      const record = { file, line: node.loc.start.line, element: name };
      const classAttribute = node.attributes.find(attribute => attribute.name?.name === "className");
      const classSource = classAttribute ? source.slice(classAttribute.value.start, classAttribute.value.end) : "";
      if (/\b(?:text|bg|border)-(?:white|black|(?:gray|slate|zinc|neutral|stone)-\d+)|\[(?:#[\da-f]{3,8})\]/i.test(classSource)) report.componentColors.push({ ...record, source: classSource });
      if (["button", "input", "select", "textarea", "table"].includes(name) && !file.includes("/components/ui/")) report.rawControls.push(record);
      if (["article", "section", "div"].includes(name) && /(?:^|[\s"`])(?:ops-panel|ops-kpi|op2-panel|op2-customer-card|op2-table-booking-card|settings-panel|cf-panel|lf-panel|food-menu-card|table-status-card|session-money-card)(?=[\s"`]|$)/.test(classSource)) report.surfaceRoots.push({ ...record, classes: classSource });
      if (node.attributes.some(attribute => attribute.name?.name === "aria-modal" && attribute.value?.value === "true") && !file.includes("/components/ui/")) report.dialogRoots.push(record);
    } });
  }
}
await visit("src");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]))));
