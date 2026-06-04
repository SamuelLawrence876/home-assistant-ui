/* Glasshouse v2 — top-level Dashboard.
   Honors initial URL params:
     ?viewport=desktop|phone  (default desktop, also used for the in-frame phone preview in the canvas)
     ?lean=conservatory|frosted|atrium
     ?mode=auto|day|night
     ?tab=overview|lights|media|schedule|climate|workshop|system
     ?clock=HH:MM (forces theme.js's clock override)
   Tweaks (lean / mode / clock override) are also editable live via the
   in-app Tweaks drawer (cog button, top right). Settings persist to
   localStorage.

   Views are lazy-loaded per tab (Overview eager — it's the landing tab),
   so each tab's cards ship as their own chunk. */

import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { LEANS, skyColors, TWEAK_DEFAULTS, loadStoredTweaks, persistTweaks, applyTheme } from "./theme.js";
import { useConnectionStatus, useEntityCounts } from "./ha/useEntity.js";
import { readURLParam } from "./lib/url.js";
import { fmtTime } from "./lib/format.js";
import { useNow } from "./hooks/useNow.js";
import { useViewport } from "./hooks/useViewport.js";
import { useDashReady } from "./hooks/useDashReady.js";
import { ServiceErrorToast } from "./components/Toast.jsx";
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

  const initial = useMemo(() => {
    const url = {
      lean: readURLParam("lean", null),
      mode: readURLParam("mode", null),
      tab: readURLParam("tab", "overview"),
    };
    const stored = loadStoredTweaks();
    return {
      lean: url.lean || stored.lean || TWEAK_DEFAULTS.lean,
      mode: url.mode || stored.mode || TWEAK_DEFAULTS.mode,
      clockOverride: stored.clockOverride ?? TWEAK_DEFAULTS.clockOverride,
      clock: stored.clock ?? TWEAK_DEFAULTS.clock,
      bootStyle: stored.bootStyle || TWEAK_DEFAULTS.bootStyle,
      tab: url.tab,
    };
  }, []);

  const [lean, setLean] = useState(initial.lean);
  const [modePref, setModePref] = useState(initial.mode); // 'auto' | 'day' | 'night'
  const [clockOverride, setClockOverride] = useState(initial.clockOverride);
  const [clock, setClock] = useState(initial.clock);
  const [bootStyle, setBootStyle] = useState(initial.bootStyle);
  const [tab, setTab] = useState(initial.tab);

  // Clean ?tab= from URL after reading it so refreshes default to overview
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("tab")) {
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // Persist tweaks
  useEffect(() => {
    persistTweaks({ lean, mode: modePref, clockOverride, clock, bootStyle });
  }, [lean, modePref, clockOverride, clock, bootStyle]);

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
  }, [tab, viewport]);

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
            <nav className="tabs" ref={tabsRef}>
              <span className="indicator" />
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
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

        <main className="view" key={tab}>
          <Suspense fallback={null}>
            {tab === "overview" && <OverviewView viewport={viewport} sky={sky} />}
            {tab === "lights" && <LightsView />}
            {tab === "media" && <MediaView />}
            {tab === "schedule" && <ScheduleView />}
            {tab === "climate" && <ClimateView sky={sky} />}
            {tab === "workshop" && <WorkshopView />}
            {tab === "system" && <SystemView />}
          </Suspense>
        </main>

        <nav className="bottom-nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              <span className="ic">
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

      <ServiceErrorToast />

      {booting && (
        <BootScreen ready={dashReady} style={bootStyle} onDone={() => setBooting(false)} />
      )}
    </>
  );
}
