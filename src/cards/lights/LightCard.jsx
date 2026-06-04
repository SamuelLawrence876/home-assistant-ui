import { useState, useEffect } from "react";
import { GH_DATA } from "../../data.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { rgbStr, kelvinToRgb } from "../../cards/lights/colorUtils.js";
import { PresetSwatches } from "./presets.jsx";

/* ----------------------------------------------------------------
   Light card — toggle + brightness + color
   ----------------------------------------------------------------*/
const LIGHT_PRESETS = [
  { id: "warm", label: "Warm 2200K", rgb: [255, 170, 110], kelvin: 2200 },
  { id: "amber", label: "Amber 2700K", rgb: [255, 198, 130], kelvin: 2700 },
  { id: "neutral", label: "Neutral 4000K", rgb: [255, 235, 200], kelvin: 4000 },
  { id: "cool", label: "Cool 5500K", rgb: [220, 235, 255], kelvin: 5500 },
  { id: "red", label: "Red", rgb: [255, 80, 80] },
  { id: "orange", label: "Orange", rgb: [255, 140, 60] },
  { id: "green", label: "Forest", rgb: [110, 200, 130] },
  { id: "blue", label: "Blue", rgb: [110, 180, 255] },
  { id: "purple", label: "Purple", rgb: [200, 130, 240] },
  { id: "pink", label: "Pink", rgb: [255, 130, 200] },
];

export function LightCard({ index = 0, entityId }) {
  const { entity: live, status } = useEntityStatus(entityId);
  // Mock fallback so a missing or unavailable entity still renders as a
  // normal-looking card (the EntityGuard badge flags the problem); an
  // unavailable entity has its attributes stripped, so prefer the mock there too.
  const e = status === "ready" ? live : GH_DATA.lights[entityId] || live;
  const placeholder = e?.attributes?.placeholder;
  const inert = placeholder || status !== "ready";
  const initialRgb = e?.attributes?.rgb_color || [255, 198, 130];
  const supportsColorTemp = e?.attributes?.supported_color_modes?.includes("color_temp");
  const minKelvin = e?.attributes?.min_color_temp_kelvin || 2000;
  const maxKelvin = e?.attributes?.max_color_temp_kelvin || 6500;
  const [on, setOn] = useState(e?.state === "on");
  const [bright, setB] = useState(e?.attributes?.brightness || 180);
  const [rgb, setRgb] = useState(initialRgb);
  const [kelvin, setKelvin] = useState(e?.attributes?.color_temp_kelvin || 4000);

  useEffect(() => {
    if (!e) return;
    setOn(e.state === "on");
    if (e.attributes?.brightness != null) setB(e.attributes.brightness);
    if (e.attributes?.rgb_color) setRgb(e.attributes.rgb_color);
    if (e.attributes?.color_temp_kelvin != null) setKelvin(e.attributes.color_temp_kelvin);
  }, [e?.state, e?.attributes?.brightness, e?.attributes?.rgb_color?.join(","), e?.attributes?.color_temp_kelvin]);

  function toggle() {
    if (inert) return;
    const next = !on;
    setOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => setOn(on));
  }

  function pickColor(p) {
    if (inert) return;
    if (!on) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: p.kelvin }).catch(() => {});
    } else {
      setRgb(p.rgb);
      callService("light", "turn_on", { entity_id: entityId, rgb_color: p.rgb }).catch(() => {});
    }
  }

  function commitBrightness(v) {
    setB(v);
    if (inert || !on) return;
    callService("light", "turn_on", { entity_id: entityId, brightness: v }).catch(() => {});
  }

  function commitKelvin(v) {
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (inert || !on) return;
    callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: v }).catch(() => {});
  }

  const glow = on
    ? `0 0 24px ${rgbStr([rgb[0], rgb[1], rgb[2]])}33, 0 0 80px ${rgbStr([rgb[0], rgb[1], rgb[2]])}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow={`Light · ${entityId}`}
      title={e?.attributes?.friendly_name || entityId.split(".")[1]}
      meta={placeholder ? "Not yet added" : on ? `On · ${Math.round((bright / 255) * 100)}%` : "Off"}
      headRight={
        placeholder ? (
          <span
            className="pill"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px dashed var(--rule)",
            }}
          >
            future
          </span>
        ) : (
          <div className={`toggle ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} />
        )
      }
    >
      <EntityGuard status={status} entityId={entityId}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
          opacity: placeholder ? 0.5 : 1,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: on
              ? `radial-gradient(circle at 32% 32%, white 0%, ${rgbStr(rgb)} 55%, ${rgbStr([
                  Math.max(0, rgb[0] - 60),
                  Math.max(0, rgb[1] - 60),
                  Math.max(0, rgb[2] - 60),
                ])} 100%)`
              : "color-mix(in oklch, var(--ink), transparent 88%)",
            boxShadow: glow,
            transition: "background 0.3s ease, box-shadow 0.4s ease",
            border: "1px solid var(--glass-stroke)",
          }}
        />
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Brightness</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {Math.round((bright / 255) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={bright}
            disabled={placeholder || !on}
            onChange={(ev) => setB(Number(ev.target.value))}
            onPointerUp={(ev) => commitBrightness(Number(ev.target.value))}
            onKeyUp={(ev) => commitBrightness(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: on ? rgbStr(rgb) : "var(--ink-4)" }}
          />
        </div>
      </div>

      {!placeholder && supportsColorTemp && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {kelvin}K
            </span>
          </div>
          <input
            type="range"
            min={minKelvin}
            max={maxKelvin}
            step="100"
            value={kelvin}
            disabled={!on}
            onChange={(ev) => { setKelvin(Number(ev.target.value)); setRgb(kelvinToRgb(Number(ev.target.value))); }}
            onPointerUp={(ev) => commitKelvin(Number(ev.target.value))}
            onKeyUp={(ev) => commitKelvin(Number(ev.target.value))}
            className="gh-slider"
            style={{
              width: "100%",
              background: on
                ? `linear-gradient(to right, rgb(255,147,41), rgb(255,198,130), rgb(255,235,200), rgb(220,235,255))`
                : "var(--glass-bg-2)",
              borderRadius: 6,
            }}
          />
        </div>
      )}

      {!placeholder && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Color · curated</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <PresetSwatches presets={LIGHT_PRESETS} rgb={rgb} onPick={pickColor} />
          </div>
        </div>
      )}
      </EntityGuard>
    </Card>
  );
}
