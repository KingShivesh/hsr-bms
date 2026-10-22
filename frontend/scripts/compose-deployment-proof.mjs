import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

const [cluster, state = "default", width = "375"] = process.argv.slice(2);
if (!cluster || !/^[a-z0-9-]+$/.test(cluster) || !/^[a-z0-9-]+$/.test(state) || !/^\d+$/.test(width)) throw new Error("Choose a cluster, state and width");
const root = new URL("../../docs/deployment-ui-completion/", import.meta.url);
const sources = [];
for (const theme of ["light", "dark"]) for (const stage of ["before", "after"]) {
  const path = `${cluster}/${stage}/${theme}-${width}-${state}.png`;
  const bytes = await fs.readFile(new URL(path, root));
  sources.push({ theme, stage, path, sha256: createHash("sha256").update(bytes).digest("hex"), image: PNG.sync.read(bytes) });
}
const tileWidth = Math.max(...sources.map(source => source.image.width));
const tileHeight = Math.min(1000, Math.max(...sources.map(source => source.image.height)));
const result = new PNG({ width: tileWidth * 2 + 8, height: tileHeight * 2 + 8 });
result.data.fill(128);
for (let i = 3; i < result.data.length; i += 4) result.data[i] = 255;
for (const source of sources) PNG.bitblt(source.image, result, 0, 0, source.image.width, Math.min(source.image.height, tileHeight), source.stage === "after" ? tileWidth + 8 : 0, source.theme === "dark" ? tileHeight + 8 : 0);
await fs.mkdir(new URL("comparisons/", root), { recursive: true });
const key = `${cluster}-${state}-${width}`;
await fs.writeFile(new URL(`comparisons/${key}.png`, root), PNG.sync.write(result));
await fs.writeFile(new URL(`comparisons/${key}.json`, root), JSON.stringify({ legend: "Before left, after right; light above dark. Original pixels, first 1000px of tall captures. Full source captures retained.", sources: sources.map(({ image, ...source }) => ({ ...source, width: image.width, height: image.height, croppedHeight: Math.min(image.height, tileHeight) })) }, null, 2));
console.log(`comparisons/${key}.png`);
