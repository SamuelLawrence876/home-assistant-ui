/* Govee H6159 state, as sensor.desk_strip_state carries it: the cloud API's
   `properties` array, one key per entry —
     [{ online }, { powerState: "on" }, { brightness: 82 },
      { color: { r, g, b } } | { colorTemInKelvin: 4000 }]

   This is outside input, and its colour lands in a CSS colour function, so
   only finite numbers get through (LESSONS.md pattern 3). A field that is
   missing or malformed is absent from the result — never a default. */
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

export function parseGoveeProps(attrs) {
  const props = attrs?.properties;
  if (!Array.isArray(props)) return {};
  const out = {};
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (p.powerState === "on" || p.powerState === "off") out.power = p.powerState;
    if (Number.isFinite(num(p.brightness))) out.brightness = num(p.brightness);
    if (p.color && typeof p.color === "object") {
      const c = [num(p.color.r), num(p.color.g), num(p.color.b)];
      if (c.every(Number.isFinite)) out.color = c;
    }
    // colorTemInKelvin (colorTem on older payloads). 0 means the strip is in
    // RGB mode — no temperature, not 0K.
    const k = num(p.colorTemInKelvin ?? p.colorTem);
    if (Number.isFinite(k) && k > 0) out.kelvin = k;
  }
  return out;
}
