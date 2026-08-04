/* Console gate — loads every tab of a built bundle and FAILS on console errors.

   Usage:
     node scripts/console-check.mjs <distDir> [tab ...] [--wait <ms>]

   Defaults to all seven tabs. Exits 1 if any tab logged a console error or
   threw an uncaught exception; exits 0 otherwise.

   What counts as a failure
   ------------------------
   - console.error()          → failure
   - an uncaught exception    → failure  (this is the blank-tab bug: a lazily
                                          loaded view only throws when its tab
                                          is opened, which is why every tab is
                                          loaded here rather than just the
                                          landing one)
   - console.warn()           → printed, not fatal

   Warnings are deliberately not fatal: a mock-mode build always logs
   "[ha-ws] VITE_HA_URL not set — cannot connect", and a gate that is red by
   design is a gate people learn to ignore (LESSONS.md).

   This is the cheapest of the two browser gates — one viewport, no image
   comparison — so CI runs it before the screenshot diff. */
import { chromium } from "playwright";
import { TABS, VIEWPORTS, BOOT_SETTLE_MS, assertDist, serveDist, tabURL, parseArgs } from "./harness.mjs";

const { flags, positional } = parseArgs(process.argv.slice(2), ["wait"]);
const [dist = "dist-mock", ...tabArgs] = positional;
const tabs = tabArgs.length ? tabArgs : TABS;
const waitMs = Number(flags.wait ?? BOOT_SETTLE_MS);

const unknown = tabs.filter((t) => !TABS.includes(t));
if (unknown.length) {
  console.error(`[console-check] unknown tab(s): ${unknown.join(", ")}`);
  console.error(`[console-check] known tabs: ${TABS.join(", ")}`);
  process.exit(1);
}

assertDist(dist);
const server = await serveDist(dist);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop, reducedMotion: "reduce" });

let errorCount = 0;
let warnCount = 0;
const failedTabs = [];

for (const tab of tabs) {
  const page = await ctx.newPage();
  const errors = [];
  let warns = 0;
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 500)}`);
    else if (m.type() === "warning") {
      warns++;
      console.log(`  warn  ${m.text().slice(0, 200)}`);
    }
  });
  page.on("pageerror", (e) => errors.push(`uncaught: ${String(e.stack || e).slice(0, 1000)}`));

  console.log(`${tab}`);
  await page.goto(tabURL(server.port, tab), { waitUntil: "load" });
  await page.waitForTimeout(waitMs);
  await page.close();

  warnCount += warns;
  if (errors.length) {
    failedTabs.push(tab);
    errorCount += errors.length;
    for (const e of errors) console.log(`  ERROR ${e}`);
  }
}

await ctx.close();
await browser.close();
server.close();

if (errorCount) {
  console.log(`\nCONSOLE CHECK FAILED — ${errorCount} error(s) on: ${failedTabs.join(", ")}`);
  process.exit(1);
}
console.log(`\nCONSOLE CHECK PASSED — ${tabs.length} tab(s), 0 errors, ${warnCount} warning(s)`);
