# The checks

Four gates, cheapest first. CI runs them in this order and so should you.

| | Command | Catches | Takes |
|---|---|---|---|
| 1 | `npm run lint` | undefined identifiers — the typo that builds fine and blanks one lazy-loaded tab in production | seconds |
| 2 | `npm test` | date maths, optimistic on/off, role rules, calendar range | seconds |
| 3 | `node scripts/console-check.mjs <dist>` | anything that throws when a tab is opened | ~80s |
| 4 | `node scripts/visual-check.mjs` | a screen that changed shape without anyone meaning it to | ~4 min |

Gates 3 and 4 both need a browser: `npx playwright install --with-deps chromium`.

## The one line you actually need

A change that is *meant* to move pixels makes gate 4 red. Re-bless it:

```bash
node scripts/visual-check.mjs --bless      # then look at the PNGs and commit visual-baseline/
```

That is the whole escape hatch. If it ever feels easier to delete the gate than
to run that, the gate is wrong — fix the gate.

## Re-blessing the images CI compares against

Screenshots are only comparable when the same renderer took both. Fonts and
antialiasing differ between operating systems, so a baseline shot on Windows
will differ from a CI run on Ubuntu on every tile. `visual-baseline/meta.json`
records which platform shot it, and `pixel-diff.mjs` refuses to compare across
platforms: it prints a `NOT BLESSED` banner and exits 0 rather than failing a
deploy for a reason no code change can fix.

So the committed baseline has to be a Linux one. Shoot it on a runner:

```bash
gh workflow run ci.yml -f bless=true
gh run list --workflow ci.yml --limit 1                       # get the run id
gh run download <run-id> -n visual-baseline -D visual-baseline
git add visual-baseline && git commit -m "chore: re-bless visual baseline"
```

CI deliberately does not commit this itself. A new baseline is what every later
run is judged against, so a human looks at it first.

The same applies after a GitHub runner image update changes the font stack: the
diff goes red everywhere at once, which is the tell. Look at one diff image
from the failed run's `visual-candidate` artifact — if it is grey fringing on
text, re-bless; if it is a card in the wrong place, it is a real bug.

## What each script does

- **`harness.mjs`** — the tab list, the two viewports, the static server, and
  the URL that pins theme and clock. Shared so a new tab is added once.
- **`console-check.mjs`** — loads every tab, fails on `console.error` or an
  uncaught exception. Warnings print but do not fail: a mock build always warns
  that `VITE_HA_URL` is unset, and a gate that is red by design is a gate people
  learn to ignore.
- **`shoot.mjs`** — 7 tabs x 2 viewports, full page, animations frozen, plus a
  `meta.json` saying what shot them.
- **`pixel-diff.mjs`** — fails over 0.05% of pixels, on a size change, on a
  missing shot, and on a shot the baseline has never seen (a new tab must be
  blessed, not silently unchecked). Writes diff images to `_diff/`.
- **`visual-check.mjs`** — runs the build, then 3 and 4 in order. This is the
  one CI calls.

## Why the mock build

`visual-check.mjs` builds its own bundle with `VITE_HA_URL=""`, so the app runs
on the `GH_DATA` fallback instead of live house state — otherwise the diff would
fail whenever a light was on. Env files are read from an empty temp directory so
a developer's `.env.local` cannot leak the real URL back in, and the output is
scanned for that URL afterwards as a second check.

Working directories (`dist-mock`, `dist-visual-shots`) start with `dist-`, which
`.gitignore` already covers. `visual-baseline/` is committed on purpose.
