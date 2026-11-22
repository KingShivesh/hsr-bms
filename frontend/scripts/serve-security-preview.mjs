import fs from "node:fs/promises";
import { preview } from "vite";

const api = "http://127.0.0.1:8006";
const config = JSON.parse(await fs.readFile("vercel.json", "utf8"));
const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) =>
  [key, value.replaceAll("https://hsr-bms-backend.onrender.com", api)]));
const server = await preview({ preview: { host: "127.0.0.1", port: 5189, strictPort: true, headers } });
server.printUrls();
process.on("SIGINT", () => server.httpServer.close(() => process.exit(0)));
