import { useEntity, useEntityStatus, combineStatuses, useStatistics } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { CLIMATE_STAT_IDS } from "../../cards/climate/RoomClimateCard.jsx";

/* ----------------------------------------------------------------
   Room climate strip — horizontal variant for the Overview tab
   (same sensors, single-row composition)
   ----------------------------------------------------------------*/
export function RoomClimateStrip({ index = 0 }) {
  const { entity: liveTemp, status: tempStatus } = useEntityStatus("sensor.h5075_4fb6_temperature");
  const { entity: liveHum, status: humStatus } = useEntityStatus("sensor.h5075_4fb6_humidity");
  const { entity: liveAirQ, status: airQStatus } = useEntityStatus("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const { data: statsData } = useStatistics(CLIMATE_STAT_IDS, 24);

  const climateStatus = combineStatuses(tempStatus, humStatus);
  const climateStale = climateStatus === "unavailable";
  const tempStats = statsData?.["sensor.h5075_4fb6_temperature"];
  const humStats = statsData?.["sensor.h5075_4fb6_humidity"];
  const rawTemp = tempStats?.mean || [];
  const rawHum = humStats?.mean || [];
  const lastStatTemp = rawTemp.length > 0 ? rawTemp[rawTemp.length - 1] : null;
  const lastStatHum = rawHum.length > 0 ? rawHum[rawHum.length - 1] : null;

  if (climateStatus === "loading" || climateStatus === "not_found" ||
      (climateStale && lastStatTemp == null)) {
    return (
      <Card index={index} className="roomclim-strip" eyebrow="Climate" title="Room">
        <EntityGuard status={climateStatus} entityId="sensor.h5075_4fb6_temperature" />
      </Card>
    );
  }

  const temp = climateStale ? lastStatTemp : Number(liveTemp?.state ?? 0);
  const humidity = climateStale ? (lastStatHum ?? 0) : Number(liveHum?.state ?? 0);
  const airQ = liveAirQ?.state ?? "—";
  const pm = Number(livePm?.state ?? 0);

  const tempHist = rawTemp.length > 0 ? (climateStale ? [...rawTemp.slice(-24)] : [...rawTemp.slice(-23), temp]) : [temp];

  // Trend over last 3h
  const prev = tempHist[tempHist.length - 4];
  const delta = temp - prev;
  const trend = delta > 0.2 ? "up" : delta < -0.2 ? "down" : "flat";
  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : "→";

  const tempBand = temp < 18 ? "cold" : temp < 19 ? "cool" : temp <= 22 ? "comfortable" : temp <= 25 ? "warm" : "hot";
  const humBand = humidity < 30 ? "dry" : humidity <= 55 ? "ideal" : humidity <= 65 ? "damp" : "humid";
  const allGood = tempBand === "comfortable" && humBand === "ideal";
  const verdict = allGood ? "Comfortable" : tempBand !== "comfortable" ? `Room is ${tempBand}` : `Air is ${humBand}`;

  const trueMinArr = tempStats?.min || [];
  const trueMaxArr = tempStats?.max || [];
  const tempMin = trueMinArr.length > 0 ? Math.min(...trueMinArr, temp) : Math.min(...tempHist);
  const tempMax = trueMaxArr.length > 0 ? Math.max(...trueMaxArr, temp) : Math.max(...tempHist);

  // Mini humidity ring
  const R = 26;
  const C = 2 * Math.PI * R;
  const humOffset = C * (1 - humidity / 100);

  // Sparkline
  const hasHistory = tempHist.length >= 2;
  const SW = 260, SH = 44, PAD = 3;
  const tMin = Math.min(...tempHist);
  const tMax = Math.max(...tempHist);
  const tRange = Math.max(0.5, tMax - tMin);
  const xAt = (i) => PAD + (i / Math.max(1, tempHist.length - 1)) * (SW - PAD * 2);
  const yAt = (v) => PAD + (1 - (v - tMin) / tRange) * (SH - PAD * 2);
  const linePath = tempHist.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${xAt(tempHist.length - 1).toFixed(1)} ${SH - PAD} L ${xAt(0).toFixed(1)} ${SH - PAD} Z`;
  const nowX = xAt(tempHist.length - 1);
  const nowY = yAt(temp);

  const lastUp = liveTemp?.last_updated
    ? new Date(liveTemp.last_updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <Card index={index} className="roomclim-strip"
          eyebrow="Climate · Govee H5075"
          title="Room"
          meta={climateStale ? "Sensor offline · last known" : `${lastUp} · ${tempBand}`}
          badge={climateStale ? "stale" : undefined}>
      <div className="rcstrip-body">
        {/* Temp + trend */}
        <div className="rcstrip-temp">
          <div className="readout temp" style={{ fontSize: 64 }}>
            {temp.toFixed(1)}<span className="u">°c</span>
          </div>
          <div className="rcstrip-trend">
            <span className="ic">{trendIcon}</span>
            {delta === 0 ? "steady" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}° · 3h`}
          </div>
        </div>

        {/* Humidity + air quality — paired secondary stats */}
        <div className="rcstrip-pair">
          <div className="rcstrip-hum">
            <svg viewBox="0 0 64 64" width="58" height="58">
              <circle cx="32" cy="32" r={R} fill="none" stroke="var(--rule)" strokeWidth="4" />
              <circle cx="32" cy="32" r={R} fill="none"
                stroke="var(--accent-2)" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={humOffset}
                style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
              <text x="32" y="36" textAnchor="middle"
                style={{ fill: "var(--ink)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, letterSpacing: "-0.02em" }}>
                {humidity}
              </text>
            </svg>
            <div className="rcstrip-pair-lbl">
              <div className="k">Humidity · %</div>
              <div className="v">{humBand}</div>
            </div>
          </div>
          <div className="rcstrip-aq">
            <div className="rcstrip-aq-num">
              {pm}<span className="u">µg</span>
            </div>
            <div className="rcstrip-pair-lbl">
              <div className="k">PM 2.5 · air</div>
              <div className="v" style={{ color: "var(--good)" }}>{airQ}</div>
            </div>
          </div>
        </div>

        {/* Verdict */}
        <div className="rcstrip-verdict">
          <span className={`dot ${allGood ? "good" : "warn"}`} />
          <div>
            <div className="h">{verdict}</div>
            <div className="d">low {tempMin.toFixed(1)}° · high {tempMax.toFixed(1)}°</div>
          </div>
        </div>

        {/* Sparkline */}
        <div className="rcstrip-spark">
          <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="rcs-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#rcs-grad)" />
            <path d={linePath} fill="none" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={nowX} cy={nowY} r="2.6" fill="var(--accent-2)" />
            <circle cx={nowX} cy={nowY} r="5" fill="var(--accent-2)" opacity="0.25" />
          </svg>
          <div className="rcstrip-spark-foot">
            <span>24h</span><span>now</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
