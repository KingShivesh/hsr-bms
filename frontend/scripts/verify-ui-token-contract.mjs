import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import postcss from "postcss";

const baseline = process.argv[2] || "c7a294b";
assert.match(baseline, /^[a-zA-Z0-9/_-]+$/);
const oldSource = execFileSync("git", ["show", `${baseline}:frontend/src/design-tokens.css`], { encoding: "utf8" });
const currentSource = await fs.readFile("src/design-tokens.css", "utf8");
function definitions(source) {
  const result = new Map();
  postcss.parse(source).walkDecls(decl => {
    if (!decl.prop.startsWith("--")) return;
    const key = `${decl.parent.selector || ""} | ${decl.prop}`;
    result.set(key, [...(result.get(key) || []), decl.value]);
  });
  return result;
}
const before = definitions(oldSource), after = definitions(currentSource);
for (const [name, values] of before) assert.deepEqual(after.get(name), values, `Existing palette/type/size contract changed: ${name}`);
const migration = JSON.parse(await fs.readFile("../docs/deployment-ui-completion/final-completion/token-migration.json", "utf8"));
for (const [name, value] of Object.entries(migration.colorTokens)) assert.deepEqual(after.get(`:root | ${name}`), [value], `Paint value drifted: ${name}`);
for (const [name, value] of Object.entries(migration.newSpacingTokens)) assert.equal(parseFloat(value) % 4, 0, `${name} is not on the 4px grid`);
const report = { baseline, preservedExistingDefinitions: before.size, exactPaintValues: Object.keys(migration.colorTokens).length, spacingGrid: 4, fontsAndPaletteUnchanged: true };
await fs.writeFile("../docs/deployment-ui-completion/final-completion/token-contract.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
