/* Glasshouse v2 — top-level Dashboard.
   Honors initial URL params:
     ?viewport=desktop|phone  (default desktop, also used for the in-frame phone preview in the canvas)
     ?lean=conservatory|frosted|atrium
     ?mode=auto|day|night
     ?tab=overview|lights|media|schedule|climate|workshop|system
     ?clock=HH:MM (forces theme.js's clock override)
   Tweaks (lean / mode / clock override) are also editable live via the
   in-app Tweaks drawer (cog button, top right). Settings persist to
   localStorage. */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { GH_DATA } from "./data.js";
import { LEANS, skyColors, nowFractionalHour } from "./theme.js";
import { useConnectionStatus, useEntityCounts } from "./ha/useEntity.js";
import { onServiceError } from "./ha/client.js";
import {
  Card,
  fmtTime,
  useNow,
  WeatherSunHero,
  PresenceCard,
  ScenesCard,
  MediaCard,
  PrinterCard,
  VacuumCard,
  AirPurifierCard,
  HeaterCard,
  PiCard,
  BackupCard,
  EntityHealthCard,
  InProgressCard,
  StatBox,
  RoomClimateCard,
  RoomClimateStrip,
  BambuStatBox,
  LevoitStatBox,
  VacuumStatBox,
  AdGuardStatBox,
  LightCard,
  FanCard,
  QuickLightsCard,
  AdGuardSimpleCard,
  UptimeCard,
  PixooCard,
  AddonsCard,
  NextEventCard,
  NowPlayingHero,
  SpotifyConnectCard,
  SpotifySearchCard,
  SpotifyPlaylistsCard,
  SpotifyQueueCard,
  SpotifyRecentCard,
  WeeklyCalendarCard,
  KanbanBoardCard,
} from "./cards.jsx";
import { TweaksDrawer } from "./TweaksDrawer.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "lights", label: "Lights" },
  { id: "media", label: "Media" },
  { id: "schedule", label: "Schedule" },
  { id: "climate", label: "Climate" },
  { id: "workshop", label: "Workshop" },
  { id: "system", label: "System" },
];

const TWEAKS_KEY = "glasshouse-tweaks";
const TWEAK_DEFAULTS = { lean: "frosted", mode: "auto", clockOverride: false, clock: 18.5 };

function readURLParam(name, dflt) {
  const v = new URLSearchParams(window.location.search).get(name);
  return v || dflt;
}

