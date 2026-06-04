# Glasshouse UI — file-structure refactor plan

> Goal: break up `cards.jsx` (5,075 lines), `styles.css` (4,190), and `App.jsx` (639)
> into a folder structure where **every folder has one rule about what lives in it**,
> and no source file exceeds ~400 lines again.
>
> Status: planned 2026-06-04. Phases are independent commits, each build- and
> screenshot-verified before push.

---

## 1. Target structure

```
ui/src/
├── main.jsx
├── App.jsx                  # slim shell: tab state, URL params, layout chrome only
├── theme.js                 # theme math + tweaks persistence (absorbs App's load/persist/applyTheme)
├── data.js                  # GH_DATA mock fallback (unchanged)
│
├── ha/                      # ← RULE: transport only. Talks to HA/Spotify. No JSX, no React
│   └── (unchanged — already clean: socket, client, spotify, useEntity, …)
│
├── components/              # ← RULE: entity-agnostic primitives. Props in, JSX out.
│   │                        #   MUST NOT import from ha/ or data.js. If it needs an
│   │                        #   entity, it doesn't belong here — it's a card.
│   ├── Card.jsx             # Card shell (from cards.jsx:37)
│   ├── EntityGuard.jsx      # loading/missing states (cards.jsx:69)
│   ├── StatBox.jsx          # generic stat chip (cards.jsx:4516)
│   ├── WeatherIcon.jsx      # pure SVG (cards.jsx:109)
│   ├── Toast.jsx            # ToastItem + ServiceErrorToast (App.jsx:355–427)
│   ├── BootScreen.jsx       # moved as-is
│   └── TweaksDrawer.jsx     # moved as-is
│
├── hooks/                   # ← RULE: reusable logic, no JSX returned. One hook
│   │                        #   (+ its private helpers) per file, named use*.js
│   ├── useNow.js            # (cards.jsx:26)
│   ├── useOptimistic.js     # NEW — extracts the 51× setX/callService/.catch-revert pattern
│   ├── useClimateDerived.js # NEW — shared math from RoomClimateCard + RoomClimateStrip:
│   │                        #   stale fallback, tempHist, trend, temp/hum bands, verdict,
│   │                        #   ring geometry, sparkline scaling
│   ├── useViewport.js       # (App.jsx:428)
│   └── useDashReady.js      # (App.jsx:450)
│
├── cards/                   # ← RULE: one folder per dashboard tab. A card file contains
│   │                        #   exactly one exported card + its private subcomponents and
│   │                        #   constants. Cards subscribe via hooks/ + ha/, render via
│   │                        #   components/. Soft cap 300 lines/file.
│   ├── index.js             # barrel: re-exports every card (keeps import churn at zero)
│   ├── overview/
│   │   ├── WeatherSunHero.jsx      # cards.jsx:212  (~215 ln)
│   │   ├── PresenceCard.jsx        # cards.jsx:427
│   │   ├── ScenesCard.jsx          # cards.jsx:455
│   │   ├── NextEventCard.jsx       # cards.jsx:3562
│   │   ├── RoomClimateStrip.jsx    # cards.jsx:4844 (uses useClimateDerived)
│   │   ├── PlayStrip.jsx           # cards.jsx:3014
│   │   ├── SamBoxStrip.jsx         # cards.jsx:2942 (+ SamBoxCard wrapper, cards.jsx:3005)
│   │   └── statboxes.jsx           # Bambu/Levoit/Vacuum/AdGuard StatBox wrappers
│   │                               # (cards.jsx:4994–5075 — 4 tiny look-alikes, one file)
│   ├── lights/
│   │   ├── LightCard.jsx           # cards.jsx:1889 + LIGHT_PRESETS
│   │   ├── DeskStripCard.jsx       # cards.jsx:2125 + GOVEE_PRESETS + GOVEE_GAP
│   │   ├── QuickLightsCard.jsx     # cards.jsx:2520 + QuickToggle (cards.jsx:2449)
│   │   └── presets.jsx             # NEW shared PresetRow swatch component
│   ├── media/
│   │   ├── MediaCard.jsx           # cards.jsx:492
│   │   ├── NowPlayingHero.jsx      # cards.jsx:3022 (~180 ln)
│   │   ├── SpotifyConnectCard.jsx  # cards.jsx:3203 (~165 ln)
│   │   ├── SpotifyTrackRow.jsx     # cards.jsx:3368 (shared by the 4 below)
│   │   ├── SpotifySearchCard.jsx   # cards.jsx:3409
│   │   ├── SpotifyPlaylistsCard.jsx# cards.jsx:3456
│   │   ├── SpotifyQueueCard.jsx    # cards.jsx:3485
│   │   └── SpotifyRecentCard.jsx   # cards.jsx:3530
│   ├── climate/
│   │   ├── RoomClimateCard.jsx     # cards.jsx:4561 (uses useClimateDerived)
│   │   ├── AirPurifierCard.jsx     # cards.jsx:1230 + SPEED_TO_PCT/PCT_TO_SPEED
│   │   ├── HeaterCard.jsx          # cards.jsx:1317
│   │   └── FanCard.jsx             # cards.jsx:2338 (still mock — no fan.ceiling entity)
│   ├── workshop/
│   │   ├── PrinterCard.jsx         # cards.jsx:652 + PrinterPreview (cards.jsx:590) (~310 ln)
│   │   ├── VacuumCard.jsx          # cards.jsx:969 + FloorPlan (cards.jsx:902)   (~325 ln)
│   │   └── PixooCard.jsx           # cards.jsx:2650 (~190 ln)
│   ├── system/
│   │   ├── PiCard.jsx              # cards.jsx:1497 + PI_RAM_MIB/PI_DISK_GIB
│   │   ├── BackupCard.jsx          # cards.jsx:1573
│   │   ├── StorageCard.jsx         # cards.jsx:1657
│   │   ├── EntityHealthCard.jsx    # cards.jsx:1704
│   │   ├── SystemActionsCard.jsx   # cards.jsx:1784 + SYSTEM_ACTIONS
│   │   ├── InProgressCard.jsx      # cards.jsx:1832
│   │   ├── AdGuardCard.jsx         # cards.jsx:1392 + AdGuardSimpleCard (2535) + BlockedDomainsCard (1478)
│   │   ├── UptimeCard.jsx          # cards.jsx:2594
│   │   └── AddonsCard.jsx          # cards.jsx:2841 (still mock)
│   └── schedule/
│       ├── WeeklyCalendarCard.jsx  # cards.jsx:3871 + DOWS + CAL_PALETTE (~300 ln)
│       ├── NewEventDialog.jsx      # cards.jsx:3656 (~175 ln)
│       └── KanbanBoardCard.jsx     # cards.jsx:4257 + KanbanAddForm (4442) + KANBAN_* consts (~340 ln)
│
├── views/                   # ← RULE: layout composition only. A view imports cards and
│   │                        #   arranges them in a grid. No entity subscriptions, no
│   │                        #   service calls, no useState beyond layout. One view per
│   │                        #   tab, default-exported for React.lazy.
│   ├── OverviewView.jsx     # App.jsx:207
│   ├── LightsView.jsx       # App.jsx:239
│   ├── MediaView.jsx        # App.jsx:290
│   ├── ScheduleView.jsx     # App.jsx:303
│   ├── ClimateView.jsx      # App.jsx:312
│   ├── WorkshopView.jsx     # App.jsx:324
│   └── SystemView.jsx       # App.jsx:333
│
└── styles/                  # ← RULE: mirrors the cards/ folders 1:1, plus base layers.
    │                        #   Each file owns its OWN phone overrides (media queries
    │                        #   co-located at the bottom of the file — never in a
    │                        #   central "phone" file). index.css is an import manifest
    │                        #   whose order MUST preserve today's cascade order.
    ├── index.css            # @import manifest — order = current styles.css order
    ├── base.css             # styles.css banner "base styles" + sky backdrop + mullions (≈ ln 1–116)
    ├── shell.css            # shell + nav + tab bar + bottom phone nav (≈ ln 117–241, 500–565)
    ├── card.css             # card primitive, entity states, buttons, grid (≈ ln 242–462)
    ├── overview.css         # weather hero, presence, scenes, statboxes, sun arc, forecast
    ├── lights.css           # scene buttons / light + desk strip
    ├── media.css            # media card, now-playing hero, spotify lists
    ├── climate.css          # purifier, heater, room climate card + strip (≈ ln 1842–2038, 2259–2715)
    ├── workshop.css         # printer, vacuum, workshop overrides (≈ ln 1063–1841)
    ├── system.css           # Pi, AdGuard ring, health list, backup/shopping (≈ ln 2038–2258, 2716–2774)
    ├── schedule.css         # calendar + kanban (≈ ln 2793–3481)
    ├── tweaks.css           # tweaks drawer (≈ ln 3482–3729)
    └── toast.css            # service error toast (≈ ln 3730–end) + view transition (2775)

boot.css stays as-is (408 ln, single-purpose, untouched during feature work).
```

