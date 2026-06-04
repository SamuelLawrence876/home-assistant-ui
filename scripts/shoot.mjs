/* Screenshot harness for the structure refactor (REFACTOR_PLAN.md).
   Usage: node scripts/shoot.mjs <distDir> <outDir>
   Serves <distDir> statically, screenshots all 7 tabs in desktop + phone
   viewports after the boot animation hands off (MAX_WAIT_MS=8s + exit). */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const [dist = "dist-baseline", out = ".refactor-baseline"] = process.argv.slice(2);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const TABS = ["overview", "lights", "media", "schedule", "climate", "workshop", "system"];
const VIEWPORTS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = path === "/" || !extname(path) ? "index.html" : path.slice(1);
  try {
    const body = await readFile(join(dist, file));
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  for (const tab of TABS) {
    const page = await ctx.newPage();
    // clock=12:00 pins the day theme + sun position so shots are deterministic
    await page.goto(`http://localhost:${port}/?tab=${tab}&viewport=${vpName === "phone" ? "phone" : "desktop"}&mode=day&clock=12:00`);
    await page.waitForTimeout(11000); // boot MAX_WAIT 8s + exit anim + settle
    // Freeze every animation at one timeline point so screenshots are
    // build-independent (shimmer loops etc. otherwise differ in phase).
    await page.evaluate(() =>
      document.getAnimations({ subtree: true }).forEach((a) => {
        try { a.currentTime = 60000; a.pause(); } catch { /* ignore */ }
      })
    );
    await page.screenshot({ path: join(out, `${tab}-${vpName}.png`), fullPage: true });
    await page.close();
    process.stdout.write(`${tab}-${vpName} `);
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log("\ndone →", out);
