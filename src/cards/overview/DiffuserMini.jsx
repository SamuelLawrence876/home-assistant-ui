import { useState, useEffect } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { GH_DATA } from "../../data.js";
import { rgbCss, nearestColorName } from "../../lib/diffuser.js";

const HUMIDIFIER = "humidifier.bedroom_diffuser";
const LED = "light.bedroom_diffuser";
const MIST_MODES = ["off", "intermittent", "continuous"];

/* ----------------------------------------------------------------
   Overview quick-control strip — glanceable mist + LED. Compact
   sibling of the SamBox360 "Play" tile; pairs with it in the
   bottom row (col-5 next to the col-7 Play strip).
   ----------------------------------------------------------------*/
export function DiffuserMini({ index = 0 }) {
  const fallback = GH_DATA.diffuser;
  const liveHum = useEntity(HUMIDIFIER);
  const liveLed = useEntity(LED);
  const h = liveHum || fallback[HUMIDIFIER];
  const l = liveLed || fallback[LED];

  const [mode, setMode] = useState(h.attributes.mode);
  const [rgb, setRgb] = useState(l.attributes.rgb_color);
  const [lightOn, setLightOn] = useState(l.state === "on");

  useEffect(() => { if (liveHum) setMode(liveHum.attributes.mode); }, [liveHum?.attributes.mode]);
  useEffect(() => { if (liveLed) setLightOn(liveLed.state === "on"); }, [liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes.rgb_color?.join()]);

  const misting = mode !== "off";
  const led = lightOn ? rgbCss(rgb) : "var(--ink-4)";
  const statusColor = misting ? "var(--good)" : "var(--ink-4)";

  function changeMode(m) {
    const prev = mode;
    setMode(m);
    if (m === "off") {
      callService("humidifier", "turn_off", { entity_id: HUMIDIFIER }).catch(() => setMode(prev));
    } else {
      callService("humidifier", "turn_on", { entity_id: HUMIDIFIER })
        .then(() => callService("humidifier", "set_mode", { entity_id: HUMIDIFIER, mode: m }))
        .catch(() => setMode(prev));
    }
  }
  function toggleLight() {
    const next = !lightOn;
    setLightOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: LED }).catch(() => setLightOn(!next));
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
            <div className="nm">Bedroom diffuser</div>
            <div className="sub">
              {misting ? `Misting · ${mode}` : "Standby"}{lightOn ? ` · ${nearestColorName(rgb).toLowerCase()}` : " · LED off"}
            </div>
          </div>
        </div>

        <div className="dmini-mist">
          <div className="diff-seg">
            {MIST_MODES.map((m) => (
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
