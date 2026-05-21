/* Glasshouse — theme engine.
   Drives:
     - sun position (0 = midnight, 1 = next midnight; arc = dawn→dusk)
     - sky color blend per time of day
     - per-lean CSS variable tokens
*/

function parseHM(s) {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
}

export function nowFractionalHour(override) {
  if (typeof override === "number") return override;
  const params = new URLSearchParams(window.location.search);
  const c = params.get("clock");
  if (c) return parseHM(c);
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

// Returns { top, bottom, accent, isDay } in oklch strings
export function skyColors(hour /*, lean */) {
  const dawn = 6.07,
    sunrise = 6.63,
    noon = 13.4,
    sunset = 20.8,
    dusk = 21.37;

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
    if (hour >= keyframes[i].h && hour <= keyframes[i + 1].h) {
      a = keyframes[i];
      b = keyframes[i + 1];
      break;
    }
  }
  const t = (hour - a.h) / (b.h - a.h || 1);
  const mix = (x, y) => x + (y - x) * t;
  const top = a.top.map((v, i) => mix(v, b.top[i]));
  const bot = a.bot.map((v, i) => mix(v, b.bot[i]));
  const warmth = mix(a.warmth, b.warmth);
  const day = t < 0.5 ? a.day : b.day;

  const phase = sunPhase(hour, dawn, dusk);

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

export const LEANS = {
  conservatory: {
    label: "Conservatory",
    tag: "Victorian · brass + sage",
    day: {
      "--ink": "oklch(0.22 0.025 80)",
      "--ink-2": "oklch(0.36 0.025 80)",
      "--ink-3": "oklch(0.55 0.02 80)",
      "--ink-4": "oklch(0.72 0.015 80)",
      "--accent": "oklch(0.50 0.10 150)",
      "--accent-2": "oklch(0.60 0.12 60)",
      "--warn": "oklch(0.62 0.16 35)",
      "--good": "oklch(0.55 0.11 150)",
      "--bad": "oklch(0.55 0.16 25)",
      "--glass-bg": "rgba(252, 248, 238, 0.52)",
      "--glass-bg-2": "rgba(252, 248, 238, 0.68)",
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
      "--accent": "oklch(0.70 0.10 150)",
      "--accent-2": "oklch(0.80 0.10 70)",
      "--warn": "oklch(0.75 0.14 50)",
      "--good": "oklch(0.74 0.10 150)",
      "--bad": "oklch(0.70 0.16 25)",
      "--glass-bg": "rgba(28, 24, 20, 0.42)",
      "--glass-bg-2": "rgba(36, 32, 28, 0.62)",
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
      "--accent": "oklch(0.58 0.12 230)",
      "--accent-2": "oklch(0.60 0.10 280)",
      "--warn": "oklch(0.65 0.16 50)",
      "--good": "oklch(0.62 0.13 160)",
      "--bad": "oklch(0.58 0.18 25)",
      "--glass-bg": "rgba(255, 255, 255, 0.42)",
      "--glass-bg-2": "rgba(255, 255, 255, 0.62)",
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
      "--accent": "oklch(0.78 0.10 230)",
      "--accent-2": "oklch(0.78 0.10 290)",
      "--warn": "oklch(0.78 0.14 60)",
      "--good": "oklch(0.78 0.10 160)",
      "--bad": "oklch(0.70 0.18 25)",
      "--glass-bg": "rgba(20, 28, 40, 0.40)",
      "--glass-bg-2": "rgba(28, 38, 52, 0.60)",
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
      "--accent": "oklch(0.58 0.13 35)",
      "--accent-2": "oklch(0.62 0.10 90)",
      "--warn": "oklch(0.65 0.16 50)",
      "--good": "oklch(0.55 0.10 145)",
      "--bad": "oklch(0.55 0.18 28)",
      "--glass-bg": "rgba(248, 244, 235, 0.50)",
      "--glass-bg-2": "rgba(250, 246, 238, 0.70)",
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
      "--accent": "oklch(0.72 0.14 35)",
      "--accent-2": "oklch(0.78 0.10 90)",
      "--warn": "oklch(0.78 0.14 55)",
      "--good": "oklch(0.72 0.10 145)",
      "--bad": "oklch(0.72 0.16 28)",
      "--glass-bg": "rgba(28, 22, 16, 0.46)",
      "--glass-bg-2": "rgba(40, 32, 24, 0.62)",
      "--glass-stroke": "rgba(240, 220, 180, 0.16)",
      "--glass-stroke-2": "rgba(240, 220, 180, 0.10)",
      "--mullion": "rgba(240, 220, 180, 0.32)",
      "--mullion-2": "rgba(240, 220, 180, 0.10)",
      "--rule": "rgba(240, 220, 180, 0.14)",
      "--shadow": "0 14px 38px rgba(0, 0, 0, 0.40)",
    },
  },
};
