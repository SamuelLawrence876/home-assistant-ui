import { useState, useEffect, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { GH_DATA } from "../../data.js";
import { DIFFUSER, SPRAY_OPTIONS, DEFAULT_RGB, rgbCss, nearestColorName, knownState } from "../../lib/diffuser.js";

const fb = GH_DATA.diffuser;

/* ----------------------------------------------------------------
   Overview quick-control strip — glanceable mist + LED. Compact
   sibling of the SamBox360 "Play" tile; pairs with it in the
   bottom row (col-5 next to the col-7 Play strip).
   Meross Smart Essential Oil Diffuser (meross_lan): mist is a
   select (off/eco/on), LED is an rgb light.

   An offline diffuser (every entity "unavailable") used to read as a green
   "On · Spraying · unavailable", because `mode !== "off"` was the whole test.
   knownState() gates both halves: unknown says so, and its controls are
   disabled rather than sending commands into the void.
   ----------------------------------------------------------------*/
export function DiffuserMini({ index = 0 }) {
  const { entity: liveSpray, status: sprayStatus } = useEntityStatus(DIFFUSER.spray);
  const { entity: liveLed, status: ledStatus } = useEntityStatus(DIFFUSER.light);
  const spray = liveSpray || fb[DIFFUSER.spray];
  const l = liveLed || fb[DIFFUSER.light];
  const sprayKnown = knownState(sprayStatus, spray.state);
  const ledKnown = knownState(ledStatus, l.state);

  const [mode, setMode] = useState(spray.state);
  const [rgb, setRgb] = useState(l.attributes.rgb_color || DEFAULT_RGB);
  const [lightOn, setLightOn] = useState(l.state === "on");

  useEffect(() => { if (liveSpray) setMode(liveSpray.state); }, [liveSpray?.state]);
  useEffect(() => { if (liveLed) setLightOn(liveLed.state === "on"); }, [liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes.rgb_color?.join()]);

  const misting = sprayKnown && mode !== "off" && SPRAY_OPTIONS.includes(mode);
  const ledOn = ledKnown && lightOn;
  const led = ledOn ? rgbCss(rgb) : "var(--ink-4)";
  const statusColor = misting ? "var(--good)" : "var(--ink-4)";
  const sub = !sprayKnown && !ledKnown ? "Unavailable"
    : `${!sprayKnown ? "Mist unavailable" : misting ? `Spraying · ${mode}` : "Standby"}`
      + `${!ledKnown ? " · LED unavailable" : lightOn ? ` · ${nearestColorName(rgb).toLowerCase()}` : " · LED off"}`;

  // Revert from HA's truth at failure time rather than the value captured at
  // click time: the resync effects above only fire on a *changed* state, so a
  // stale revert would stick. Falls back to the pre-click value in mock mode,
  // where there is no live entity to revert to.
  const sprayRef = useRef(liveSpray);
  sprayRef.current = liveSpray;
  const ledRef = useRef(liveLed);
  ledRef.current = liveLed;

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

  return (
    <Card
      index={index}
      eyebrow="Diffuser · bedroom"
      title="Mist"
      className="diffuser-mini-card"
      style={{ "--led": led }}
      headRight={
        <span className="gs-status" style={{ "--gs-color": statusColor }}>
          <span className="d" />{!sprayKnown ? "Unavailable" : misting ? "On" : "Off"}
        </span>
      }
    >
      <div className="dmini-body">
        <div className="dmini-id">
          <div className={`dmini-orb ${ledOn ? "" : "off"}`} />
          <div style={{ minWidth: 0 }}>
            <div className="nm">Oil diffuser</div>
            <div className="sub">{sub}</div>
          </div>
        </div>

        <div className="dmini-mist">
          <div className="diff-seg" role="group" aria-label="Mist mode">
            {SPRAY_OPTIONS.map((m) => (
              <button key={m} className={sprayKnown && mode === m ? "on" : ""} aria-pressed={sprayKnown && mode === m}
                disabled={!sprayKnown} onClick={() => changeMode(m)}>{m}</button>
            ))}
          </div>
        </div>

        <div className="dmini-ledrow">
          <span className="k">LED light</span>
          <span className="dmini-led">
            <span className={`w ${ledOn ? "lit" : ""}`}>{!ledKnown ? "Unavailable" : lightOn ? "On" : "Off"}</span>
            <ToggleSwitch on={ledOn} onToggle={toggleLight} disabled={!ledKnown} label="Diffuser LED" />
          </span>
        </div>
      </div>
    </Card>
  );
}
