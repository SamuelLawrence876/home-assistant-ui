/* Loads a tab from a dist dir and prints console errors/pageerrors.
   Usage: node scripts/console-check.mjs <distDir> <tab> */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const [dist = "dist-phase1", tab = "overview"] = process.argv.slice(2);
const srv = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const f = p === "/" || !extname(p) ? "index.html" : p.slice(1);
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  try {
    const body = await readFile(join(dist, f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, r));
const b = await chromium.launch();
const pg = await b.newPage();
pg.on("console", (m) => ["error", "warning"].includes(m.type()) && console.log(m.type().toUpperCase() + ":", m.text().slice(0, 500)));
pg.on("pageerror", (e) => console.log("PAGEERROR:", String(e.stack || e).slice(0, 1000)));
await pg.goto(`http://localhost:${srv.address().port}/?tab=${tab}&mode=day&clock=12:00`);
await pg.waitForTimeout(3000);
await b.close();
srv.close();
