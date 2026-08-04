/* Glasshouse v2 — top-level Dashboard.
   Honors initial URL params:
     ?viewport=desktop|phone  (default desktop, also used for the in-frame phone preview in the canvas)
     ?lean=conservatory|frosted|atrium
     ?mode=auto|day|night
     ?tab=overview|lights|media|schedule|climate|workshop|system
     ?clock=HH:MM (forces theme.js's clock override)
   Every one of these is coerced on the way in (theme.js's coerce* helpers):
   an unrecognised value falls back to the default and is never persisted.
   Tweaks (lean / mode / clock override) are also editable live via the
   in-app Tweaks drawer (cog button, top right). Settings persist to
   localStorage.

   Views are lazy-loaded per tab (Overview eager — it's the landing tab),
   so each tab's cards ship as their own chunk. */

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import {
  skyColors,
  sunTimesFromEntity,
  loadStoredTweaks,
  persistTweaks,
  applyTheme,
  LEANS,
  coerceLean,
  coerceMode,
  coerceClock,
  coerceBootStyle,
} from "./theme.js";
import { useConnectionStatus, useEntityCounts, useEntity } from "./ha/useEntity.js";
import { useCurrentUser } from "./ha/useCurrentUser.js";
import { onServiceError } from "./ha/client.js";
import { readURLParam } from "./lib/url.js";
import { deriveRole, canSeeTab, ROLE_PENDING } from "./lib/roles.js";
import { fmtTime } from "./lib/format.js";
import { useNow } from "./hooks/useNow.js";
import { useViewport } from "./hooks/useViewport.js";
import { useDashReady } from "./hooks/useDashReady.js";
import { ServiceErrorToast } from "./components/Toast.jsx";
import { ErrorBoundary, takePendingTab } from "./components/ErrorBoundary.jsx";
import BootScreen from "./BootScreen.jsx";
import { TweaksDrawer } from "./TweaksDrawer.jsx";

import OverviewView from "./views/OverviewView.jsx";
const LightsView = lazy(() => import("./views/LightsView.jsx"));
const MediaView = lazy(() => import("./views/MediaView.jsx"));
const ScheduleView = lazy(() => import("./views/ScheduleView.jsx"));
const ClimateView = lazy(() => import("./views/ClimateView.jsx"));
const WorkshopView = lazy(() => import("./views/WorkshopView.jsx"));
const SystemView = lazy(() => import("./views/SystemView.jsx"));

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "lights", label: "Lights" },
  { id: "media", label: "Media" },
  { id: "schedule", label: "Schedule" },
  { id: "climate", label: "Climate" },
  { id: "workshop", label: "Workshop" },
  { id: "system", label: "System" },
];

/* Service-error toasts. The subscription lives here rather than inside
   components/Toast.jsx: components/ is entity-agnostic by rule and must not
   import ha/. Toast.jsx just draws the list it is handed. */
let toastIdCounter = 0;
function useServiceErrors() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  useEffect(
    () =>
      onServiceError(({ domain, service, data, error }) => {
        const entityId = data?.entity_id || "";
        const errMsg = error?.message || String(error);
        const shortErr = errMsg.length > 120 ? errMsg.slice(0, 120) + "…" : errMsg;
        const label = entityId ? `${domain}.${service} on ${entityId}` : `${domain}.${service}`;
        setToasts((t) => [...t.slice(-4), { id: ++toastIdCounter, label, detail: shortErr }]);
      }),
    [],
  );
  return { toasts, dismiss };
}

/* Shown while a lazy view chunk downloads. `fallback={null}` used to leave
   the tab body completely empty on a slow phone connection. */
function ViewSkeleton() {
  return (
    <div className="grid" role="status" aria-label="Loading tab">
      <div className="col-8"><div className="entity-loading" style={{ height: 260 }} /></div>
      <div className="col-4"><div className="entity-loading" style={{ height: 260 }} /></div>
      <div className="col-12"><div className="entity-loading" style={{ height: 140 }} /></div>
    </div>
  );
}

function ConnectionChip() {
  const status = useConnectionStatus();
  const { available, total } = useEntityCounts();
  const live = status === "ready";
  const dotColor = live
    ? "var(--good)"
    : status === "disconnected"
      ? "var(--bad)"
      : "var(--accent-2)";
  const label = live
    ? `Pi · ${available}/${total} live`
    : status === "disconnected"
      ? "Pi offline"
      : status === "authenticating"
        ? "Pi · authenticating…"
        : "Pi · connecting…";
  /* Announced separately from the visible chip, and deliberately built
     from `status` alone. The chip's own text carries the entity count,
     which moves on every state batch from HA — wire a live region to
     that and a screen reader reads the connection chip over the top of
     whatever the user was actually doing, several times a minute. This
     changes only when the connection itself does. */
  const announcement = live
    ? "Connected to Home Assistant"
    : status === "disconnected"
      ? "Not connected to Home Assistant"
      : "Connecting to Home Assistant";
  return (
    <>
    <span className="visually-hidden" role="status">
      {announcement}
    </span>
    <span
      className="chip"
      style={{
        background: "transparent",
        borderColor: "var(--rule)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
      title={`HA WebSocket: ${status}`}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: live ? `0 0 8px ${dotColor}` : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }}
      />
      {label}
    </span>
    </>
  );
}

