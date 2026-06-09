import { useState, useEffect } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { GH_DATA } from "../../data.js";
import { DIFFUSER, SPRAY_OPTIONS, DEFAULT_RGB, DIFFUSER_COLORS, rgbCss, nearestColorName } from "../../lib/diffuser.js";

const fb = GH_DATA.diffuser;
const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);

/* Mist particles rising off the device head — static deterministic set so the
   verify harness can freeze the animation. */
const MIST_DOTS = [
  { dl: "0s",   dx: "-14px", dur: "4.4s" },
  { dl: "0.7s", dx: "10px",  dur: "5.0s" },
  { dl: "1.4s", dx: "-6px",  dur: "4.0s" },
  { dl: "2.1s", dx: "16px",  dur: "5.4s" },
  { dl: "2.8s", dx: "-18px", dur: "4.6s" },
  { dl: "3.4s", dx: "4px",   dur: "5.0s" },
];

function Swatches({ rgb, onPick }) {
  return (
    <div className="diff-swatches">
      {DIFFUSER_COLORS.map((c) => {
        const on = c.rgb.join() === rgb.join();
        return (
          <button
            key={c.name}
            className={`diff-swatch ${on ? "on" : ""}`}
            title={c.name}
            style={{ background: rgbCss(c.rgb), "--c": rgbCss(c.rgb) }}
            onClick={() => onPick(c.rgb)}
          />
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------
   Diffuser — Meross Smart Essential Oil Diffuser (meross_lan).
   Mist spray (select: off/eco/on) + rgb LED night-light, plus the
   device's own humidity + temperature readings. Climate-tab
   "Atmosphere" hero. Falls back to GH_DATA.diffuser pre-WS.
   ----------------------------------------------------------------*/
export function DiffuserCard({ index = 0 }) {
  const liveSpray = useEntity(DIFFUSER.spray);
  const liveLed = useEntity(DIFFUSER.light);
  const liveHum = useEntity(DIFFUSER.humidity);
  const liveTemp = useEntity(DIFFUSER.temperature);

  const spray = liveSpray || fb[DIFFUSER.spray];
  const l = liveLed || fb[DIFFUSER.light];
  const hum = liveHum || fb[DIFFUSER.humidity];
  const temp = liveTemp || fb[DIFFUSER.temperature];

  const [mode, setMode] = useState(spray.state);
  const [bright, setBright] = useState(Math.round(numOr(l.attributes.brightness, 165) / 2.55));
  const [rgb, setRgb] = useState(l.attributes.rgb_color || DEFAULT_RGB);
  const [lightOn, setLightOn] = useState(l.state === "on");

  useEffect(() => { if (liveSpray) setMode(liveSpray.state); }, [liveSpray?.state]);
  useEffect(() => { if (liveLed) setLightOn(liveLed.state === "on"); }, [liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes.brightness != null) setBright(Math.round(liveLed.attributes.brightness / 2.55)); }, [liveLed?.attributes.brightness]);
  useEffect(() => { if (liveLed?.attributes.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes.rgb_color?.join()]);

  const misting = mode !== "off";
  const led = lightOn ? rgbCss(rgb) : "var(--ink-4)";
  const humidity = numOr(hum?.state, null);
  const temperature = numOr(temp?.state, null);

  function changeMode(m) {
    const prev = mode;
    setMode(m);
    callService("select", "select_option", { entity_id: DIFFUSER.spray, option: m }).catch(() => setMode(prev));
  }
  function toggleLight() {
    const next = !lightOn;
    setLightOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: DIFFUSER.light }).catch(() => setLightOn(!next));
  }
  function commitBright(v) {
    setBright(v);
    callService("light", "turn_on", { entity_id: DIFFUSER.light, brightness_pct: v }).catch(() => {});
  }
  function pickColor(c) {
    setRgb(c);
    callService("light", "turn_on", { entity_id: DIFFUSER.light, rgb_color: c }).catch(() => {});
  }

  return (
    <Card
      index={index}
      eyebrow="Diffuser · Meross"
      title="Essential oil diffuser"
      meta={misting ? `Misting · ${mode}` : "Standby"}
      style={{ "--led": led }}
    >
      <div className="diff-a-body">
        {/* Mist stage */}
        <div className="diff-stage">
          <span className={`diff-stage-state ${misting ? "" : "off"}`}>
            <span className="dot" />
            {misting ? "Mist on" : "Mist off"}
          </span>
          {misting && (
            <div className="diff-mist" aria-hidden>
              {MIST_DOTS.map((m, i) => (
                <span key={i} style={{ "--dl": m.dl, "--dx": m.dx, "--dur": m.dur }} />
              ))}
            </div>
          )}
          <div className="diff-device" />
        </div>

        {/* Controls */}
        <div className="diff-a-controls">
          <div className="lede">
            {misting
              ? <>Spraying on <b>{mode}</b>. {lightOn ? <>LED set to <b>{nearestColorName(rgb).toLowerCase()}</b>.</> : <>LED is <b>off</b>.</>}</>
              : <>Mist is off. {lightOn ? <>The LED stays <b>{nearestColorName(rgb).toLowerCase()}</b> as a night light.</> : <>LED is <b>off</b>.</>}</>}
          </div>

          <div className="diff-field">
            <span className="flabel">Mist</span>
            <div className="diff-seg">
              {SPRAY_OPTIONS.map((m) => (
                <button key={m} className={mode === m ? "on" : ""} onClick={() => changeMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="diff-field">
            <span className="flabel">
              <span>LED light</span>
              <span className="diff-led-state">
                <span className={`w ${lightOn ? "lit" : ""}`}>{lightOn ? "On" : "Off"}</span>
                <div className={`toggle ${lightOn ? "on" : ""}`} onClick={toggleLight} role="switch" aria-checked={lightOn} aria-label="Toggle diffuser LED" />
              </span>
            </span>
            <div
              className="diff-led-controls"
              style={{ opacity: lightOn ? 1 : 0.4, pointerEvents: lightOn ? "auto" : "none", filter: lightOn ? "none" : "saturate(0.4)" }}
            >
              <div className="diff-bright">
                <input
                  type="range" min="1" max="100" value={bright} className="diff-range"
                  style={{ "--bp": `${bright}%`, "--led": led }}
                  onChange={(e) => commitBright(+e.target.value)}
                />
                <span className="val">{bright}%</span>
              </div>
              <Swatches rgb={rgb} onPick={pickColor} />
            </div>
          </div>

          <div className="diff-stats">
            <div className="diff-stat">
              <span className="k">Humidity</span>
              <span className="v">{humidity != null ? Math.round(humidity) : "—"}<i>%</i></span>
            </div>
            <div className="diff-stat">
              <span className="k">Temperature</span>
              <span className="v">{temperature != null ? temperature.toFixed(1) : "—"}<i>°C</i></span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
