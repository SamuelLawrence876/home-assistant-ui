/* Glasshouse — theme engine.
   Drives:
     - sun position (0 = midnight, 1 = next midnight; arc = dawn→dusk)
     - sky color blend per time of day
     - per-lean CSS variable tokens
*/

/* "HH:MM" (or bare "HH") → fractional hour, or null if it isn't a real time.
   Nothing downstream tolerates NaN: an unvalidated hour propagates into
   oklch(NaN NaN NaN) and the sky gradient collapses to none. */
function parseHM(s) {
  if (!s) return null;
  const [h, m = 0] = s.split(":").map(Number);
  const v = h + m / 60;
  return Number.isFinite(v) && v >= 0 && v < 24 ? v : null;
}

export function nowFractionalHour(override) {
  if (typeof override === "number" && Number.isFinite(override)) return override;
  const params = new URLSearchParams(window.location.search);
  const c = parseHM(params.get("clock"));
  if (c !== null) return c;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// Given dawn/dusk in fractional hours, return a phase in [-1, 2] roughly
//   < 0     : night before dawn
//   0 .. 1  : day (sun is above the horizon arc)
//   > 1     : night after dusk
export function sunPhase(hourNow, dawn, dusk) {
  if (hourNow < dawn) return -(dawn - hourNow) / (24 - (dusk - dawn));
  if (hourNow > dusk) return 1 + (hourNow - dusk) / (24 - (dusk - dawn));
  return (hourNow - dawn) / (dusk - dawn);
}

export function isDay(phase) {
  return phase >= 0 && phase <= 1;
}

/* ----------------------------------------------------------------
   Sun times

   The keyframe palette below was authored against one specific day —
   a British midsummer, sunrise 06:38, sunset 20:48. Those numbers used
   to be the *only* numbers: in December the theme kept the sky bright
   until half eight while Home Assistant, on the same screen, said the
   sun had set at 15:52. SUN_FALLBACK is that authored day, kept as the
   fallback for mock mode and the screenshot harness (no sun.sun there),
   and as the reference frame every real day is mapped onto.
   ----------------------------------------------------------------*/
export const SUN_FALLBACK = Object.freeze({
  dawn: 6.07,
  sunrise: 6.63,
  noon: 13.4,
  sunset: 20.8,
  dusk: 21.37,
});

/* An ISO timestamp -> local fractional hour-of-day, or null.
   Only the time-of-day is taken, never the date, which is what makes
   `next_setting` usable after dark: once the sun is down HA points it at
   tomorrow's sunset, and tomorrow's sunset is within a couple of minutes
   of today's. Anything unparseable returns null and the caller falls back —
   never NaN, which would reach oklch() (LESSONS.md pattern 4). */
function hourOfDayFromISO(iso) {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  const v = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return Number.isFinite(v) && v >= 0 && v < 24 ? v : null;
}

/* Twilight offsets used only when HA doesn't publish next_dawn / next_dusk.
   They are the gaps the palette was authored with (SUN_FALLBACK). */
const DAWN_LEAD = SUN_FALLBACK.sunrise - SUN_FALLBACK.dawn;
const DUSK_LAG = SUN_FALLBACK.dusk - SUN_FALLBACK.sunset;

/* Every sun window has to survive this before it can steer a colour:
   dawn strictly inside the day, dusk after it, and a daylight span long
   enough that sunPhase's divisions stay sane. A window that fails is not
   patched up — it is rejected, and the caller uses SUN_FALLBACK. */
function isUsableWindow(t) {
  return (
    t &&
    Number.isFinite(t.dawn) &&
    Number.isFinite(t.dusk) &&
    Number.isFinite(t.sunrise) &&
    Number.isFinite(t.sunset) &&
    t.dawn > 0.25 &&
    t.dusk < 23.75 &&
    t.dusk - t.dawn >= 1 &&
    t.sunset > t.sunrise
  );
}

/* Home Assistant's sun.sun -> { dawn, sunrise, noon, sunset, dusk } in local
   fractional hours, or null when the entity is missing, unavailable, or
   describing something this model can't draw (polar day, say).

   Pure: the only clock it reads is the one inside the entity's own
   attributes, so it never becomes an incidental `new Date()` during render
   (LESSONS.md pattern 1). */
export function sunTimesFromEntity(sunEntity) {
  const state = sunEntity?.state;
  // "unavailable" / "unknown" / undefined all mean: we do not know.
  if (state !== "above_horizon" && state !== "below_horizon") return null;

  const a = sunEntity.attributes || {};
  const sunrise = hourOfDayFromISO(a.next_rising);
  const sunset = hourOfDayFromISO(a.next_setting);
  if (sunrise === null || sunset === null) return null;

  // next_dawn / next_dusk are published by modern HA; derive them from the
  // authored twilight gaps if this instance doesn't send them.
  const dawn = hourOfDayFromISO(a.next_dawn) ?? sunrise - DAWN_LEAD;
  const dusk = hourOfDayFromISO(a.next_dusk) ?? sunset + DUSK_LAG;
  const noon = hourOfDayFromISO(a.next_noon) ?? (sunrise + sunset) / 2;

  const times = { dawn, sunrise, noon, sunset, dusk };
  return isUsableWindow(times) ? times : null;
}

/* Accepts whatever a caller hands over — a real window, null, a half-built
   object from somewhere else — and always returns something drawable. */
export function resolveSunTimes(times) {
  return isUsableWindow(times) ? times : SUN_FALLBACK;
}

/* Map a real clock hour onto the reference day the palette was painted for,
   piecewise-linearly: night-before-dawn, daylight, night-after-dusk. A
   December afternoon at 15:00 lands near the reference day's late afternoon
   rather than its bright noon, so the sky darkens when the sun actually
   goes down instead of four hours later. */
function toReferenceHour(h, sun) {
  if (h <= sun.dawn) return SUN_FALLBACK.dawn * (h / sun.dawn);
  if (h >= sun.dusk) {
    return (
      SUN_FALLBACK.dusk + (24 - SUN_FALLBACK.dusk) * ((h - sun.dusk) / (24 - sun.dusk))
    );
  }
  return (
    SUN_FALLBACK.dawn +
    (SUN_FALLBACK.dusk - SUN_FALLBACK.dawn) * ((h - sun.dawn) / (sun.dusk - sun.dawn))
  );
}

/* Returns { top, bot, warmth, isDay, phase, sunrise, sunset, dawn, dusk, noon }.
   `sunTimes` is sunTimesFromEntity(sun.sun) or null. */
export function skyColors(hour, sunTimes /*, lean */) {
  // Last line of defence: a non-finite hour makes every keyframe comparison
  // false, leaves t = NaN, and emits oklch(NaN NaN NaN) into --sky-top.
  const clockHour = Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 24) : 12;

  const sun = resolveSunTimes(sunTimes);
  const { dawn, sunrise, noon, sunset, dusk } = sun;
  const h = Math.min(Math.max(toReferenceHour(clockHour, sun), 0), 24);

  const keyframes = [
    { h: 0, top: [0.12, 0.025, 250], bot: [0.08, 0.03, 240], warmth: 0.0, day: false },
    { h: 5.5, top: [0.18, 0.04, 250], bot: [0.22, 0.05, 280], warmth: 0.1, day: false },
    { h: 6.4, top: [0.55, 0.06, 60], bot: [0.78, 0.08, 35], warmth: 1.0, day: true },
    { h: 8.0, top: [0.88, 0.025, 220], bot: [0.93, 0.02, 95], warmth: 0.6, day: true },
    { h: 12.0, top: [0.92, 0.025, 220], bot: [0.97, 0.012, 95], warmth: 0.3, day: true },
    { h: 16.5, top: [0.86, 0.04, 230], bot: [0.92, 0.04, 85], warmth: 0.5, day: true },
    { h: 19.0, top: [0.72, 0.07, 30], bot: [0.82, 0.10, 55], warmth: 1.0, day: true },
    { h: 20.5, top: [0.40, 0.10, 25], bot: [0.62, 0.13, 40], warmth: 0.9, day: true },
    { h: 21.5, top: [0.22, 0.06, 270], bot: [0.28, 0.07, 30], warmth: 0.6, day: false },
    { h: 23.5, top: [0.13, 0.03, 250], bot: [0.10, 0.03, 240], warmth: 0.0, day: false },
    { h: 24, top: [0.12, 0.025, 250], bot: [0.08, 0.03, 240], warmth: 0.0, day: false },
  ];

  let a = keyframes[0],
    b = keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (h >= keyframes[i].h && h <= keyframes[i + 1].h) {
      a = keyframes[i];
      b = keyframes[i + 1];
      break;
    }
  }
  const t = (h - a.h) / (b.h - a.h || 1);
  const mix = (x, y) => x + (y - x) * t;
  const top = a.top.map((v, i) => mix(v, b.top[i]));
  const bot = a.bot.map((v, i) => mix(v, b.bot[i]));
  const warmth = mix(a.warmth, b.warmth);
  const day = t < 0.5 ? a.day : b.day;

  // Phase is measured on the real clock against the real window — `h` above is
  // only a lookup key into the painted palette.
  const phase = sunPhase(clockHour, dawn, dusk);

  return {
    top: `oklch(${top[0].toFixed(3)} ${top[1].toFixed(3)} ${Math.round(top[2])})`,
    bot: `oklch(${bot[0].toFixed(3)} ${bot[1].toFixed(3)} ${Math.round(bot[2])})`,
    warmth,
    isDay: day,
    phase,
    sunrise,
    sunset,
    dawn,
    dusk,
    noon,
  };
}

