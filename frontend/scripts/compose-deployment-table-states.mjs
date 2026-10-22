import fs from "node:fs/promises";
import { PNG } from "pngjs";

const root = new URL("../../docs/deployment-ui-completion/", import.meta.url);
const states = ["running", "paused", "available", "reserved", "maintenance"];
for (const stage of ["before", "after"]) {
  const tiles = [];
  for (const theme of ["light", "dark"]) for (const [column, state] of states.entries()) {
    const path = `live-floor/all-states-${stage}/${theme}-1440-card-${state}.png`;
    tiles.push({ theme, column, image: PNG.sync.read(await fs.readFile(new URL(path, root))) });
  }
  const width = Math.max(...tiles.map(tile => tile.image.width)), height = Math.max(...tiles.map(tile => tile.image.height));
  const image = new PNG({ width: width * 5 + 8 * 4, height: height * 2 + 8 });
  image.data.fill(128);
  for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255;
  for (const tile of tiles) PNG.bitblt(tile.image, image, 0, 0, tile.image.width, tile.image.height, tile.column * (width + 8), tile.theme === "dark" ? height + 8 : 0);
  await fs.writeFile(new URL(`comparisons/table-states-${stage}.png`, root), PNG.sync.write(image));
}
console.log("Original card pixels, running/paused/available/reserved/maintenance; light above dark. Fixtures isolate global alert popups, not card-level attention badges.");
