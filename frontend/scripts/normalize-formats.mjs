import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
const traverse = traverseModule.default;
async function files(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    output.push(...(entry.isDirectory() ? await files(name) : [name]));
  }
  return output;
}
let changed = 0;
for (const filename of (await files("src")).filter(name => name.endsWith(".jsx"))) {
  const original = await fs.readFile(filename, "utf8");
  const ast = parse(original, { sourceType: "module", plugins: ["jsx"] });
  const edits = [];
  const imports = new Set();
  const editedFunctions = [];
  traverse(ast, {
    FunctionDeclaration({ node }) {
      const name = node.id.name;
      const body = original.slice(node.body.start, node.body.end);
      const param = node.params[0]?.name || node.params[0]?.left?.name;
      if (!param) return;
      let helper;
      if (name === "money" && body.includes("toLocaleString")) helper = "Currency";
      if (["formatTimer", "fmtTime", "fmt"].includes(name) && body.includes("3600")) helper = "Duration";
      if (["fmtShortDateTime", "fmtDateTime", "formatDateTime"].includes(name) && body.includes("toLocaleString")) helper = "DateTime";
      if (!helper) return;
      edits.push({ start: node.body.start, end: node.body.end, value: `{ return polish${helper}(${param}); }` });
      editedFunctions.push([node.start, node.end]);
      imports.add(helper);
    },
    JSXElement({ node }) {
      const opening = node.openingElement;
      if (!["td", "th"].includes(opening.name.name) || opening.attributes.some(a => a.name?.name === "data-type")) return;
      const text = original.slice(opening.end, node.closingElement?.start || opening.end);
      const numeric = text.includes("₹") || /\b(money|formatCurrency|CurrencyAmount)\b|\.toLocaleString\(/.test(text) || (opening.name.name === "th" && /^\s*(Amount|Total|Revenue|Spent|Visits|Sessions|Price|Qty|Quantity|Food|Play|Cash|UPI|Card|Sale|Profit|Rate|Tax)\s*$/i.test(text));
      if (numeric) edits.push({ start: opening.name.end, end: opening.name.end, value: ' data-type="number"' });
    },
  });
  traverse(ast, {
    TemplateLiteral({ node }) {
      if (editedFunctions.some(([start,end]) => node.start >= start && node.end <= end)) return;
      if (node.expressions.length !== 1 || node.quasis[0].value.raw !== "₹") return;
      const expression = node.expressions[0];
      if (expression.type !== "CallExpression" || expression.callee.property?.name !== "toLocaleString") return;
      const value = original.slice(expression.callee.object.start, expression.callee.object.end);
      edits.push({ start: node.start, end: node.end, value: node.quasis[1].value.raw ? `\`${"${polishCurrency("}${value})}${node.quasis[1].value.raw}\`` : `polishCurrency(${value})` });
      imports.add("Currency");
    },
  });
  if (!edits.length) continue;
  let output = original;
  for (const edit of edits.sort((a,b)=>b.start-a.start)) output = output.slice(0,edit.start)+edit.value+output.slice(edit.end);
  if (imports.size) {
    const relative = path.relative(path.dirname(filename), "src/utils/format.js");
    output = `import { ${[...imports].map(name=>`format${name} as polish${name}`).join(", ")} } from "${relative.startsWith(".") ? relative : "./"+relative}";\n`+output;
  }
  parse(output, { sourceType: "module", plugins: ["jsx"] });
  await fs.writeFile(filename, output);
  changed++;
}
console.log({ files: changed });