/* Per-lean token sets. `--on-ink` is the label colour for anything painted on
   an `--ink` fill (the tab indicator, .btn.primary/.accent, segmented controls).
   It has to flip with the mode because `--ink` does: near-black by day, so the
   label is near-white; near-white at night, so the label is near-black. It is
   deliberately NOT derived from the sky — a clock-driven text colour slides
   through dark red at dusk and collapses the contrast to ~1:1. */
export const LEANS = {
  conservatory: {
    label: "Conservatory",
    tag: "Victorian · brass + sage",
    day: {
      "--ink": "oklch(0.22 0.025 80)",
      "--ink-2": "oklch(0.36 0.025 80)",
      "--ink-3": "oklch(0.55 0.02 80)",
      "--ink-4": "oklch(0.72 0.015 80)",
      "--on-ink": "oklch(0.99 0.008 80)",
      "--accent": "oklch(0.50 0.10 150)",
      "--accent-2": "oklch(0.60 0.12 60)",
      "--warn": "oklch(0.62 0.16 35)",
      "--good": "oklch(0.55 0.11 150)",
      "--bad": "oklch(0.55 0.16 25)",
      "--glass-bg": "rgba(252, 248, 238, 0.64)",
      "--glass-bg-2": "rgba(252, 248, 238, 0.76)",
      "--glass-stroke": "rgba(108, 86, 50, 0.18)",
      "--glass-stroke-2": "rgba(255, 252, 246, 0.85)",
      "--mullion": "rgba(80, 56, 28, 0.32)",
      "--mullion-2": "rgba(80, 56, 28, 0.08)",
      "--rule": "rgba(80, 56, 28, 0.12)",
      "--shadow": "0 8px 30px rgba(80, 56, 28, 0.10)",
      "--font-display": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-body": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-mono": "'JetBrains Mono', 'IBM Plex Mono', monospace",
      "--display-italic": "normal",
      "--display-weight": "300",
    },
    night: {
      "--ink": "oklch(0.94 0.015 80)",
      "--ink-2": "oklch(0.82 0.015 80)",
      "--ink-3": "oklch(0.65 0.02 80)",
      "--ink-4": "oklch(0.50 0.02 80)",
      "--on-ink": "oklch(0.20 0.020 80)",
      "--accent": "oklch(0.70 0.10 150)",
      "--accent-2": "oklch(0.80 0.10 70)",
      "--warn": "oklch(0.75 0.14 50)",
      "--good": "oklch(0.74 0.10 150)",
      "--bad": "oklch(0.70 0.16 25)",
      "--glass-bg": "rgba(28, 24, 20, 0.55)",
      "--glass-bg-2": "rgba(36, 32, 28, 0.70)",
      "--glass-stroke": "rgba(220, 200, 160, 0.16)",
      "--glass-stroke-2": "rgba(255, 240, 215, 0.10)",
      "--mullion": "rgba(230, 210, 170, 0.22)",
      "--mullion-2": "rgba(230, 210, 170, 0.06)",
      "--rule": "rgba(230, 210, 170, 0.12)",
      "--shadow": "0 12px 38px rgba(0, 0, 0, 0.35)",
    },
  },
  frosted: {
    label: "Frosted",
    tag: "Minimal · cool spatial glass",
    day: {
      "--ink": "oklch(0.18 0.01 235)",
      "--ink-2": "oklch(0.34 0.01 235)",
      "--ink-3": "oklch(0.55 0.008 235)",
      "--ink-4": "oklch(0.72 0.006 235)",
      "--on-ink": "oklch(0.99 0.003 235)",
      "--accent": "oklch(0.58 0.12 230)",
      "--accent-2": "oklch(0.60 0.10 280)",
      "--warn": "oklch(0.65 0.16 50)",
      "--good": "oklch(0.62 0.13 160)",
      "--bad": "oklch(0.58 0.18 25)",
      "--glass-bg": "rgba(255, 255, 255, 0.56)",
      "--glass-bg-2": "rgba(255, 255, 255, 0.72)",
      "--glass-stroke": "rgba(35, 60, 95, 0.10)",
      "--glass-stroke-2": "rgba(255, 255, 255, 0.85)",
      "--mullion": "rgba(35, 60, 95, 0.0)",
      "--mullion-2": "rgba(35, 60, 95, 0.0)",
      "--rule": "rgba(35, 60, 95, 0.10)",
      "--shadow": "0 10px 36px rgba(35, 60, 95, 0.08)",
      "--font-display": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-body": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-mono": "'JetBrains Mono', 'IBM Plex Mono', monospace",
      "--display-italic": "normal",
      "--display-weight": "300",
    },
    night: {
      "--ink": "oklch(0.96 0.005 235)",
      "--ink-2": "oklch(0.85 0.008 235)",
      "--ink-3": "oklch(0.65 0.01 235)",
      "--ink-4": "oklch(0.50 0.01 235)",
      "--on-ink": "oklch(0.18 0.010 235)",
      "--accent": "oklch(0.78 0.10 230)",
      "--accent-2": "oklch(0.78 0.10 290)",
      "--warn": "oklch(0.78 0.14 60)",
      "--good": "oklch(0.78 0.10 160)",
      "--bad": "oklch(0.70 0.18 25)",
      "--glass-bg": "rgba(20, 28, 40, 0.54)",
      "--glass-bg-2": "rgba(28, 38, 52, 0.70)",
      "--glass-stroke": "rgba(200, 220, 255, 0.10)",
      "--glass-stroke-2": "rgba(200, 220, 255, 0.06)",
      "--mullion": "rgba(200, 220, 255, 0.0)",
      "--mullion-2": "rgba(200, 220, 255, 0.0)",
      "--rule": "rgba(200, 220, 255, 0.10)",
      "--shadow": "0 14px 42px rgba(0, 0, 0, 0.5)",
    },
  },
  atrium: {
    label: "Atrium",
    tag: "Architectural · concrete + iron",
    day: {
      "--ink": "oklch(0.20 0.01 60)",
      "--ink-2": "oklch(0.34 0.012 60)",
      "--ink-3": "oklch(0.52 0.012 60)",
      "--ink-4": "oklch(0.68 0.01 60)",
      "--on-ink": "oklch(0.99 0.005 60)",
      "--accent": "oklch(0.58 0.13 35)",
      "--accent-2": "oklch(0.62 0.10 90)",
      "--warn": "oklch(0.65 0.16 50)",
      "--good": "oklch(0.55 0.10 145)",
      "--bad": "oklch(0.55 0.18 28)",
      "--glass-bg": "rgba(248, 244, 235, 0.63)",
      "--glass-bg-2": "rgba(250, 246, 238, 0.78)",
      "--glass-stroke": "rgba(40, 30, 20, 0.20)",
      "--glass-stroke-2": "rgba(255, 251, 244, 0.80)",
      "--mullion": "rgba(40, 30, 20, 0.55)",
      "--mullion-2": "rgba(40, 30, 20, 0.18)",
      "--rule": "rgba(40, 30, 20, 0.15)",
      "--shadow": "0 12px 32px rgba(40, 30, 20, 0.14)",
      "--font-display": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-body": "'Geist', 'Inter Tight', system-ui, sans-serif",
      "--font-mono": "'JetBrains Mono', 'IBM Plex Mono', monospace",
      "--display-italic": "normal",
      "--display-weight": "400",
    },
    night: {
      "--ink": "oklch(0.94 0.01 80)",
      "--ink-2": "oklch(0.80 0.01 80)",
      "--ink-3": "oklch(0.60 0.012 80)",
      "--ink-4": "oklch(0.45 0.012 80)",
      "--on-ink": "oklch(0.19 0.012 80)",
      "--accent": "oklch(0.72 0.14 35)",
      "--accent-2": "oklch(0.78 0.10 90)",
      "--warn": "oklch(0.78 0.14 55)",
      "--good": "oklch(0.72 0.10 145)",
      "--bad": "oklch(0.72 0.16 28)",
      "--glass-bg": "rgba(28, 22, 16, 0.58)",
      "--glass-bg-2": "rgba(40, 32, 24, 0.70)",
      "--glass-stroke": "rgba(240, 220, 180, 0.16)",
      "--glass-stroke-2": "rgba(240, 220, 180, 0.10)",
      "--mullion": "rgba(240, 220, 180, 0.32)",
      "--mullion-2": "rgba(240, 220, 180, 0.10)",
      "--rule": "rgba(240, 220, 180, 0.14)",
      "--shadow": "0 14px 38px rgba(0, 0, 0, 0.40)",
    },
  },
};

