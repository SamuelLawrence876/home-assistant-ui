import { useState, useEffect, useMemo, useRef } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { rgbStr, kelvinToRgb } from "../../cards/lights/colorUtils.js";
import { PresetSwatches } from "./presets.jsx";

/* ----------------------------------------------------------------
   Desk strip — Govee H6159 (cloud API via rest_command)
   State synced from sensor.desk_strip_state (REST polling).
   ----------------------------------------------------------------*/
function parseGoveeProps(attrs) {
  const props = attrs?.properties;
  if (!Array.isArray(props)) return {};
  const out = {};
  for (const p of props) {
    if (p.powerState !== undefined) out.power = p.powerState;
    if (p.brightness !== undefined) out.brightness = p.brightness;
    if (p.color !== undefined) out.color = [p.color.r, p.color.g, p.color.b];
  }
  return out;
}

const GOVEE_GAP = 2000;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const GOVEE_PRESETS = [
  { id: "warm", label: "Warm 2200K", rgb: [255, 170, 110], kelvin: 2200 },
  { id: "amber", label: "Amber 2700K", rgb: [255, 198, 130], kelvin: 2700 },
  { id: "neutral", label: "Neutral 4000K", rgb: [255, 235, 200], kelvin: 4000 },
  { id: "cool", label: "Cool 5500K", rgb: [220, 235, 255], kelvin: 5500 },
  { id: "red", label: "Red", rgb: [255, 0, 0] },
  { id: "orange", label: "Orange", rgb: [255, 100, 0] },
  { id: "green", label: "Forest", rgb: [0, 255, 50] },
  { id: "blue", label: "Blue", rgb: [0, 50, 255] },
  { id: "purple", label: "Purple", rgb: [150, 0, 255] },
  { id: "pink", label: "Pink", rgb: [255, 0, 150] },
];

export function DeskStripCard({ index = 0 }) {
  const live = useEntity("sensor.desk_strip_state");
  const hw = useMemo(() => parseGoveeProps(live?.attributes), [live?.attributes?.properties]);

  const [on, setOn] = useState(false);
  const [bright, setB] = useState(100);
  const [rgb, setRgb] = useState([255, 198, 130]);
  const [kelvin, setKelvin] = useState(2700);
  const userActedAt = useRef(0);
  const lastCmdTime = useRef(0);
  const cmdQueue = useRef(Promise.resolve());
  const cmdEpoch = useRef(0);
  const verifyTimer = useRef(null);

  useEffect(() => {
    if (Date.now() - userActedAt.current < 5000) return;
    if (live) setOn(live.state === "on");
    if (hw.brightness != null) setB(hw.brightness);
    if (hw.color) setRgb(hw.color);
  }, [live?.state, hw.brightness, hw.color?.join(",")]);

  function scheduleVerify() {
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => {
      callService("homeassistant", "update_entity", { entity_id: "sensor.desk_strip_state" }).catch(() => {});
    }, 3000);
  }

  function govee(cmd, data) {
    userActedAt.current = Date.now();
    const epoch = ++cmdEpoch.current;
    const p = cmdQueue.current.then(async () => {
      if (cmdEpoch.current !== epoch) return;
      const wait = GOVEE_GAP - (Date.now() - lastCmdTime.current);
      if (wait > 0) await delay(wait);
      if (cmdEpoch.current !== epoch) return;
      lastCmdTime.current = Date.now();
      await callService("rest_command", `govee_desk_strip_${cmd}`, data);
      scheduleVerify();
    });
    cmdQueue.current = p.catch(() => {});
    return p;
  }

  function toggle() {
    const next = !on;
    setOn(next);
    cmdEpoch.current++;
    const epoch = cmdEpoch.current;
    const p = cmdQueue.current.then(async () => {
      if (cmdEpoch.current !== epoch) return;
      const wait = GOVEE_GAP - (Date.now() - lastCmdTime.current);
      if (wait > 0) await delay(wait);
      lastCmdTime.current = Date.now();
      await callService("rest_command", "govee_desk_strip_turn", { value: next ? "on" : "off" });
      scheduleVerify();
    });
    cmdQueue.current = p.catch(() => {});
    p.catch(() => setOn(!next));
  }

  function commitBrightness(v) {
    setB(v);
    if (!on) return;
    govee("brightness", { value: v }).catch(() => {});
  }

  function pickColor(p) {
    const wasOff = !on;
    if (wasOff) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      const send = () => govee("color_temp", { value: p.kelvin });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    } else {
      setRgb(p.rgb);
      const send = () => govee("color", { r: p.rgb[0], g: p.rgb[1], b: p.rgb[2] });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    }
  }

  function commitKelvin(v) {
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (!on) return;
    govee("color_temp", { value: v }).catch(() => {});
  }

  const glow = on
    ? `0 0 24px ${rgbStr(rgb)}33, 0 0 80px ${rgbStr(rgb)}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow="Light · Govee H6159"
      title="Desk strip"
      meta={on ? `On · ${bright}%` : "Off"}
      headRight={
        <div className={`toggle ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} />
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
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
              {bright}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={bright}
            disabled={!on}
            onChange={(ev) => setB(Number(ev.target.value))}
            onPointerUp={(ev) => commitBrightness(Number(ev.target.value))}
            onKeyUp={(ev) => commitBrightness(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: on ? rgbStr(rgb) : "var(--ink-4)" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
            {kelvin}K
          </span>
        </div>
        <input
          type="range"
          min={2000}
          max={9000}
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

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Color · curated</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <PresetSwatches presets={GOVEE_PRESETS} rgb={rgb} onPick={pickColor} />
        </div>
      </div>
    </Card>
  );
}
