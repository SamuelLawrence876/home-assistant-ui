/* Shared plumbing for the two browser gates (console-check.mjs, shoot.mjs).

   Both need the same three things: the list of tabs, a static file server for a
   built bundle, and the deterministic URL that pins the theme so a screenshot
   taken now matches one taken at midnight. Keeping that in one file means a new
   tab is added in one place — two copies of the tab list is exactly how a gate
   ends up quietly not covering a screen. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

/* Must match the TABS array in src/App.jsx. */
export const TABS = ["overview", "lights", "media", "schedule", "climate", "workshop", "system"];

export const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  phone: { width: 390, height: 844 },
};

/* BootScreen holds the overlay for up to MAX_WAIT_MS (8s, src/BootScreen.jsx)
   when no WebSocket snapshot arrives — which is always the case in mock mode —
   then plays a ~1s exit. Anything shorter than this photographs the boot
   animation instead of the dashboard. */
export const BOOT_SETTLE_MS = 11000;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/* A missing bundle must stop the run, not produce screenshots of a 404 page.
   A baseline of nothing still "matches" the next baseline of nothing. */
export function assertDist(dist) {
  if (existsSync(join(dist, "index.html"))) return;
  console.error(`[harness] no index.html in "${dist}"`);
  console.error("[harness] build the mock bundle first: node scripts/visual-check.mjs");
  process.exit(1);
}

/* Serves <dist> on an ephemeral port. Any path without an extension falls
   through to index.html so ?tab= deep links work like they do behind
   CloudFront. */
export async function serveDist(dist) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = path === "/" || !extname(path) ? "index.html" : path.slice(1);
    try {
      const body = await readFile(join(dist, file));
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => server.close() };
}

/* mode=day + clock=12:00 pin the theme and the sun position, and
   today=2026-06-17 pins the calendar date (a Wednesday, matching the authored
   midsummer sky), so the shots depend on neither what time nor what DAY CI
   happened to run. Without the date pin the schedule tab's week grid drifted
   against the baseline a little every real day. */
export function tabURL(port, tab, viewport) {
  const q = new URLSearchParams({ tab, mode: "day", clock: "12:00", today: "2026-06-17" });
  if (viewport) q.set("viewport", viewport);
  return `http://127.0.0.1:${port}/?${q}`;
}

/* Tiny flag parser. Returns { flags, positional }; supports --name value,
   --name=value and boolean --name. */
export function parseArgs(argv, valueFlags = []) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (eq !== -1) flags[name] = a.slice(eq + 1);
    else if (valueFlags.includes(name)) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { flags, positional };
}