function loadStoredTweaks() {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function persistTweaks(t) {
  try {
    localStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
  } catch {}
}

/* Apply CSS variables for the chosen lean + mode, plus dynamic sky vars. */
function applyTheme(lean, mode, sky) {
  const root = document.documentElement;
  // Day defaults inherit base font-family + display vars (set on day).
  const dayBase = LEANS[lean].day;
  Object.entries(dayBase).forEach(([k, v]) => root.style.setProperty(k, v));
  if (mode === "night") {
    Object.entries(LEANS[lean].night).forEach(([k, v]) => root.style.setProperty(k, v));
  }

  root.style.setProperty("--sky-top", sky.top);
  root.style.setProperty("--sky-bot", sky.bot);

  const phase = sky.phase;
  let sunX = 50,
    sunY = 22,
    sunBloom = 0.85,
    stars = 0;
  if (phase < 0 || phase > 1) {
    sunX = 50;
    sunY = -30;
    sunBloom = 0.0;
    stars = 0.7;
  } else {
    sunX = 8 + phase * 84;
    sunY = 70 - Math.sin(phase * Math.PI) * 55;
    sunBloom = 0.55 + Math.sin(phase * Math.PI) * 0.45;
    stars = 0;
  }
  root.style.setProperty("--sun-x", `${sunX}%`);
  root.style.setProperty("--sun-y", `${sunY}%`);
  root.style.setProperty("--sun-bloom", `${sunBloom}`);
  root.style.setProperty("--stars", `${stars}`);
  const tint = sky.warmth > 0.7 ? "#ffba6b" : sky.warmth > 0.4 ? "#ffd28a" : "#fff0c8";
  root.style.setProperty("--sun-tint", tint);

  const mullionOpacity = lean === "frosted" ? 0 : lean === "atrium" ? 1 : 0.6;
  root.style.setProperty("--mullion-opacity", `${mullionOpacity}`);

  document.body.classList.remove("lean-conservatory", "lean-frosted", "lean-atrium");
  document.body.classList.add(`lean-${lean}`);
  document.body.classList.toggle("mode-night", mode === "night");
  document.body.classList.toggle("mode-day", mode !== "night");
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

/* ----------------------------------------------------------------
   Views (tab content)
   ----------------------------------------------------------------*/
function OverviewView({ viewport, sky }) {
  return (
    <div className="grid">
      <div className="col-8">
        <WeatherSunHero index={0} sky={sky} compact={viewport === "phone"} />
      </div>
      <div className="col-4" style={{ display: "grid", gap: 14 }}>
        <PresenceCard index={1} />
        <MediaCard index={2} />
        <NextEventCard index={3} />
      </div>

      <div className="col-12">
        <RoomClimateStrip index={4} />
      </div>

      <div className="col-4">
        <QuickLightsCard index={5} />
      </div>
      <div className="col-5">
        <ScenesCard index={6} />
      </div>
      <div className="col-3">
        <InProgressCard index={7} />
      </div>

      <div className="col-3"><BambuStatBox index={8} /></div>
      <div className="col-3"><LevoitStatBox index={9} /></div>
      <div className="col-3"><VacuumStatBox index={10} /></div>
      <div className="col-3"><AdGuardStatBox index={11} /></div>
    </div>
  );
}

function LightsView() {
  return (
    <div className="grid">
      <div className="col-6"><LightCard index={0} entityId="light.living_room" /></div>
      <div className="col-6"><LightCard index={1} entityId="light.smartbulb_5c_h" /></div>
      <div className="col-6"><LightCard index={2} entityId="light.desk_strip" /></div>
      <div className="col-6"><PixooCard index={3} /></div>

      <div className="col-12">
        <Card index={4} eyebrow="Future · 4 flood lights" title="Flood lights · coming soon" meta="placeholder">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {["light.flood_1", "light.flood_2", "light.flood_3", "light.flood_4"].map((id) => {
              const l = GH_DATA.lights[id];
              return (
                <div
                  key={id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "color-mix(in oklch, var(--glass-bg-2), transparent 40%)",
                    border: "1px dashed var(--rule)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                    }}
                  >
                    {id}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>{l.attributes.friendly_name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>
                    not yet added
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MediaView() {
  return (
    <div className="grid" style={{ alignItems: "start" }}>
      <div className="col-8"><NowPlayingHero index={0} /></div>
      <div className="col-4"><SpotifyConnectCard index={1} /></div>
      <div className="col-4"><SpotifySearchCard index={2} /></div>
      <div className="col-4"><SpotifyPlaylistsCard index={3} /></div>
      <div className="col-4"><SpotifyQueueCard index={4} /></div>
    </div>
  );
}

function ScheduleView() {
  return (
    <div className="grid">
      <div className="col-12"><WeeklyCalendarCard index={0} /></div>
      <div className="col-12"><KanbanBoardCard index={1} /></div>
    </div>
  );
}

function ClimateView({ sky }) {
  return (
    <div className="grid">
      <div className="col-12"><RoomClimateCard index={0} /></div>
      <div className="col-7"><AirPurifierCard index={1} /></div>
      <div className="col-5"><HeaterCard index={2} /></div>
      <div className="col-12"><FanCard index={3} /></div>
      <div className="col-12"><WeatherSunHero index={4} sky={sky} /></div>
    </div>
  );
}

function WorkshopView() {
  return (
    <div className="grid">
      <div className="col-7"><PrinterCard index={0} /></div>
      <div className="col-5"><VacuumCard index={1} /></div>
    </div>
  );
}

function SystemView() {
  return (
    <div className="grid">
      <div className="col-7"><PiCard index={0} /></div>
      <div className="col-5"><UptimeCard index={1} /></div>

      <div className="col-7"><AddonsCard index={2} /></div>
      <div className="col-5"><AdGuardSimpleCard index={3} /></div>

      <div className="col-12"><BackupCard index={4} /></div>
      <div className="col-12"><EntityHealthCard index={5} /></div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Service error toast
   ----------------------------------------------------------------*/
let toastIdCounter = 0;
const TOAST_DURATION = 6000;

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 420);
  }, [toast.id, onDismiss]);
  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <div className={`toast-item ${exiting ? "toast-exit" : ""}`}>
      <div className="toast-glow" />
      <div className="toast-edge" />
      <div className="toast-icon-col">
        <div className="toast-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      </div>
      <div className="toast-body">
        <div className="toast-label">{toast.label}</div>
        <div className="toast-detail">{toast.detail}</div>
      </div>
      <button className="toast-close" onClick={dismiss} aria-label="Dismiss">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
      <div className="toast-timer">
        <div className="toast-timer-bar" style={{ animationDuration: `${TOAST_DURATION}ms` }} />
      </div>
    </div>
  );
}

function ServiceErrorToast() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  useEffect(() => {
    return onServiceError(({ domain, service, data, error }) => {
      const entityId = data?.entity_id || "";
      const errMsg = error?.message || String(error);
      const shortErr = errMsg.length > 120 ? errMsg.slice(0, 120) + "…" : errMsg;
      const label = entityId
        ? `${domain}.${service} on ${entityId}`
        : `${domain}.${service}`;
      const id = ++toastIdCounter;
      setToasts((t) => [...t.slice(-4), { id, label, detail: shortErr }]);
    });
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
   App
   ----------------------------------------------------------------*/
function useViewport() {
  const urlPin = useMemo(() => {
    const p = readURLParam("viewport", null);
    return p === "phone" || p === "desktop" ? p : null;
  }, []);
  const [v, setV] = useState(() => {
    if (urlPin) return urlPin;
    if (typeof window === "undefined") return "desktop";
    return window.matchMedia("(max-width: 768px)").matches ? "phone" : "desktop";
  });
  useEffect(() => {
    if (urlPin) return;
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => setV(e.matches ? "phone" : "desktop");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [urlPin]);
  return v;
}

export default function App() {
  const viewport = useViewport();
  const tabsRef = useRef(null);

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
      tab: url.tab,
    };
  }, []);

  const [lean, setLean] = useState(initial.lean);
  const [modePref, setModePref] = useState(initial.mode); // 'auto' | 'day' | 'night'
  const [clockOverride, setClockOverride] = useState(initial.clockOverride);
  const [clock, setClock] = useState(initial.clock);
  const [tab, setTab] = useState(initial.tab);

  // Persist tweaks
  useEffect(() => {
    persistTweaks({ lean, mode: modePref, clockOverride, clock });
  }, [lean, modePref, clockOverride, clock]);

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
          {tab === "overview" && <OverviewView viewport={viewport} sky={sky} />}
          {tab === "lights" && <LightsView />}
          {tab === "media" && <MediaView />}
          {tab === "schedule" && <ScheduleView />}
          {tab === "climate" && <ClimateView sky={sky} />}
          {tab === "workshop" && <WorkshopView />}
          {tab === "system" && <SystemView />}
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
      />

      <ServiceErrorToast />
    </>
  );
}
