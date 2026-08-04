/* The visual gate, end to end. One command, same one CI runs.

     node scripts/visual-check.mjs            check:  build -> console -> shoot -> diff
     node scripts/visual-check.mjs --bless    re-bless: build -> shoot into the baseline

   --bless is the escape hatch. When a change is meant to move pixels, run it,
   look at the new PNGs, and commit visual-baseline/. A gate with no documented
   way to update it gets deleted the first time it is inconvenient.

   Flags:
     --bless           overwrite the baseline instead of comparing against it
     --baseline <dir>  default visual-baseline   (committed; CI compares to it)
     --dist <dir>      default dist-mock         (gitignored via dist-*)
     --out <dir>       default dist-visual-shots (gitignored via dist-*)
     --skip-build      reuse an existing --dist bundle
     --skip-console    skip the console gate (it is skipped by --bless anyway)
     --wait <ms>       per-page settle, default 11000

   The build is deliberately its own thing rather than the deploy's build:
   VITE_HA_URL is forced empty so the app runs on GH_DATA mock state. A build
   pointed at the real Home Assistant would screenshot whatever the house
   happened to be doing, which is not something a diff can be run against. To
   stop a developer's .env.local leaking back in, env files are read from an
   empty temp directory, and the output is scanned for the live URL afterwards. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { flags } = parseArgs(process.argv.slice(2), ["baseline", "dist", "out", "wait"]);
const baseline = resolve(root, flags.baseline || "visual-baseline");
const dist = resolve(root, flags.dist || "dist-mock");
const bless = Boolean(flags.bless);
const shotsOut = bless ? baseline : resolve(root, flags.out || "dist-visual-shots");
const waitArgs = flags.wait ? ["--wait", String(flags.wait)] : [];

/* Reads the live HA URL a developer has configured locally, so the mock build
   can be proven not to contain it. Returns null in CI, where no env file
   exists. */
function configuredHaUrl() {
  for (const f of [".env.local", ".env"]) {
    let txt;
    try {
      txt = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*VITE_HA_URL\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[1].replace(/\s+#.*$/, "").trim().replace(/^['"]|['"]$/g, "");
      if (v) return v;
    }
  }
  return null;
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

function run(script, args) {
  console.log(`\n$ node scripts/${script} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [join(here, script), ...args], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!flags["skip-build"]) {
  console.log(`building mock bundle -> ${dist}`);
  process.env.VITE_HA_URL = "";
  process.env.VITE_SPOTIFY_CLIENT_ID = "";
  const { build } = await import("vite");
  await build({
    root,
    envDir: mkdtempSync(join(tmpdir(), "gh-mock-env-")),
    logLevel: "warn",
    build: { outDir: dist, emptyOutDir: true },
  });

  const live = configuredHaUrl();
  if (live) {
    const text = /\.(js|css|html|json|webmanifest|svg|map)$/;
    const leaked = filesUnder(dist)
      .filter((p) => text.test(p))
      .filter((p) => readFileSync(p, "utf8").includes(live));
    if (leaked.length) {
      console.error(`[visual-check] build is NOT in mock mode — ${live} appears in ${leaked[0]}`);
      console.error("[visual-check] screenshots of live house state cannot be diffed; aborting.");
      process.exit(1);
    }
  }
}

if (!bless && !flags["skip-console"]) run("console-check.mjs", [dist, ...waitArgs]);

run("shoot.mjs", [dist, shotsOut, ...waitArgs]);

if (bless) {
  console.log(`\nBASELINE RE-BLESSED -> ${shotsOut}`);
  console.log("Look at the PNGs, then commit them. They are what every later run is judged against.");
  process.exit(0);
}

run("pixel-diff.mjs", [baseline, shotsOut]);