### Folder rules — summary table

| Folder | What's similarly built there | Hard rule |
|---|---|---|
| `ha/` | HA/Spotify transport + data hooks | No JSX |
| `components/` | Dumb, reusable primitives | No imports from `ha/` or `data.js` |
| `hooks/` | Cross-card logic | Returns data/handlers, never JSX; one hook per file |
| `cards/<tab>/` | One card per file, grouped by the tab it renders on | One exported card + private subparts; ≤ ~300 lines |
| `views/` | Grid layouts per tab | Compose cards only; no entity logic |
| `styles/` | One CSS file per cards/ folder + base layers | Phone overrides live in the same file as the desktop rules they override |

A card used on two tabs lives in the folder of its *primary* tab (e.g. `RoomClimateStrip`
is the Overview variant → `overview/`; the full card → `climate/`). The barrel makes
placement invisible to consumers.

---

## 2. Migration phases

Each phase = one commit on `main` of the ui repo, gated by:
`npm run build` clean → deploy via CI → Playwright full-page screenshots of all
7 tabs (`?tab=overview|lights|media|schedule|climate|workshop|system`) compared
against the Phase-0 baseline.

### Phase 0 — baseline (no code change)
- Capture Playwright screenshots of all 7 tabs (desktop + `?viewport=phone`) into
  `ui/.refactor-baseline/` (gitignored). These are the visual contract for every
  later phase.

