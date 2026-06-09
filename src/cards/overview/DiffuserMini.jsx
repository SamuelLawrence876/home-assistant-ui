import { useState, useEffect } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { GH_DATA } from "../../data.js";
import { DIFFUSER, SPRAY_OPTIONS, DEFAULT_RGB, rgbCss, nearestColorName } from "../../lib/diffuser.js";

const fb = GH_DATA.diffuser;

/* ----------------------------------------------------------------
   Overview quick-control strip — glanceable mist + LED. Compact
   sibling of the SamBox360 "Play" tile; pairs with it in the
   bottom row (col-5 next to the col-7 Play strip).
   Meross Smart Essential Oil Diffuser (meross_lan): mist is a
   select (off/eco/on), LED is an rgb light.
   ----------------------------------------------------------------*/
export function DiffuserMini({ index = 0 }) {
  const liveSpray = useEntity(DIFFUSER.spray);
  const liveLed = useEntity(DIFFUSER.light);
  const spray = liveSpray || fb[DIFFUSER.spray];
  const l = liveLed || fb[DIFFUSER.light];

  const [mode, setMode] = useState(spray.state);
  const [rgb, setRgb] = useState(l.attributes.rgb_color || DEFAULT_RGB);
  const [lightOn, setLightOn] = useState(l.state === "on");

  useEffect(() => { if (liveSpray) setMode(liveSpray.state); }, [liveSpray?.state]);
  useEffect(() => { if (liveLed) setLightOn(liveLed.state === "on"); }, [liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes.rgb_color?.join()]);

  const misting = mode !== "off";
  const led = lightOn ? rgbCss(rgb) : "var(--ink-4)";
  const statusColor = misting ? "var(--good)" : "var(--ink-4)";

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

  return (
    <Card
      index={index}
      eyebrow="Diffuser · bedroom"
      title="Mist"
      className="diffuser-mini-card"
      style={{ "--led": led }}
      headRight={
        <span className="gs-status" style={{ "--gs-color": statusColor }}>
          <span className="d" />{misting ? "On" : "Off"}
        </span>
      }
    >
      <div className="dmini-body">
        <div className="dmini-id">
          <div className={`dmini-orb ${lightOn ? "" : "off"}`} />
          <div style={{ minWidth: 0 }}>
            <div className="nm">Oil diffuser</div>
            <div className="sub">
              {misting ? `Spraying · ${mode}` : "Standby"}{lightOn ? ` · ${nearestColorName(rgb).toLowerCase()}` : " · LED off"}
            </div>
          </div>
        </div>

        <div className="dmini-mist">
          <div className="diff-seg">
            {SPRAY_OPTIONS.map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => changeMode(m)}>{m}</button>
            ))}
          </div>
        </div>

        <div className="dmini-ledrow">
          <span className="k">LED light</span>
          <span className="dmini-led">
            <span className={`w ${lightOn ? "lit" : ""}`}>{lightOn ? "On" : "Off"}</span>
            <div className={`toggle ${lightOn ? "on" : ""}`} onClick={toggleLight} role="switch" aria-checked={lightOn} aria-label="Toggle diffuser LED" />
          </span>
        </div>
      </div>
    </Card>
  );
}
