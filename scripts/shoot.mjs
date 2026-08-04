/* Screenshot harness — shoots every tab at both viewports from a built bundle.

   Usage:
     node scripts/shoot.mjs <distDir> <outDir> [--wait <ms>]

   Writes <outDir>/<tab>-<viewport>.png for all 7 tabs x 2 viewports, plus a
   meta.json recording what shot them. Feed the result to pixel-diff.mjs; the
   whole build-shoot-compare sequence is wrapped by visual-check.mjs.

   Determinism, in the order it matters:
     - the bundle must be a mock-mode build (VITE_HA_URL=""), so no live entity
       state can move between runs — visual-check.mjs guarantees that;
     - ?mode=day&clock=12:00 pins the theme and the sun position;
     - reducedMotion: "reduce" plus a hard freeze of every running animation at
       one timeline point, so looping shimmers cannot differ in phase;
     - a fixed settle wait so the boot overlay is gone in every shot.

   What it still cannot pin is the renderer: fonts and antialiasing differ
   between operating systems, so a baseline shot on Windows will not match one
   shot on a Linux CI runner. That is what meta.json is for — pixel-diff.mjs
   reads it and says so instead of printing fourteen mystery diffs. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium } from "playwright";
import { TABS, VIEWPORTS, BOOT_SETTLE_MS, assertDist, serveDist, tabURL, parseArgs } from "./harness.mjs";

const { flags, positional } = parseArgs(process.argv.slice(2), ["wait"]);
const [dist = "dist-mock", out = "visual-candidate"] = positional;
const waitMs = Number(flags.wait ?? BOOT_SETTLE_MS);

assertDist(dist);

/* The out dir is emptied before shooting, so a tab that has been removed does
   not leave a stale baseline behind. Refuse to empty a directory that holds
   anything this script did not write — a mistyped path should not delete
   someone's work. */
const ALLOWED = /^(.*\.png|meta\.json|_diff)$/;
let existing = [];
try {
  existing = readdirSync(out);
} catch {
  existing = [];
}
const foreign = existing.filter((f) => !ALLOWED.test(f));
if (foreign.length) {
  console.error(`[shoot] refusing to empty "${out}" — it contains ${foreign.slice(0, 5).join(", ")}`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = await serveDist(dist);
const browser = await chromium.launch();

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  for (const tab of TABS) {
    const page = await ctx.newPage();
    await page.goto(tabURL(server.port, tab, vpName), { waitUntil: "load" });
    await page.waitForTimeout(waitMs);
    // Freeze every animation at one timeline point so screenshots are
    // build-independent (shimmer loops etc. otherwise differ in phase).
    await page.evaluate(() =>
      document.getAnimations({ subtree: true }).forEach((a) => {
        try {
          a.currentTime = 60000;
          a.pause();
        } catch {
          /* ignore */
        }
      })
    );
    await page.screenshot({ path: join(out, `${tab}-${vpName}.png`), fullPage: true });
    await page.close();
    process.stdout.write(`${tab}-${vpName} `);
  }
  await ctx.close();
}

const chromiumVersion = browser.version();
await browser.close();
server.close();

const require = createRequire(import.meta.url);
let playwrightVersion = "unknown";
try {
  playwrightVersion = require("playwright/package.json").version;
} catch {
  /* leave as unknown — meta is diagnostic, not load-bearing */
}

writeFileSync(
  join(out, "meta.json"),
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      playwright: playwrightVersion,
      chromium: chromiumVersion,
      shotAt: new Date().toISOString(),
      waitMs,
      tabs: TABS,
      viewports: VIEWPORTS,
    },
    null,
    2
  ) + "\n"
);

console.log(`\ndone -> ${out} (${TABS.length * Object.keys(VIEWPORTS).length} shots, ${process.platform})`);
