import { useState, useEffect, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { numOr } from "../../lib/format.js";
import { useRangeCommit } from "../../hooks/useRangeCommit.js";
import { DIFFUSER, DEFAULT_RGB, DIFFUSER_COLORS, rgbCss, nearestColorName, knownState, unknownWord, sprayOptions, sprayPhase } from "../../lib/diffuser.js";

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

const brightPct = (ent, fallback) => {
  const b = numOr(ent?.attributes?.brightness, null);
  return b == null ? fallback : Math.round(b / 2.55);
};

// `rgb` is null when the LED's colour isn't known — then no swatch is pressed.
function Swatches({ rgb, onPick, disabled }) {
  return (
    <div className="diff-swatches">
      {DIFFUSER_COLORS.map((c) => {
        const on = rgb != null && c.rgb.join() === rgb.join();
        return (
          <button
            key={c.name}
            className={`diff-swatch ${on ? "on" : ""}`}
            title={c.name}
            aria-label={`LED colour ${c.name}`}
            aria-pressed={on}
            disabled={disabled}
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
   "Atmosphere" hero.

   meross_lan marks every entity of an offline device unavailable. That
   string used to flow straight into `mode`, and `mode !== "off"` read it as
   misting — "Misting · unavailable" with animated mist. knownState() is the
   gate: only what HA vouches for right now is shown; anything else is "—"
   (not answered yet, or the connection dropped) or "Unavailable", the
   controls are disabled, and nothing is sent to a device that can't hear it.
   A live mode that isn't one of the select's options is a third case
   (sprayPhase), shown as reported — never as "Mist is off".

   There is no mock fallback. The data.js mock used to stand in until HA
   answered, so a signed-out or never-connected dashboard showed animated
   mist, "Spraying on eco" and 77% / 27.7°C as if measured.
   ----------------------------------------------------------------*/
export function DiffuserCard({ index = 0 }) {
  const { entity: liveSpray, status: sprayStatus } = useEntityStatus(DIFFUSER.spray);
  const { entity: liveLed, status: ledStatus } = useEntityStatus(DIFFUSER.light);
  const { entity: liveHum, status: humStatus } = useEntityStatus(DIFFUSER.humidity);
  const { entity: liveTemp, status: tempStatus } = useEntityStatus(DIFFUSER.temperature);

  const sprayKnown = knownState(sprayStatus);
  const ledKnown = knownState(ledStatus);
  // One connection behind all four entities, so "not answered yet" is shared.
  const pending = sprayStatus === "loading";

  const [mode, setMode] = useState(sprayKnown ? liveSpray.state : null);
  const [bright, setBright] = useState(brightPct(liveLed, 65));
  const [rgb, setRgb] = useState(liveLed?.attributes?.rgb_color || DEFAULT_RGB);
  const [lightOn, setLightOn] = useState(ledKnown && liveLed.state === "on");

  // Resync from HA only. `*Known` is in the lists so a diffuser coming back
  // from a dropout re-reads its state even when nothing changed meanwhile.
  useEffect(() => { if (sprayKnown) setMode(liveSpray.state); }, [sprayKnown, liveSpray?.state]);
  useEffect(() => { if (ledKnown) setLightOn(liveLed.state === "on"); }, [ledKnown, liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes?.brightness != null) setBright(brightPct(liveLed, 65)); }, [liveLed?.attributes?.brightness]);
  useEffect(() => { if (liveLed?.attributes?.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes?.rgb_color?.join()]);

  // Revert from HA's truth at failure time (see DiffuserMini): the resync
  // effects only fire on a *changed* value, so a stale revert would stick.
  const sprayRef = useRef(liveSpray);
  sprayRef.current = liveSpray;
  const ledRef = useRef(liveLed);
  ledRef.current = liveLed;

  const options = sprayOptions(liveSpray);
  const phase = sprayKnown ? sprayPhase(mode, options) : null;
  const misting = phase === "spraying";
  const unrecognised = phase === "unrecognised";
  const ledOn = ledKnown && lightOn;
  const led = ledOn ? rgbCss(rgb) : "var(--ink-4)";
  // A reading HA isn't vouching for right now is an em dash, not the last one.
  const humidity = humStatus === "ready" ? numOr(liveHum.state, null) : null;
  const temperature = tempStatus === "ready" ? numOr(liveTemp.state, null) : null;
  const colorName = nearestColorName(rgb).toLowerCase();

  function changeMode(m) {
    const prev = mode;
    setMode(m);
    callService("select", "select_option", { entity_id: DIFFUSER.spray, option: m })
      .catch(() => setMode(sprayRef.current?.state ?? prev));
  }
  function toggleLight() {
    const next = !lightOn;
    setLightOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: DIFFUSER.light })
      .catch(() => setLightOn(ledRef.current ? ledRef.current.state === "on" : !next));
  }
  // Sent by useRangeCommit — on the native change event (pointer release, a
  // keyboard step, an assistive-tech adjust), debounced — never per step of a
  // drag: each call is a round trip to the device, and the echoed in-between
  // brightness values used to drag the thumb back under the finger. Judged at
  // send time: light.turn_on would switch back on an LED turned off meanwhile.
  function commitBright(v) {
    setBright(v);
    if (!ledOn) return;
    callService("light", "turn_on", { entity_id: DIFFUSER.light, brightness_pct: v })
      .catch(() => setBright((cur) => brightPct(ledRef.current, cur)));
  }
  const brightRef = useRangeCommit(commitBright);
  function pickColor(c) {
    const prev = rgb;
    setRgb(c);
    callService("light", "turn_on", { entity_id: DIFFUSER.light, rgb_color: c })
      .catch(() => setRgb(ledRef.current?.attributes?.rgb_color || prev));
  }

  return (
    <Card
      index={index}
      eyebrow="Diffuser · Meross"
      title="Essential oil diffuser"
      meta={!sprayKnown ? unknownWord(sprayStatus) : misting ? `Misting · ${mode}` : unrecognised ? `Mist: ${mode}` : "Standby"}
      style={{ "--led": led }}
    >
      <div className="diff-a-body">
        {/* Mist stage */}
        <div className="diff-stage">
          <span className={`diff-stage-state ${misting ? "" : "off"}`}>
            <span className="dot" />
            {!sprayKnown ? (pending ? "Mist —" : "Unavailable") : misting ? "Mist on" : unrecognised ? "Mist unknown" : "Mist off"}
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
            {pending ? <>Diffuser has <b>not reported yet</b>.</> : <>
              {!sprayKnown ? <>Diffuser is <b>unavailable</b>.</>
                : misting ? <>Spraying on <b>{mode}</b>.</>
                : unrecognised ? <>Mist reports <b>{mode}</b>.</>
                : <>Mist is off.</>}{" "}
              {!ledKnown ? <>LED is <b>unavailable</b>.</>
                : !lightOn ? <>LED is <b>off</b>.</>
                : misting ? <>LED set to <b>{colorName}</b>.</>
                : <>The LED stays <b>{colorName}</b> as a night light.</>}
            </>}
          </div>

          <div className="diff-field">
            <span className="flabel">Mist</span>
            <div className="diff-seg" role="group" aria-label="Mist mode">
              {options.map((m) => (
                <button key={m} className={sprayKnown && mode === m ? "on" : ""} aria-pressed={sprayKnown && mode === m}
                  disabled={!sprayKnown} onClick={() => changeMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="diff-field">
            <span className="flabel">
              <span>LED light</span>
              <span className="diff-led-state">
                <span className={`w ${ledOn ? "lit" : ""}`}>{!ledKnown ? unknownWord(ledStatus) : lightOn ? "On" : "Off"}</span>
                {/* role="switch" has no "unknown", so the real state goes in the name. */}
                <ToggleSwitch on={ledOn} onToggle={toggleLight} disabled={!ledKnown}
                  label={ledKnown ? "Diffuser LED light" : `Diffuser LED light — ${ledStatus === "loading" ? "not reported yet" : "unavailable"}`} />
              </span>
            </span>
            {/* Dimmed when the LED is off. `disabled` is what actually blocks the
                controls — pointer-events only stops the mouse and leaves the slider
                and swatches in the tab order, fully operable by keyboard. It stays
                on top so the dimmed block doesn't answer hover either. */}
            <div
              className="diff-led-controls"
              style={{ opacity: ledOn ? 1 : 0.4, pointerEvents: ledOn ? "auto" : "none", filter: ledOn ? "none" : "saturate(0.4)" }}
            >
              <div className="diff-bright">
                <input
                  ref={brightRef}
                  type="range" min="1" max="100" value={bright} className="diff-range"
                  aria-label="Diffuser LED brightness"
                  aria-valuetext={ledKnown ? `${bright}%` : "unknown"}
                  disabled={!ledOn}
                  style={{ "--bp": `${bright}%`, "--led": led }}
                  onChange={(e) => setBright(+e.target.value)}
                />
                {/* An unavailable light reports no brightness; don't print the default as if it had. */}
                <span className="val">{ledKnown ? `${bright}%` : "—"}</span>
              </div>
              <Swatches rgb={ledKnown ? rgb : null} onPick={pickColor} disabled={!ledOn} />
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
