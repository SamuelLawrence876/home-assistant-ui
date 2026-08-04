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
  loadStoredTweaks,
  persistTweaks,
  applyTheme,
  LEANS,
  coerceLean,
  coerceMode,
  coerceClock,
  coerceBootStyle,
} from "./theme.js";
import { useConnectionStatus, useEntityCounts } from "./ha/useEntity.js";
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
  return (
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

  // Live clock (rerenders every 30s); honors clockOverride
  const liveNow = useNow();
  const now = clockOverride ? clock : liveNow;
  const skyHour = modePref === "day" ? 13 : modePref === "night" ? 23 : now;
  const sky = useMemo(() => skyColors(skyHour), [skyHour]);
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

  // Tab indicator position
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const active = el.querySelector("button.on");
    const ind = el.querySelector(".indicator");
    if (active && ind) {
      ind.style.left = `${active.offsetLeft}px`;
      ind.style.width = `${active.offsetWidth}px`;
    }
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
              <div className="nm">Glasshouse</div>
              <div className="sub">
                <span className="dot" />
                {cur}
              </div>
            </div>
          </div>

          {viewport !== "phone" && (
            <nav className="tabs" ref={tabsRef} aria-label="Sections">
              <span className="indicator" aria-hidden />
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "on" : ""}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                >
                  {t.label}
                </button>
              ))}
            </nav>
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
        </main>

        <nav className="bottom-nav" aria-label="Sections">
          {visibleTabs.map((t) => (
            /* aria-label, not the markup, is what names these: phone.css hides
               .lbl on every button but the active one, and the glyph is
               decorative — leaving six of seven buttons with no name at all. */
            <button
              key={t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
              aria-label={t.label}
              aria-current={tab === t.id ? "page" : undefined}
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
        </nav>
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
