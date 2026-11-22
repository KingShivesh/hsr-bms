import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

const root = new URL("../../docs/daily-use-readiness/phase-3/browser/", import.meta.url);
const manifest = { legend: "Before left, after right; light above, dark below. Original local QA screenshots, without retouching.", images: [] };
for (const page of ["closing", "cafe", "tables"]) for (const width of [375, 1440]) {
  const sources = [];
  for (const theme of ["light", "dark"]) for (const stage of ["before", "after"]) {
    const path = `${stage}-${page === "closing" ? "" : `${page}-`}staff-${theme}-${width}.png`;
    const bytes = await fs.readFile(new URL(path, root));
    sources.push({ path, theme, stage, sha256: createHash("sha256").update(bytes).digest("hex"), image: PNG.sync.read(bytes) });
  }
  const height = Math.max(...sources.map(source => source.image.height));
  const output = new PNG({ width: width * 2 + 8, height: height * 2 + 8 });
  output.data.fill(128);
  for (let i = 3; i < output.data.length; i += 4) output.data[i] = 255;
  for (const source of sources) PNG.bitblt(source.image, output, 0, 0, width, source.image.height,
    source.stage === "after" ? width + 8 : 0, source.theme === "dark" ? height + 8 : 0);
  const file = `comparison-${page}-${width}.png`;
  await fs.writeFile(new URL(file, root), PNG.sync.write(output));
  manifest.images.push({ file, sources: sources.map(({ image, ...source }) => ({ ...source, width: image.width, height: image.height })) });
}
await fs.writeFile(new URL("comparisons.json", root), JSON.stringify(manifest, null, 2));
console.log(manifest.legend);
