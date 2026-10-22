import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generatorModule from "@babel/generator";
import postcss from "postcss";

const traverse = traverseModule.default;
const generate = generatorModule.default;
const sizes = { xs: 12, sm: 13, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 32 };
const nearest = value => Object.keys(sizes).reduce((best, key) => Math.abs(sizes[key] - value) < Math.abs(sizes[best] - value) ? key : best, "base");
const grid = [0,4,8,12,16,20,24,32,40,48,64];
const snap = value => grid.reduce((best, step) => Math.abs(step-value) < Math.abs(best-value) ? step : best, 0);
async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    result.push(...(entry.isDirectory() ? await files(filename) : [filename]));
  }
  return result;
}
const counts = { controls: 0, icons: 0, inlineType: 0, cssType: 0, spacing: 0 };
for (const filename of await files("src")) {
  const original = await fs.readFile(filename, "utf8");
  if (filename.endsWith(".css") && !filename.endsWith("design-tokens.css")) {
    const root = postcss.parse(original);
    root.walkDecls(declaration => {
      if (declaration.prop === "font-size") {
        let key;
        const match = declaration.value.match(/^([\d.]+)px$/);
        if (match) key = nearest(Number(match[1]));
        if (declaration.value === "var(--icon-sm)") key = "lg";
        if (declaration.value === "var(--icon-md)") key = "xl";
        if (key) { declaration.value = `var(--text-${key})`; counts.cssType++; }
        const token = declaration.value.match(/^var\(--text-(xs|sm|base|lg|xl|2xl|3xl)\)$/)?.[1];
        if (token) {
          const existing = declaration.parent.nodes.find(node => node.prop === "line-height");
          if (existing) existing.value = `var(--leading-${token})`;
          else declaration.cloneAfter({ prop: "line-height", value: `var(--leading-${token})` });
        }
      }
      if (declaration.prop === "letter-spacing") declaration.value = "0";
      if (/^(padding|margin)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$|^(gap|column-gap|row-gap)$/.test(declaration.prop) && !declaration.parent.selector?.includes("sr-only")) {
        declaration.value = declaration.value.replace(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g, (full, digits) => {
          const n = Number(digits);
          if (n > 64) return full;
          const result = snap(n); if (n !== result) counts.spacing++;
          return `${result}px`;
        });
      }
      if (declaration.prop === "border-radius" && !/50%|100%|999|var\(/.test(declaration.value)) {
        const modal = /modal|dialog|popover|drawer|checkout-bill/.test(declaration.parent.selector || "");
        declaration.value = modal ? "var(--radius-xl)" : /input|button|btn|badge|chip/.test(declaration.parent.selector || "") ? "var(--radius-sm)" : "var(--radius-md)";
      }
    });
    const output = root.toString();
    if (output !== original) await fs.writeFile(filename, output);
  }
  if (!filename.endsWith(".jsx")) continue;
  const ast = parse(original, { sourceType: "module", plugins: ["jsx"] });
  const edits = [];
  const imports = new Set();
  const primitives = ["Button.jsx", "Field.jsx", "DataTable.jsx", "Icon.jsx"].some(name => filename === `src/components/ui/${name}`);
  const native = { button: "HsrButton", input: "HsrInput", select: "HsrSelect", textarea: "HsrTextarea", table: "HsrTable", i: "HsrIcon" };
  traverse(ast, {
    JSXElement({ node }) {
      const opening = node.openingElement;
      const name = opening.name.name;
      if (native[name] && !primitives) {
        const alias = native[name];
        edits.push({ start: opening.name.start, end: opening.name.end, value: alias + (name === "button" ? " native" : "") });
        if (node.closingElement) edits.push({ start: node.closingElement.name.start, end: node.closingElement.name.end, value: alias });
        imports.add(name);
        if (name === "i") counts.icons++; else counts.controls++;
      }
      const style = opening.attributes.find(attribute => attribute.name?.name === "style")?.value?.expression;
      if (style?.type !== "ObjectExpression") return;
      let spacingChanged = false;
      for (const property of style.properties) {
        if (!/^(padding|margin)(Top|Right|Bottom|Left|Block|Inline)?$|^(gap|columnGap|rowGap)$/.test(property.key?.name || "")) continue;
        if (typeof property.value?.value === "number" && property.value.value >= 0 && property.value.value <= 64) {
          const next = snap(property.value.value);
          if (next !== property.value.value) { property.value.value = next; spacingChanged = true; counts.spacing++; }
        }
        if (typeof property.value?.value === "string") {
          const next = property.value.value.replace(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g, (full, digits) => Number(digits) <= 64 ? `${snap(Number(digits))}px` : full);
          if (next !== property.value.value) { property.value.value = next; spacingChanged = true; counts.spacing++; }
        }
      }
      const font = style.properties.find(property => property.key?.name === "fontSize");
      if (!font) {
        if (spacingChanged) edits.push({ start: style.start, end: style.end, value: generate(style).code });
        return;
      }
      let key = font.value.value?.match?.(/var\(--text-(xs|sm|base|lg|xl|2xl|3xl)\)/)?.[1];
      if (!key && typeof font.value.value === "number") key = nearest(font.value.value);
      if (!key && typeof font.value.value === "string") key = nearest(parseFloat(font.value.value) || 14);
      if (!key) return;
      style.properties = style.properties.filter(property => property !== font);
      edits.push({ start: style.start, end: style.end, value: generate(style).code });
      const classAttribute = opening.attributes.find(attribute => attribute.name?.name === "className");
      const value = `type-${key}`;
      if (classAttribute) {
        const old = classAttribute.value;
        const expression = old.type === "StringLiteral" ? JSON.stringify(`${old.value} ${value}`) : `{[${original.slice(old.expression.start, old.expression.end)}, ${JSON.stringify(value)}].filter(Boolean).join(" ")}`;
        edits.push({ start: old.start, end: old.end, value: expression });
      } else edits.push({ start: opening.name.end, end: opening.name.end, value: ` className="${value}"` });
      counts.inlineType++;
    },
  });
  if (!edits.length) continue;
  let output = original;
  for (const edit of edits.sort((a,b) => b.start-a.start || b.end-a.end)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  if (imports.size) {
    const ui = path.relative(path.dirname(filename), "src/components/ui/index.js");
    const exports = { button: "Button", input: "Input", select: "Select", textarea: "Textarea", table: "Table", i: "Icon" };
    output = `import { ${[...imports].map(name => `${exports[name]} as ${native[name]}`).join(", ")} } from "${ui.startsWith(".") ? ui : "./"+ui}";\n` + output;
  }
  parse(output, { sourceType: "module", plugins: ["jsx"] });
  await fs.writeFile(filename, output);
}
console.log(JSON.stringify(counts));
