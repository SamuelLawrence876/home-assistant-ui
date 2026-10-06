import { useState, useEffect, useRef } from "react";
import { GH_DATA } from "../../data.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { useRangeCommit } from "../../hooks/useRangeCommit.js";
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

// Paint for a lit orb whose colour HA hasn't reported (a white-only bulb).
// Decoration only — never handed to the swatches as the light's colour.
const UNREPORTED_PAINT = [255, 198, 130];

export function LightCard({ index = 0, entityId }) {
  const { entity: live, status } = useEntityStatus(entityId);
  const known = status === "ready";
  const pending = status === "loading";
  /* The mock is for layout only — the name, whether there is a colour-
     temperature slider and its range — so a light the card can't reach keeps
     its shape (an unavailable entity has its attributes stripped). It is
     never the light's state: an unavailable bathroom bulb used to read the
     mock's "On · 78%", with a lit orb and a pressed swatch, while HA had it
     off. On/off, brightness and colour come from HA or not at all. */
  const layout = (known ? live : GH_DATA.lights[entityId] || live)?.attributes || {};
  const placeholder = layout.placeholder;
  const inert = placeholder || !known;
  // Every control on the card is named after this, so two light cards on the
  // same tab never announce as an identical pair of unlabelled sliders.
  const name = layout.friendly_name || entityId.split(".")[1];
  const supportsColorTemp = layout.supported_color_modes?.includes("color_temp");
  const minKelvin = layout.min_color_temp_kelvin || 2000;
  const maxKelvin = layout.max_color_temp_kelvin || 6500;
  // null = HA hasn't reported it (an off bulb carries no brightness or
  // colour) — an em-dash on screen, never a default.
  const a = known ? live.attributes || {} : {};
  const [on, setOn] = useState(known && live.state === "on");
  const [bright, setB] = useState(a.brightness ?? null);
  const [rgb, setRgb] = useState(a.rgb_color || null);
  const [kelvin, setKelvin] = useState(a.color_temp_kelvin ?? null);

  // Resync from HA only. `known` is in the list so a light coming back from
  // unavailable re-reads its state even when nothing else changed meanwhile.
  useEffect(() => {
    if (!known) return;
    const at = live.attributes || {};
    setOn(live.state === "on");
    if (at.brightness != null) setB(at.brightness);
    if (at.rgb_color) setRgb(at.rgb_color);
    if (at.color_temp_kelvin != null) setKelvin(at.color_temp_kelvin);
  }, [known, live?.state, live?.attributes?.brightness, live?.attributes?.rgb_color?.join(","), live?.attributes?.color_temp_kelvin]);

  /* A failed call puts back what HA says *now*, not what the card showed at
     click time: the light can move under an in-flight call, and the resync
     effect above only fires when a value changes — so a call that failed and
     left HA where it was used to leave the optimistic colour / brightness on
     screen for good (useOptimisticToggle's entityRef exists for the same
     reason). `prev` names the fields to restore and is the fallback for one
     HA doesn't report — an off light carries no brightness or colour. */
  const eRef = useRef(live);
  eRef.current = live;
  function restore(prev) {
    const cur = eRef.current;
    const at = cur?.attributes || {};
    if ("on" in prev) setOn(cur ? cur.state === "on" : prev.on);
    if ("bright" in prev) setB(at.brightness ?? prev.bright);
    if ("rgb" in prev) setRgb(at.rgb_color ?? prev.rgb);
    if ("kelvin" in prev) setKelvin(at.color_temp_kelvin ?? prev.kelvin);
  }

  function toggle() {
    if (inert) return;
    const next = !on;
    setOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => restore({ on }));
  }

  function pickColor(p) {
    if (inert) return;
    const undo = () => restore({ on, rgb, kelvin });
    if (!on) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: p.kelvin }).catch(undo);
    } else {
      setRgb(p.rgb);
      callService("light", "turn_on", { entity_id: entityId, rgb_color: p.rgb }).catch(undo);
    }
  }

  // Sent by useRangeCommit once the slider settles. Its onChange has already
  // moved `bright` / `kelvin` by then, so the fallback is the dragged value —
  // HA's is the real target. The guards are judged at send time, not drag time.
  function commitBrightness(v) {
    setB(v);
    if (inert || !on) return;
    callService("light", "turn_on", { entity_id: entityId, brightness: v }).catch(() => restore({ bright: v }));
  }

  function commitKelvin(v) {
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (inert || !on) return;
    callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: v })
      .catch(() => restore({ kelvin: v, rgb: kelvinToRgb(v) }));
  }
  const brightRef = useRangeCommit(commitBrightness);
  const kelvinRef = useRangeCommit(commitKelvin);

  // What the light is doing, as far as anyone knows. Local state survives a
  // dropout, but nothing on screen may claim it while HA can't vouch for it.
  const lit = known && on;
  const shownBright = known ? bright : null;
  const shownKelvin = known ? kelvin : null;
  const pct = shownBright != null ? Math.round((shownBright / 255) * 100) : null;
  const paint = rgb || (kelvin != null ? kelvinToRgb(kelvin) : UNREPORTED_PAINT);
  const meta = placeholder ? "Not yet added"
    : !known ? (pending ? "—" : "Unavailable")
    : on ? (pct != null ? `On · ${pct}%` : "On") : "Off";

  const glow = lit
    ? `0 0 24px ${rgbStr(paint)}33, 0 0 80px ${rgbStr(paint)}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow={`Light · ${entityId}`}
      title={name}
      meta={meta}
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
          <ToggleSwitch
            on={lit}
            onToggle={toggle}
            disabled={inert}
            // role="switch" has no "unknown", so the real state goes in the name.
            label={known ? name : `${name} — ${pending ? "not reported yet" : "unavailable"}`}
          />
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
            background: lit
              ? `radial-gradient(circle at 32% 32%, white 0%, ${rgbStr(paint)} 55%, ${rgbStr([
                  Math.max(0, paint[0] - 60),
                  Math.max(0, paint[1] - 60),
                  Math.max(0, paint[2] - 60),
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
              {pct != null ? `${pct}%` : "—"}
            </span>
          </div>
          <input
            ref={brightRef}
            type="range"
            min="0"
            max="255"
            step="1"
            value={shownBright ?? 0}
            disabled={inert || !on}
            onChange={(ev) => setB(Number(ev.target.value))}
            aria-label={`${name} brightness`}
            // The value is HA's 0–255; announce the % the readout shows.
            aria-valuetext={pct != null ? `${pct}%` : "unknown"}
            className="gh-slider"
            style={{ width: "100%", accentColor: lit ? rgbStr(paint) : "var(--ink-4)" }}
          />
        </div>
      </div>

      {!placeholder && supportsColorTemp && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {shownKelvin != null ? `${shownKelvin}K` : "—"}
            </span>
          </div>
          <input
            ref={kelvinRef}
            type="range"
            min={minKelvin}
            max={maxKelvin}
            step="100"
            value={shownKelvin ?? minKelvin}
            disabled={inert || !on}
            onChange={(ev) => { setKelvin(Number(ev.target.value)); setRgb(kelvinToRgb(Number(ev.target.value))); }}
            aria-label={`${name} color temperature`}
            aria-valuetext={shownKelvin != null ? `${shownKelvin}K` : "unknown"}
            className="gh-slider"
            style={{
              width: "100%",
              background: lit
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
            <PresetSwatches presets={LIGHT_PRESETS} rgb={known ? rgb : null} onPick={pickColor} targetName={name} disabled={inert} />
          </div>
        </div>
      )}
      </EntityGuard>
    </Card>
  );
}