function MullionGrid({ lean }) {
  if (lean === "frosted") return null;
  const verts = lean === "atrium" ? [16, 32, 50, 68, 84] : [25, 50, 75];
  const horiz = lean === "atrium" ? [12, 60] : [16];
  return (
    <div className="mullions" aria-hidden>
      {verts.map((p, i) => (
        <div key={`v${i}`} className="vert" style={{ left: `${p}%` }} />
      ))}
      {horiz.map((p, i) => (
        <div key={`h${i}`} className="horiz" style={{ top: `${p}%` }} />
      ))}
    </div>
  );
}

export default function App() {
  const viewport = useViewport();
  const tabsRef = useRef(null);
  const dashReady = useDashReady();
  const [booting, setBooting] = useState(true);

  // RBAC (display layer — HA groups are the enforcement layer, see lib/roles.js)
  const connectionStatus = useConnectionStatus();
  const currentUser = useCurrentUser();
  const role = deriveRole(currentUser, connectionStatus === "ready");
  const rolePending = role === ROLE_PENDING;
  const visibleTabs = useMemo(() => TABS.filter((t) => canSeeTab(role, t.id)), [role]);

  const initial = useMemo(() => {
    const stored = loadStoredTweaks();
    // A chunk-load failure auto-reloads (components/ErrorBoundary.jsx) and
    // stashes the tab it died on, because the effect below has already
    // stripped ?tab= — without the hand-off the self-heal silently dumps you
    // back on Overview.
    const tab = takePendingTab() || readURLParam("tab", "overview");
    // Coerce everything on the way in. A mistyped ?lean= used to reach
    // applyTheme, throw out of a useEffect, and take the whole root with it —
    // after the persist effect had already written the bad value to
    // localStorage, so every later visit was bricked too.
    // coerceLean's `LEANS[v]` test reads through the prototype chain, so
    // ?lean=constructor / toString / valueOf / __proto__ all sail past it and
    // land on a config object with no .day. Screen the raw value against
    // LEANS's *own* keys before it gets there.
    const rawLean = readURLParam("lean", null) || stored.lean;
    return {
      lean: coerceLean(Object.hasOwn(LEANS, String(rawLean)) ? rawLean : undefined),
      mode: coerceMode(readURLParam("mode", null) || stored.mode),
      clockOverride: stored.clockOverride === true,
      clock: coerceClock(stored.clock),
      bootStyle: coerceBootStyle(stored.bootStyle),
      tab: TABS.some((t) => t.id === tab) ? tab : "overview",
    };
  }, []);

  const [lean, setLean] = useState(initial.lean);
  const [modePref, setModePref] = useState(initial.mode); // 'auto' | 'day' | 'night'
  const [clockOverride, setClockOverride] = useState(initial.clockOverride);
  const [clock, setClock] = useState(initial.clock);
  const [bootStyle, setBootStyle] = useState(initial.bootStyle);
  const [tab, setTab] = useState(initial.tab);
  const { toasts, dismiss: dismissToast } = useServiceErrors();

  /* ---- Tab semantics -------------------------------------------------
     The two navs are a real ARIA tablist each. Only ever one of them is
     exposed at a time: phone.css hides `.tabs` under body.viewport-phone
     and `.bottom-nav` everywhere else, and `display: none` takes an
     element out of the accessibility tree as well as off the screen. So
     the ids below can't collide in practice, and the panel's
     aria-labelledby points at whichever tab the user can actually see.

     `tabFocus` is the roving-tabindex cursor: exactly one tab is in the
     tab sequence, and the arrow keys move focus along the rest. It
     deliberately does NOT select as it moves — every view is its own
     lazily-loaded chunk, and selection-following-focus would download
     six of them just to walk past them. Enter and Space activate, which
     a real <button> gives us for free. */
  const [tabFocus, setTabFocus] = useState(null);
  useEffect(() => {
    setTabFocus(null);
  }, [tab]);
  const rovingTab = visibleTabs.some((t) => t.id === tabFocus) ? tabFocus : tab;
  const panelId = `tabpanel-${tab}`;
  const tabButtonId = (id, place) => `tab-${place}-${id}`;
  const activeTabId = tabButtonId(tab, viewport === "phone" ? "bottom" : "top");

  function onTablistKeyDown(e) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    const items = [...e.currentTarget.querySelectorAll('[role="tab"]')];
    const from = items.indexOf(document.activeElement);
    if (from === -1) return;
    e.preventDefault();
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (from + step + items.length) % items.length;
    items[to].focus();
    setTabFocus(items[to].dataset.tab);
  }

  // If the current tab isn't allowed for this role (deep link, or role
  // resolved after connect), snap to the first tab the role can see.
  // Skipped while the role is still pending: auth/current_user is a WS
  // round-trip behind "ready", and treating that window as "guest" threw
  // away every ?tab= deep link before the real role arrived.
  useEffect(() => {
    if (rolePending) return;
    if (!canSeeTab(role, tab)) setTab(visibleTabs[0]?.id || "overview");
  }, [rolePending, role, tab, visibleTabs]);

  // Clean ?tab= from URL after reading it so refreshes default to overview
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("tab")) {
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  /* Real sunrise/sunset for the sky, from the same sun.sun the Overview
     weather card already shows. The theme used to hardcode a British
     midsummer, so in December it kept the sky bright four hours past sunset.

     Only the five timestamp attributes are pulled out and depended on.
     sun.sun also carries `elevation` and `azimuth`, which HA republishes
     every ~30 seconds — depending on the entity object itself would
     recompute the whole palette on every one of those (LESSONS.md pattern 1).
     The timestamps move twice a day. */
  const sunEntity = useEntity("sun.sun");
  const sunState = sunEntity?.state;
  const sunAttrs = sunEntity?.attributes;
  const nextRising = sunAttrs?.next_rising;
  const nextSetting = sunAttrs?.next_setting;
  const nextDawn = sunAttrs?.next_dawn;
  const nextDusk = sunAttrs?.next_dusk;
  const nextNoon = sunAttrs?.next_noon;
  const sunTimes = useMemo(
    () =>
      sunTimesFromEntity({
        state: sunState,
        attributes: {
          next_rising: nextRising,
          next_setting: nextSetting,
          next_dawn: nextDawn,
          next_dusk: nextDusk,
          next_noon: nextNoon,
        },
      }),
    [sunState, nextRising, nextSetting, nextDawn, nextDusk, nextNoon],
  );

  // Live clock (rerenders every 30s); honors clockOverride
  const liveNow = useNow();
  const now = clockOverride ? clock : liveNow;
  const skyHour = modePref === "day" ? 13 : modePref === "night" ? 23 : now;
  // sunTimes is null in mock mode and until the first snapshot arrives;
  // skyColors falls back to the authored day rather than drawing nothing.
  const sky = useMemo(() => skyColors(skyHour, sunTimes), [skyHour, sunTimes]);
  const effectiveMode = modePref === "auto" ? (sky.isDay ? "day" : "night") : modePref;

  // Apply theme on every change
  useEffect(() => {
    applyTheme(lean, effectiveMode, sky);
    document.body.classList.toggle("viewport-phone", viewport === "phone");
    document.body.classList.toggle("viewport-desktop", viewport !== "phone");
  }, [lean, effectiveMode, sky.top, sky.bot, sky.phase, viewport]);

  // Persist tweaks. Declared *after* applyTheme on purpose: effects run in
  // declaration order, so a value applyTheme rejects never reaches storage.
  useEffect(() => {
    persistTweaks({ lean, mode: modePref, clockOverride, clock, bootStyle });
  }, [lean, modePref, clockOverride, clock, bootStyle]);

  /* Tab indicator position. The `document.fonts.ready` pass is the
     load-bearing one: the fonts come from Google Fonts with `display=swap`, so
     first paint uses a fallback face. This effect ran on mount against those
     fallback metrics and nothing re-ran it, so the pill kept a width measured
     for text no longer on screen until you changed tabs. It surfaced as a
     flaky pixel gate — winning the race varied between two runs of identical
     code (0.056%, just over the 0.05% budget) — but the flake was the symptom
     and a mis-sized pill on first paint was the bug. */
  useEffect(() => {
    /* Needs no cleanup: it re-reads the live DOM on every call, so a late
       resolution no-ops after unmount (the ref is null) and still lands on the
       right button if the deps moved first. `?.` because jsdom has no
       document.fonts; `.catch` because a face that fails to load must not
       leave an unhandled rejection — the mount-time pass above still stands. */
    const place = () => {
      const el = tabsRef.current;
      if (!el) return;
      const active = el.querySelector("button.on");
      const ind = el.querySelector(".indicator");
      if (active && ind) {
        ind.style.left = `${active.offsetLeft}px`;
        ind.style.width = `${active.offsetWidth}px`;
      }
    };
    place();
    document.fonts?.ready.then(place).catch(() => {});
  }, [tab, viewport, visibleTabs]);

  const greeting = sky.isDay
    ? now < 12
      ? "Good morning"
      : now < 17
        ? "Good afternoon"
        : "Good evening"
    : "Good evening";

  const cur =
    effectiveMode === "night" ? "Night mode · sky " + sky.top.slice(6, 11) : `${greeting}, Samuel`;

  return (
    <>
      <div className="sky" />
      <MullionGrid lean={lean} />

      <div className="shell">
        {/* Off-screen until it takes focus (a11y.css). Skips the seven
            section tabs, which otherwise sit between the top of the page
            and the dashboard on every single load. */}
        <a className="skip-link" href={`#${panelId}`}>
          Skip to dashboard
        </a>
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path
                  d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <div className="brand-text">
              {/* A real h1 so the page has a top-level heading to land on.
                  a11y.css zeroes the margin and the weight the tag brings
                  with it, so it renders exactly as the div did. */}
              <h1 className="nm">Glasshouse</h1>
              <div className="sub">
                <span className="dot" />
                {cur}
              </div>
            </div>
          </div>

          {viewport !== "phone" && (
            <div
              className="tabs"
              ref={tabsRef}
              role="tablist"
              aria-label="Sections"
              onKeyDown={onTablistKeyDown}
            >
              <span className="indicator" aria-hidden />
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  id={tabButtonId(t.id, "top")}
                  type="button"
                  role="tab"
                  data-tab={t.id}
                  className={tab === t.id ? "on" : ""}
                  onClick={() => setTab(t.id)}
                  aria-selected={tab === t.id}
                  aria-controls={panelId}
                  tabIndex={rovingTab === t.id ? 0 : -1}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="topbar-right">
            <span className="chip">
              <span className="marker" />
              {effectiveMode === "night" ? "Night" : "Day"} · {fmtTime(now)}
            </span>
            <ConnectionChip />
          </div>
        </header>

        {/* key={tab} remounts the boundary per tab, so a crash on one tab
            clears itself the moment you switch away. */}
        <main className="view" key={tab}>
          {/* The tabpanel role lives on this inner wrapper rather than on
              <main>, because putting it on <main> would replace the main
              landmark instead of adding to it — and landmark navigation is
              the other half of getting around this page without a mouse. */}
          <div id={panelId} role="tabpanel" aria-labelledby={activeTabId} tabIndex={-1}>
            <ErrorBoundary tab={tab}>
              <Suspense fallback={<ViewSkeleton />}>
                {canSeeTab(role, tab) && (
                  <>
                    {tab === "overview" && <OverviewView viewport={viewport} sky={sky} />}
                    {tab === "lights" && <LightsView />}
                    {tab === "media" && <MediaView />}
                    {tab === "schedule" && <ScheduleView />}
                    {tab === "climate" && <ClimateView sky={sky} />}
                    {tab === "workshop" && <WorkshopView />}
                    {tab === "system" && <SystemView />}
                  </>
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        <div className="bottom-nav" role="tablist" aria-label="Sections" onKeyDown={onTablistKeyDown}>
          {visibleTabs.map((t) => (
            /* aria-label, not the markup, is what names these: phone.css hides
               .lbl on every button but the active one, and the glyph is
               decorative — leaving six of seven buttons with no name at all. */
            <button
              key={t.id}
              id={tabButtonId(t.id, "bottom")}
              type="button"
              role="tab"
              data-tab={t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
              aria-label={t.label}
              aria-selected={tab === t.id}
              aria-controls={panelId}
              tabIndex={rovingTab === t.id ? 0 : -1}
            >
              <span className="ic" aria-hidden>
                {
                  {
                    overview: "◐",
                    lights: "◉",
                    media: "♪",
                    schedule: "▦",
                    climate: "◇",
                    workshop: "▣",
                    system: "▤",
                  }[t.id]
                }
              </span>
              <span className="lbl">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <TweaksDrawer
        lean={lean}
        modePref={modePref}
        clockOverride={clockOverride}
        clock={clock}
        onLeanChange={setLean}
        onModeChange={setModePref}
        onClockOverrideChange={setClockOverride}
        onClockChange={setClock}
        bootStyle={bootStyle}
        onBootStyleChange={setBootStyle}
      />

      <ServiceErrorToast toasts={toasts} onDismiss={dismissToast} />

      {booting && (
        <BootScreen ready={dashReady} style={bootStyle} onDone={() => setBooting(false)} />
      )}
    </>
  );
}
