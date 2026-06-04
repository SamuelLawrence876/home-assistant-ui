import { useState, useEffect } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { useOptimisticToggle } from "../../hooks/useOptimistic.js";

/* ----------------------------------------------------------------
   Air purifier — Levoit Core 300S
   ----------------------------------------------------------------*/
const SPEED_TO_PCT = { low: 33, medium: 67, high: 100 };
const PCT_TO_SPEED = (pct) => pct <= 33 ? "low" : pct <= 67 ? "medium" : "high";

export function AirPurifierCard({ index = 0 }) {
  const { entity: liveFan, status: fanStatus, on, setOn, toggle: doToggle } =
    useOptimisticToggle("fan.core_300s_series", "fan");
  const liveQ = useEntity("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const liveFilt = useEntity("sensor.core_300s_series_filter_lifetime");
  const unavailable = liveFan?.state === "unavailable" || liveFan?.state === "unknown";
  const q = liveQ?.state ?? "—";
  const pm = Number(livePm?.state ?? 0);
  const filt = Number(liveFilt?.state ?? 0);
  const [mode, setMode] = useState(liveFan?.attributes?.preset_mode ?? "auto");
  useEffect(() => {
    if (!liveFan) return;
    const attrs = liveFan.attributes;
    if (attrs?.preset_mode) setMode(attrs.preset_mode);
    else if (attrs?.percentage) setMode(PCT_TO_SPEED(attrs.percentage));
  }, [liveFan?.state, liveFan?.attributes?.preset_mode, liveFan?.attributes?.percentage]);
  function toggleFan() {
    if (unavailable) return;
    doToggle();
  }
  function pickMode(m) {
    setMode(m);
    if (!on) setOn(true);
    const eid = "fan.core_300s_series";
    if (SPEED_TO_PCT[m] != null) {
      callService("fan", "set_percentage", { entity_id: eid, percentage: SPEED_TO_PCT[m] }).catch(() => {});
    } else {
      callService("fan", "set_preset_mode", { entity_id: eid, preset_mode: m }).catch(() => {});
    }
  }

  const C = 2 * Math.PI * 90;
  const offset = C * (1 - filt / 100);

  return (
    <Card
      index={index}
      eyebrow="Air · core_300s_series"
      title="Air purifier"
      meta={unavailable ? "Unavailable" : `filter · ${filt}%`}
      headRight={
        <div className={`toggle ${on && !unavailable ? "on" : ""}`} onClick={toggleFan} role="switch" aria-checked={on} style={unavailable ? { opacity: 0.4 } : undefined} />
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
              <div className="big">{pm}</div>
              <div className="sub">µg/m³ · excellent</div>
            </div>
          </div>
        </div>
        <div className="purifier-info">
          <div className="h">
            Air is <b>{q}</b>. Filter has <b style={{ color: "var(--ink)" }}>{filt}%</b> life left.
          </div>
          <div className="dek">
            Currently running <b>{mode}</b>. Display is on. Last filter check 12 days ago.
          </div>
          <div className="preset-row">
            {["sleep", "auto", "low", "medium", "high"].map((p) => (
              <button key={p} className={`preset ${mode === p ? "on" : ""}`} onClick={() => pickMode(p)} disabled={unavailable}>
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
