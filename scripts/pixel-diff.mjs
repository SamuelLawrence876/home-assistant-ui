/* Pixel-diff two screenshot dirs produced by scripts/shoot.mjs.
   Usage: node scripts/pixel-diff.mjs <baselineDir> <candidateDir>
   Exits 1 if any pair differs by more than 0.05% of pixels or by size. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [base = ".refactor-baseline", cand = ".refactor-phase1"] = process.argv.slice(2);
let bad = 0;
for (const f of readdirSync(base).filter((f) => f.endsWith(".png"))) {
  const a = PNG.sync.read(readFileSync(join(base, f)));
  const b = PNG.sync.read(readFileSync(join(cand, f)));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${f.padEnd(24)} SIZE MISMATCH ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    bad++;
    continue;
  }
  const n = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  const pct = (100 * n) / (a.width * a.height);
  if (pct > 0.05) { console.log(`${f.padEnd(24)} ${pct.toFixed(3)}% px differ`); bad++; }
}
console.log(bad ? `${bad} FAILURES vs ${base}` : `ALL MATCH ${base} (<0.05% px)`);
process.exit(bad ? 1 : 0);
