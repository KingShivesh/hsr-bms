import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

const root = new URL("../../docs/pilot-ui-gate/", import.meta.url);
await fs.mkdir(new URL("comparisons/", root), { recursive: true });
const manifest = { legend: "Before left; after right. Light top; dark below. Original 375px screenshots, no resizing or retouching.", images: [] };
for (const state of ["login-pending", "member-error", "member-empty", "member-partial"]) {
  const sources = [];
  for (const theme of ["light", "dark"]) for (const stage of ["before", "after"]) {
    const path = `${stage}/${theme}-375-${state}.png`;
    const bytes = await fs.readFile(new URL(path, root));
    sources.push({ theme, stage, path, sha256: createHash("sha256").update(bytes).digest("hex"), image: PNG.sync.read(bytes) });
  }
  const width = Math.max(...sources.map(source => source.image.width));
  const height = Math.max(...sources.map(source => source.image.height));
  const output = new PNG({ width: width * 2 + 8, height: height * 2 + 8 });
  output.data.fill(128);
  for (let i = 3; i < output.data.length; i += 4) output.data[i] = 255;
  for (const source of sources) PNG.bitblt(source.image, output, 0, 0, source.image.width, source.image.height, source.stage === "after" ? width + 8 : 0, source.theme === "dark" ? height + 8 : 0);
  const path = `comparisons/${state}.png`;
  await fs.writeFile(new URL(path, root), PNG.sync.write(output));
  manifest.images.push({ state, path, sources: sources.map(({ image, ...source }) => ({ ...source, width: image.width, height: image.height })) });
}
await fs.writeFile(new URL("comparisons/manifest.json", root), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ comparisons: manifest.images.length, legend: manifest.legend }));
