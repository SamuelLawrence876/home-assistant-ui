/* Diffuser entity map + LED palette + colour helpers — shared by the Climate
   DiffuserCard and the Overview DiffuserMini. Pure, no JSX, no entity access.

   Real device: Meross "Smart Essential Oil Diffuser" via meross_lan. Mist is a
   `select` (off/eco/on), not a humidifier domain entity; the LED is an rgb
   light; humidity + temperature come from the device's own sensors. There is
   no water-level sensor on this model. */

export const DIFFUSER = {
  spray: "select.smart_humidifier_2403124281557464110148e1e9eff28f_spray",
  light: "light.smart_humidifier_2403124281557464110148e1e9eff28f",
  humidity: "sensor.smart_essential_oil_diffuser_humidity",
  temperature: "sensor.smart_essential_oil_diffuser_temperature",
};

/* Meross spray modes, in segment order. off → standby, eco → intermittent
   pulses, on → continuous. */
export const SPRAY_OPTIONS = ["off", "eco", "on"];

/* The modes the spray select itself offers — what HA will accept and what its
   state is one of — when it carries a usable list. HA strips `options` from an
   unavailable entity, and there is no entity at all before HA answers, so fall
   back to the modes these cards were built for (layout only — the segments are
   disabled whenever the state isn't known). */
export function sprayOptions(entity) {
  const o = entity?.attributes?.options;
  return Array.isArray(o) && o.length > 0 && o.every((x) => typeof x === "string" && x !== "")
    ? o
    : SPRAY_OPTIONS;
}

/* What a mist mode means, for a state knownState() has already vouched for:
   "off", "spraying" (any other mode the select offers) or "unrecognised".
   Three-way, never two — a mode the card doesn't know is most likely one
   meross_lan added, so folding it into "off" would call a misting diffuser
   off, and folding it into "spraying" would claim what nobody said. */
export function sprayPhase(mode, options = SPRAY_OPTIONS) {
  if (mode === "off") return "off";
  return options.includes(mode) ? "spraying" : "unrecognised";
}

/* Can a card trust this entity's state? Only when Home Assistant vouches for
   it right now — useEntityStatus's "ready". Unavailable, unknown and missing
   all mean "we don't know", which the cards must not render as a mist mode or
   an LED that is off; meross_lan marks every entity of an offline device
   unavailable, so that is the common case, not an edge one.

   "loading" is unknown too. It used to let the data.js mock stand in, which
   printed "On · Spraying · Eco · Ocean" with live buttons for a dashboard
   that had never reached HA (signed out, first connect) — and, because the
   socket keeps its last states through a drop, the last-known mode with live
   buttons through an outage, while every other card went to its guard. */
export function knownState(status) {
  return status === "ready";
}

/* The word for a value knownState() won't vouch for: an em dash while HA
   hasn't answered (connecting, signed out, dropped), "Unavailable" once it
   has said the device is offline or missing. Same split as LightCard. */
export function unknownWord(status) {
  return status === "loading" ? "—" : "Unavailable";
}

/* Fallback LED colour when the light is in an effect mode (rgb_color is null). */
export const DEFAULT_RGB = [96, 170, 255];


export const DIFFUSER_COLORS = [
  { name: "Warm white", rgb: [255, 214, 170] },
  { name: "Amber",      rgb: [255, 176, 92] },
  { name: "Blush",      rgb: [255, 150, 170] },
  { name: "Violet",     rgb: [170, 140, 255] },
  { name: "Ocean",      rgb: [96, 170, 255] },
  { name: "Teal",       rgb: [88, 210, 198] },
  { name: "Forest",     rgb: [120, 200, 140] },
];

export const rgbCss = (a) => `rgb(${a[0]}, ${a[1]}, ${a[2]})`;

/* Nearest named swatch for an arbitrary rgb triplet. */
export function nearestColorName(rgb) {
  let best = DIFFUSER_COLORS[0];
  let bd = Infinity;
  for (const c of DIFFUSER_COLORS) {
    const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best.name;
}
