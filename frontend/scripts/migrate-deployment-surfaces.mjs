import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const panelClasses = new Set(["ops-panel", "op2-panel", "settings-panel", "cf-panel", "lf-panel", "food-cart-panel", "session-list-panel"]);
const cardClasses = new Set(["ops-kpi", "op2-customer-card", "op2-table-booking-card", "food-menu-card", "table-status-card", "session-money-card", "lf-table-card", "table-floor-tile", "table-control-card", "table-state-card", "checkout-total-card", "checkout-split-card"]);
for (const file of process.argv.slice(2)) {
  if (!file.startsWith("src/") || !file.endsWith(".jsx") || file.includes("..")) throw new Error("Explicit src JSX paths required");
  const source = await fs.readFile(file, "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const edits = [], imports = new Set();
  traverse(ast, { JSXElement({ node }) {
    const opening = node.openingElement, name = opening.name.name;
    if (!["article", "section", "div", "HsrButton", "Button"].includes(name)) return;
    const attribute = opening.attributes.find(item => item.name?.name === "className");
    if (!attribute) return;
    const classes = source.slice(attribute.value.start, attribute.value.end).split(/[\s"'`{}$]+/);
    const kind = classes.some(item => panelClasses.has(item)) ? "Panel" : classes.some(item => cardClasses.has(item)) ? "Card" : null;
    if (!kind) return;
    const alias = `Hsr${kind}`;
    const as = ["HsrButton", "Button"].includes(name) ? `{${name}}` : `"${name}"`;
    edits.push({ start: opening.name.start, end: opening.name.end, value: `${alias} as=${as}` });
    if (node.closingElement) edits.push({ start: node.closingElement.name.start, end: node.closingElement.name.end, value: alias });
    imports.add(kind);
  } });
  if (!edits.length) continue;
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  let relative = path.relative(path.dirname(file), "src/components/ui/index.js");
  if (!relative.startsWith(".")) relative = "./" + relative;
  result = `import { ${[...imports].map(kind => `${kind} as Hsr${kind}`).join(", ")} } from "${relative}";\n` + result;
  parse(result, { sourceType: "module", plugins: ["jsx"] });
  await fs.writeFile(file, result);
  console.log(JSON.stringify({ file, surfaces: edits.length / 2, imports: [...imports] }));
}