### Phase 1 — mechanical split of `cards.jsx` (zero logic change)
1. Create `components/` (Card, EntityGuard, StatBox, WeatherIcon), `hooks/useNow.js`,
   and the seven `cards/<tab>/` folders per the map above. **Cut-paste only** — no
   refactoring, no renames, keep comments.
2. Create `cards/index.js` barrel re-exporting everything `App.jsx` currently imports
   (all 42 symbols) plus `fmtTime`/`useNow` passthroughs.
3. Change `App.jsx`'s single import from `"./cards.jsx"` → `"./cards/index.js"`.
4. Delete `cards.jsx`.
- Risk: low. Watch for module-scope state (e.g. `GOVEE_GAP` throttle timestamps) —
  keep each constant with its card.

### Phase 2 — dedupe (the only phase that changes logic)
1. `hooks/useClimateDerived.js`: extract the duplicated derivation from
   `RoomClimateCard` + `RoomClimateStrip` (stats fallback, tempHist, trend, bands,
   verdict, ring/sparkline geometry). Both components become render-only.
2. `hooks/useOptimistic.js`: `useOptimisticToggle(domain, entityId, isOn)` and a
   generic `useOptimisticService()`. Migrate the simple toggle cards first
   (QuickToggle, HeaterCard, AdGuardSimpleCard, SamBoxStrip…); leave complex
   multi-field optimistic flows (DeskStripCard color/brightness) for later — don't
   force the abstraction.
3. `cards/lights/presets.jsx`: shared `PresetRow` for LIGHT_PRESETS / GOVEE_PRESETS.
- Risk: medium — this is behavior-adjacent. Verify toggles interactively with
  chrome-devtools (toggle a light, watch revert on failure), not just screenshots.

### Phase 3 — slim `App.jsx` + lazy views
1. Move the 6 view components → `views/` (default exports). ScheduleView included = 7.
2. Move Toast components → `components/Toast.jsx`.
3. Move `loadStoredTweaks`/`persistTweaks`/`applyTheme` → `theme.js`.
4. `React.lazy()` each view + `<Suspense>` with a minimal skeleton; keep
   OverviewView eagerly imported (it's the landing tab — no flash on boot).
- Result: App.jsx ≈ 250 lines; per-tab JS chunks; Spotify code no longer parsed
  unless the Media tab opens.

### Phase 4 — split `styles.css`
1. Cut the banner-delimited sections into `styles/*.css` per the map.
2. `styles/index.css` `@import`s them **in the exact order they appear today**
   (cascade order is the contract — later files win ties).
3. Re-home the scattered phone overrides (styles.css ln 463–706 block) into the
   card-family file they belong to.
4. Point `main.jsx` at `styles/index.css`; delete `styles.css`.
- Risk: cosmetic only, but diff every baseline screenshot pixel-wise — specificity
  ties resolved by order are the failure mode.

### Phase 5 — guardrail + docs
1. Add ESLint `max-lines: ["warn", {"max": 400, "skipBlankLines": true, "skipComments": true}]`
   so nothing regrows silently.
2. Update `CLAUDE.md` Layout section + the "How the UI gets live data" example to
   reference the new paths (`cards/<tab>/`, `hooks/useOptimistic.js`).
3. Delete `ui/.refactor-baseline/` and this plan file once done.

---

## 3. Order & estimated effort

| Phase | Effort | Risk | Depends on |
|---|---|---|---|
| 0 baseline | XS | none | — |
| 1 cards split | M (mostly mechanical) | low | 0 |
| 2 dedupe | M | medium | 1 |
| 3 views + lazy | S | low | 1 |
| 4 styles split | M | low-medium (cascade order) | 3 (views pair with css files) |
| 5 guardrail | XS | none | all |

Phases 2 and 3 are independent of each other and can land in either order.
