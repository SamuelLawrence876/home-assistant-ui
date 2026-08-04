import { rgbStr, kelvinToRgb } from "./colorUtils.js";

const sameRgb = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/* Shared swatch row for light preset palettes (LightCard + DeskStripCard).
   The preset lists themselves stay per-card — Govee strip colors are
   device-tuned saturated values, bulb presets are softer.

   `targetName` is the light the swatches control ("Desk strip"). It only
   feeds the accessible name — the swatches are colored circles with no text,
   so without it every card on the tab offers ten identical "button"s. */
export function PresetSwatches({ presets, rgb, onPick, targetName }) {
  return presets.map((p) => {
    // A preset carrying a kelvin is applied as kelvinToRgb(p.kelvin) — p.rgb is
    // only the swatch's own tint — so match either form: kelvinToRgb is what the
    // card shows optimistically, p.rgb is what the entity reports back. Testing
    // p.rgb alone left all four temperature swatches permanently unpressed.
    const selected =
      sameRgb(rgb, p.rgb) || (p.kelvin ? sameRgb(rgb, kelvinToRgb(p.kelvin)) : false);
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onPick(p)}
        title={p.label}
        aria-label={targetName ? `Set ${targetName} to ${p.label}` : `Set color to ${p.label}`}
        aria-pressed={selected}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: rgbStr(p.rgb),
          border: selected ? "2px solid var(--ink)" : "2px solid var(--glass-stroke-2)",
          cursor: "pointer",
          padding: 0,
          boxShadow: selected ? "0 0 0 2px var(--glass-bg-2)" : "0 1px 3px rgba(0,0,0,0.08)",
          transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s ease",
        }}
      />
    );
  });
}