/* ----------------------------------------------------------------
   Tweaks persistence + theme application (moved from App.jsx in the
   structure refactor — REFACTOR_PLAN.md phase 3)
   ----------------------------------------------------------------*/
const TWEAKS_KEY = "glasshouse-tweaks";
export const TWEAK_DEFAULTS = { lean: "frosted", mode: "auto", clockOverride: false, clock: 18.5, bootStyle: "assemble" };

export const MODE_VALUES = ["auto", "day", "night"];
export const BOOT_STYLE_VALUES = ["assemble", "trace", "pixel"];

/* Coercers. Every tweak arrives from somewhere untrusted — a hand-typed URL
   param, a shared link, a half-written localStorage blob — so each one is
   funnelled through here before it reaches state. An unrecognised value is
   the default, never a crash and never something we persist. */
export function coerceLean(v) {
  // hasOwnProperty, not `LEANS[v]` — a plain-object lookup also answers for
  // every Object.prototype key, so ?lean=constructor / toString / valueOf
  // would sail through the guard and hand applyTheme a function to read
  // .day off.
  return Object.prototype.hasOwnProperty.call(LEANS, v) ? v : TWEAK_DEFAULTS.lean;
}
export function coerceMode(v) {
  return MODE_VALUES.includes(v) ? v : TWEAK_DEFAULTS.mode;
}
export function coerceBootStyle(v) {
  return BOOT_STYLE_VALUES.includes(v) ? v : TWEAK_DEFAULTS.bootStyle;
}
export function coerceClock(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 24 ? n : TWEAK_DEFAULTS.clock;
}

