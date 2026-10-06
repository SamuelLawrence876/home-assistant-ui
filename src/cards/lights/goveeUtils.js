/* Govee H6159 state, as sensor.desk_strip_state carries it: the cloud API's
   `properties` array, one key per entry —
     [{ online }, { powerState: "on" }, { brightness: 82 },
      { color: { r, g, b } } | { colorTemInKelvin: 4000 }]

   This is outside input, and its colour lands in a CSS colour function, so
   only finite numbers get through (LESSONS.md pattern 3) — and only numbers
   the strip could actually be at. A finite 150 is no more a brightness than
   "lots" is; it used to reach the screen as "On · 150%". A field that is
   missing, malformed or out of range is absent from the result — never a
   default, never clamped into a plausible-looking one. */
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const within = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

// Brightness is a percentage; colour channels are bytes. Kelvin is generous
// on purpose: the H6159 itself does 2000–9000K, and a reading just outside
// the slider's range is still a reading — 0 (RGB mode) or a billion is not.
const KELVIN_MIN = 1000;
const KELVIN_MAX = 10000;

export function parseGoveeProps(attrs) {
  const props = attrs?.properties;
  if (!Array.isArray(props)) return {};
  const out = {};
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (p.powerState === "on" || p.powerState === "off") out.power = p.powerState;
    if (within(num(p.brightness), 0, 100)) out.brightness = num(p.brightness);
    if (p.color && typeof p.color === "object") {
      const c = [num(p.color.r), num(p.color.g), num(p.color.b)];
      if (c.every((v) => within(v, 0, 255))) out.color = c;
    }
    // colorTemInKelvin (colorTem on older payloads). 0 means the strip is in
    // RGB mode — no temperature, not 0K.
    const k = num(p.colorTemInKelvin ?? p.colorTem);
    if (within(k, KELVIN_MIN, KELVIN_MAX)) out.kelvin = k;
  }
  return out;
}
