import { rgbStr } from "./colorUtils.js";

/* Shared swatch row for light preset palettes (LightCard + DeskStripCard).
   The preset lists themselves stay per-card — Govee strip colors are
   device-tuned saturated values, bulb presets are softer. */
export function PresetSwatches({ presets, rgb, onPick }) {
  return presets.map((p) => {
    const selected = rgb[0] === p.rgb[0] && rgb[1] === p.rgb[1] && rgb[2] === p.rgb[2];
    return (
      <button
        key={p.id}
        onClick={() => onPick(p)}
        title={p.label}
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
