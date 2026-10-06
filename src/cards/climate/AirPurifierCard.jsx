import { useState, useEffect, useRef } from "react";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { useOptimisticToggle } from "../../hooks/useOptimistic.js";
import { numOr, pmBand } from "../../lib/format.js";

/* ----------------------------------------------------------------
   Air purifier — Levoit Core 300S
   ----------------------------------------------------------------*/
/* The 300S has three speeds, and HA's vesync fan maps a percentage onto them
   with band edges at 33 / 66 / 100 (percentage_to_ordered_list_item; older
   builds ceil a ranged value, same result). So "medium" has to send 66: 67
   lands in the top band and runs the purifier on HIGH, which HA then reports
   back as 100 and the highlighted preset jumps to "high". HA reports the
   three speeds as 33 / 66 / 100, which PCT_TO_SPEED reads back unchanged. */
const SPEED_TO_PCT = { low: 33, medium: 66, high: 100 };
const PCT_TO_SPEED = (pct) => pct <= 33 ? "low" : pct <= 66 ? "medium" : "high";
const usable = (s) => s != null && s !== "unavailable" && s !== "unknown";
// The mode HA says the fan is in: a preset if it has one, else its speed.
const modeOf = (fan) => fan?.attributes?.preset_mode
  || (fan?.attributes?.percentage ? PCT_TO_SPEED(fan.attributes.percentage) : null);

export function AirPurifierCard({ index = 0 }) {
  const { entity: liveFan, status: fanStatus, on, setOn, toggle: doToggle } =
    useOptimisticToggle("fan.core_300s_series", "fan");
  const liveQ = useEntity("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const liveFilt = useEntity("sensor.core_300s_series_filter_lifetime");
  const { entity: liveDisplay, status: displayStatus } = useEntityStatus("switch.core_300s_series_display");
  const unavailable = liveFan?.state === "unavailable" || liveFan?.state === "unknown";
  // The VeSync cloud sensors drop out independently of the fan, so these are
  // null / "—" (→ em dash) rather than 0 or "unavailable" when they go.
  const q = usable(liveQ?.state) ? liveQ.state : "—";
  const pm = numOr(livePm?.state, null);
  const filt = numOr(liveFilt?.state, null);
  const [mode, setMode] = useState(modeOf(liveFan) ?? "auto");
  useEffect(() => {
    const m = modeOf(liveFan);
    if (m) setMode(m);
  }, [liveFan?.state, liveFan?.attributes?.preset_mode, liveFan?.attributes?.percentage]);

  // Revert from HA's truth at failure time, not the values captured at click
  // time: the resync effect only fires on a *changed* attribute, so a stale
  // revert would stick. Same pattern as useOptimisticToggle.
  const fanRef = useRef(liveFan);
  fanRef.current = liveFan;

  function pickMode(m) {
    const prevMode = mode;
    const prevOn = on;
    setMode(m);
    if (!on) setOn(true);
    const eid = "fan.core_300s_series";
    const call = SPEED_TO_PCT[m] != null
      ? callService("fan", "set_percentage", { entity_id: eid, percentage: SPEED_TO_PCT[m] })
      : callService("fan", "set_preset_mode", { entity_id: eid, preset_mode: m });
    call.catch(() => {
      const fan = fanRef.current;
      setMode(modeOf(fan) ?? prevMode);
      setOn(fan ? fan.state === "on" : prevOn);
    });
  }

  const C = 2 * Math.PI * 90;
  // No filter reading → draw an empty ring rather than stroke-dashoffset="NaN".
  const offset = filt != null ? C * (1 - filt / 100) : C;
  // Only say what the display is doing when the switch has actually reported.
  const display = displayStatus === "ready" ? (liveDisplay.state === "on" ? " Display is on." : " Display is off.") : "";

  return (
    <Card
      index={index}
      eyebrow="Air · core_300s_series"
      title="Air purifier"
      meta={unavailable ? "Unavailable" : `filter · ${filt != null ? `${filt}%` : "—"}`}
      headRight={
        <ToggleSwitch on={on && !unavailable} onToggle={doToggle} disabled={unavailable} label="Air purifier" />
      }
    >
      <EntityGuard status={fanStatus} entityId="fan.core_300s_series">
      <div className="purifier-body">
        <div className="purifier-ring">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" className="bg" />
            <circle cx="100" cy="100" r="90" className="fg" strokeDasharray={C} strokeDashoffset={offset} />
          </svg>
          <div className="purifier-num">
            <div>
              <div className="label">PM 2.5</div>
              <div className="big">{pm ?? "—"}</div>
              <div className="sub">µg/m³ · {pmBand(pm) ?? "—"}</div>
            </div>
          </div>
        </div>
        <div className="purifier-info">
          <div className="h">
            Air is <b>{q}</b>. Filter has <b style={{ color: "var(--ink)" }}>{filt != null ? `${filt}%` : "—"}</b> life left.
          </div>
          <div className="dek">
            {unavailable ? <>Purifier is <b>unavailable</b>.</>
              : on ? <>Currently running <b>{mode}</b>.</>
              : <>Purifier is <b>off</b>.</>}{display}
          </div>
          <div className="preset-row" role="group" aria-label="Purifier mode">
            {["sleep", "auto", "low", "medium", "high"].map((p) => (
              <button key={p} className={`preset ${mode === p ? "on" : ""}`} aria-pressed={mode === p} onClick={() => pickMode(p)} disabled={unavailable}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
