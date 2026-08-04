/* Pixel-diff two screenshot dirs produced by scripts/shoot.mjs.

   Usage:
     node scripts/pixel-diff.mjs <baselineDir> <candidateDir>

   Exits 1 if any pair differs by more than 0.05% of pixels, differs in size,
   is missing from the candidate, or is present in the candidate but not the
   baseline. Failing pairs get a diff image written to <candidateDir>/_diff/.

   When the gate does NOT block
   ---------------------------
   Screenshots are only comparable when the same renderer took both: font
   hinting and antialiasing differ between operating systems, so a baseline
   shot on Windows will differ from one shot on a Linux CI runner on every
   single tile. In that case, and when there is no baseline at all, this exits
   0 with a loud NOT BLESSED banner rather than failing.

   That is deliberate. A gate that is red for a reason nobody can fix by
   changing code is a gate people route around, and it would block a deploy of
   unrelated work (LESSONS.md — "a check that always fails is worse than
   none"). The banner names the fix, and the moment a baseline shot on the same
   platform is committed the gate becomes blocking with no flag to set.

   Re-bless the baseline (this is the escape hatch, and it is one line):
     node scripts/visual-check.mjs --bless
   then commit visual-baseline/. To bless the Linux images CI compares
   against, run the CI workflow with bless=true and commit the artifact —
   see scripts/README.md. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [base = "visual-baseline", cand = "visual-candidate"] = process.argv.slice(2);
const MAX_DIFF_PCT = 0.05;

const pngs = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  } catch {
    return [];
  }
};

const banner = (why) => {
  console.log(`\nNOT BLESSED — ${why}`);
  console.log("The screenshot gate did not run. It cannot pass or fail until a baseline");
  console.log(`shot on this platform (${process.platform}) exists at "${base}".`);
  console.log("Fix, one line:  node scripts/visual-check.mjs --bless   (then commit the PNGs)");
  console.log("For the images CI compares against, bless on a Linux runner — scripts/README.md.");
};

const baseFiles = pngs(base);
if (!baseFiles.length) {
  banner(`no baseline images in "${base}"`);
  process.exit(0);
}

/* meta.json is written by shoot.mjs. A baseline without one predates this
   harness, so treat its platform as unknown and compare anyway — an unknown
   baseline that happens to match is still a pass. */
let baseMeta = null;
try {
  baseMeta = JSON.parse(readFileSync(join(base, "meta.json"), "utf8"));
} catch {
  baseMeta = null;
}
if (baseMeta?.platform && baseMeta.platform !== process.platform) {
  banner(`baseline was shot on ${baseMeta.platform}, this machine is ${process.platform}`);
  process.exit(0);
}

const candFiles = pngs(cand);
if (!candFiles.length) {
  console.log(`FAILED — no candidate images in "${cand}" (did shoot.mjs run?)`);
  process.exit(1);
}

const diffDir = join(cand, "_diff");
let bad = 0;
const note = (name, msg) => {
  console.log(`${name.padEnd(26)} ${msg}`);
  bad++;
};

for (const f of baseFiles) {
  const candPath = join(cand, f);
  if (!existsSync(candPath)) {
    note(f, "MISSING from candidate");
    continue;
  }
  const a = PNG.sync.read(readFileSync(join(base, f)));
  const b = PNG.sync.read(readFileSync(candPath));
  if (a.width !== b.width || a.height !== b.height) {
    note(f, `SIZE ${a.width}x${a.height} -> ${b.width}x${b.height}`);
    continue;
  }
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  const pct = (100 * n) / (a.width * a.height);
  if (pct > MAX_DIFF_PCT) {
    mkdirSync(diffDir, { recursive: true });
    writeFileSync(join(diffDir, f), PNG.sync.write(out));
    note(f, `${pct.toFixed(3)}% px differ  -> ${join(diffDir, f)}`);
  }
}

/* A tab added to src/App.jsx without re-blessing would otherwise sail through:
   the baseline has no file for it, so nothing is compared and the new screen
   is never checked again. */
for (const f of candFiles) {
  if (!baseFiles.includes(f)) note(f, "NEW — not in baseline");
}

if (bad) {
  console.log(`\nVISUAL DIFF FAILED — ${bad} of ${baseFiles.length} differ vs ${base}`);
  console.log("If the change is intended, re-bless:  node scripts/visual-check.mjs --bless");
  process.exit(1);
}
console.log(`\nVISUAL DIFF PASSED — ${baseFiles.length} shots match ${base} (<${MAX_DIFF_PCT}% px)`);