export function loadStoredTweaks() {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Anything that isn't a plain object (a stray array, a bare number, a
    // truncated write) is treated as absent rather than read through.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function persistTweaks(t) {
  try {
    localStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
  } catch {}
}

/* Apply CSS variables for the chosen lean + mode, plus dynamic sky vars. */
export function applyTheme(lean, mode, sky) {
  const root = document.documentElement;
  // Never index LEANS blind. This runs inside a useEffect with no boundary
  // above it, so an unknown lean would throw and unmount the whole app.
  const leanName = coerceLean(lean);
  const cfg = LEANS[leanName];
  // Day defaults inherit base font-family + display vars (set on day).
  Object.entries(cfg.day).forEach(([k, v]) => root.style.setProperty(k, v));
  if (mode === "night") {
    Object.entries(cfg.night).forEach(([k, v]) => root.style.setProperty(k, v));
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

  const mullionOpacity = leanName === "frosted" ? 0 : leanName === "atrium" ? 1 : 0.6;
  root.style.setProperty("--mullion-opacity", `${mullionOpacity}`);

  document.body.classList.remove("lean-conservatory", "lean-frosted", "lean-atrium");
  document.body.classList.add(`lean-${leanName}`);
  document.body.classList.toggle("mode-night", mode === "night");
  document.body.classList.toggle("mode-day", mode !== "night");
}
