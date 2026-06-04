import { useEntityStatus, combineStatuses, useStatistics } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { StatBox } from "../../components/StatBox.jsx";

/* Live-wired StatBox variants for Overview. Each subscribes to its own
   entities so a single tile updating doesn't re-render the others. */

export const CLIMATE_STAT_IDS = ["sensor.h5075_4fb6_temperature", "sensor.h5075_4fb6_humidity"];

/* Catmull-Rom -> cubic Bezier for smooth SVG curves */
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/* ----------------------------------------------------------------
   Room climate — full card for the Climate tab
   (Govee BLE H5075 temperature + humidity, live-wired)
   ----------------------------------------------------------------*/
export function RoomClimateCard({ index = 0, compact }) {
  const { entity: liveTemp, status: tempStatus } = useEntityStatus("sensor.h5075_4fb6_temperature");
  const { entity: liveHum, status: humStatus } = useEntityStatus("sensor.h5075_4fb6_humidity");
  const { data: statsData } = useStatistics(CLIMATE_STAT_IDS, 24);
  const combined = combineStatuses(tempStatus, humStatus);

  const tempStats = statsData?.["sensor.h5075_4fb6_temperature"];
  const humStats = statsData?.["sensor.h5075_4fb6_humidity"];
  const rawTemp = tempStats?.mean || [];
  const rawHum = humStats?.mean || [];
  const isStale = combined === "unavailable";
  const lastStatTemp = rawTemp.length > 0 ? rawTemp[rawTemp.length - 1] : null;
  const lastStatHum = rawHum.length > 0 ? rawHum[rawHum.length - 1] : null;

  if (combined === "loading" || combined === "not_found" ||
      (isStale && lastStatTemp == null)) {
    return (
      <Card index={index} eyebrow="Climate" title="Room">
        <EntityGuard status={combined} entityId="sensor.h5075_4fb6_temperature" />
      </Card>
    );
  }

  const temp = isStale ? lastStatTemp : Number(liveTemp?.state ?? 0);
  const humidity = isStale ? (lastStatHum ?? 0) : Number(liveHum?.state ?? 0);

  const tempHist = rawTemp.length > 0 ? (isStale ? [...rawTemp.slice(-24)] : [...rawTemp.slice(-23), temp]) : [temp];
  const humHist = rawHum.length > 0 ? (isStale ? [...rawHum.slice(-24)] : [...rawHum.slice(-23), humidity]) : [humidity];

  // True min/max from recorder (not from hourly means) for accurate HIGH/LOW labels
  const trueMinArr = tempStats?.min || [];
  const trueMaxArr = tempStats?.max || [];
  const tempMin = trueMinArr.length > 0 ? Math.min(...trueMinArr, temp) : Math.min(...tempHist);
  const tempMax = trueMaxArr.length > 0 ? Math.max(...trueMaxArr, temp) : Math.max(...tempHist);

  // Dew point approximation (Magnus formula)
  const gamma = Math.log(humidity / 100) + (17.67 * temp) / (243.5 + temp);
  const dewPt = (243.5 * gamma) / (17.67 - gamma);

  // Trend over last 3h (index 20 vs 23)
  const prev = tempHist[tempHist.length - 4];
  const delta = temp - prev;
  const trend = delta > 0.2 ? "up" : delta < -0.2 ? "down" : "flat";

  // Comfort verdict
  const tempBand = temp < 18 ? "cold" : temp < 19 ? "cool" : temp <= 22 ? "comfortable" : temp <= 25 ? "warm" : "hot";
  const humBand = humidity < 30 ? "dry" : humidity <= 55 ? "ideal" : humidity <= 65 ? "damp" : "humid";
  const allGood = tempBand === "comfortable" && humBand === "ideal";
  const verdict = allGood ? "Comfortable" : tempBand !== "comfortable" ? `Room is ${tempBand}` : `Air is ${humBand}`;
  const verdictNote =
    allGood ? "Sleep-friendly range. Holding steady."
    : tempBand === "cold"   ? "Below typical sleeping range. Consider the heater."
    : tempBand === "cool"   ? "Slightly cool — fine if you like it crisp."
    : tempBand === "warm"   ? "A touch warm. Crack a window or run the fan."
    : tempBand === "hot"    ? "Too warm for sleep. Run the fan."
    : humBand === "dry"     ? "Dry air — humidifier helps."
    : humBand === "damp"    ? "A little damp. Ventilate."
    : "Humid — open a window or run the purifier.";

  // Humidity ring geometry (60px radius)
  const R = 60;
  const C = 2 * Math.PI * R;
  const humOffset = C * (1 - humidity / 100);

  // ---- Chart geometry (needs ≥2 points) ----
  const hasHistory = tempHist.length >= 2;
  const SW = 640, SH = 150;
  const PAD_L = 8, PAD_R = 44, PAD_T = 26, PAD_B = 22;
  const innerW = SW - PAD_L - PAD_R;
  const innerH = SH - PAD_T - PAD_B;

  const tMin = Math.min(...tempHist);
  const tMax = Math.max(...tempHist);
  const tRange = Math.max(0.5, tMax - tMin);
  const tPadded = tRange * 0.18;
  const tLo = tMin - tPadded;
  const tHi = tMax + tPadded;

  const hMin = Math.min(...humHist);
  const hMax = Math.max(...humHist);
  const hRange = Math.max(2, hMax - hMin);
  const hLo = hMin - hRange * 0.18;
  const hHi = hMax + hRange * 0.18;

  const xAt = (i) => PAD_L + (i / Math.max(1, tempHist.length - 1)) * innerW;
  const yTemp = (v) => PAD_T + (1 - (v - tLo) / (tHi - tLo)) * innerH;
  const yHum  = (v) => PAD_T + (1 - (v - hLo) / (hHi - hLo)) * innerH;

  const tempPts = tempHist.map((v, i) => ({ x: xAt(i), y: yTemp(v) }));
  const humPts  = humHist.map((v, i)  => ({ x: xAt(i), y: yHum(v) }));
  const tempLine = smoothPath(tempPts);
  const humLine  = smoothPath(humPts);
  const baseY = PAD_T + innerH;
  const tempArea = hasHistory ? `${tempLine} L ${tempPts[tempPts.length - 1].x.toFixed(1)} ${baseY} L ${tempPts[0].x.toFixed(1)} ${baseY} Z` : "";

  // Min/max points
  const maxIdx = tempHist.indexOf(tMax);
  const minIdx = tempHist.indexOf(tMin);
  const maxX = xAt(maxIdx), maxY = yTemp(tMax);
  const minX = xAt(minIdx), minY = yTemp(tMin);
  const nowIdx = tempHist.length - 1;
  const nowX = xAt(nowIdx), nowY = yTemp(temp);

  // Y-axis temperature reference grid
  const tGridLo = Math.floor(tLo);
  const tGridHi = Math.ceil(tHi);
  const tGrid = [];
  for (let v = tGridLo; v <= tGridHi; v++) tGrid.push(v);

  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : "→";
  const trendColor = trend === "up" ? "var(--accent)" : trend === "down" ? "var(--accent-2)" : "var(--ink-3)";

  const source = liveTemp?.attributes?.friendly_name || "Govee H5075";
  const lastUp = liveTemp?.last_updated
    ? new Date(liveTemp.last_updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <Card
      index={index}
      eyebrow={`Climate · ${source}`}
      title="Room"
      meta={isStale ? "Sensor offline · last known" : `${lastUp} · ${humBand}`}
      badge={isStale ? "stale" : undefined}
    >
      <div className="roomclim-body">
        {/* LEFT — big temperature readout */}
        <div className="roomclim-temp">
          <div className="readout temp" style={{ fontSize: compact ? 80 : 104 }}>
            {temp.toFixed(1)}<span className="u">°c</span>
          </div>
          <div className="roomclim-trend" style={{ color: trendColor }}>
            <span className="ic">{trendIcon}</span>
            <span>
              {delta === 0 ? "steady" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}°`} <span className="muted">last 3h</span>
            </span>
          </div>

          <div className="roomclim-minmax">
            <div className="chip-stat">
              <span className="k">Low · 24h</span>
              <span className="v">{tempMin.toFixed(1)}°</span>
            </div>
            <div className="chip-stat">
              <span className="k">High · 24h</span>
              <span className="v">{tempMax.toFixed(1)}°</span>
            </div>
            <div className="chip-stat">
              <span className="k">Dew pt</span>
              <span className="v">{dewPt.toFixed(1)}°</span>
            </div>
          </div>
        </div>

        {/* RIGHT — humidity ring */}
        <div className="roomclim-hum">
          <svg viewBox="0 0 140 140" className="hum-ring">
            <circle cx="70" cy="70" r={R} className="bg" />
            <circle cx="70" cy="70" r={R} className="fg"
              strokeDasharray={C} strokeDashoffset={humOffset} />
            <text x="70" y="62" textAnchor="middle" className="hum-label">HUMIDITY</text>
            <text x="70" y="92" textAnchor="middle" className="hum-num">{humidity}<tspan className="hum-pct">%</tspan></text>
          </svg>
          <div className="hum-band">{humBand}</div>
        </div>
      </div>

      {/* Verdict */}
      <div className="roomclim-verdict">
        <span className={`dot ${allGood ? "good" : "warn"}`} />
        <div>
          <div className="h">{verdict}</div>
          <div className="d">{verdictNote}</div>
        </div>
      </div>

      {/* 24h climate chart — temp + humidity */}
      <div className="roomclim-chart">
        <div className="chart-head">
          <span className="k">24-hour trace</span>
          <span className="legend">
            <span className="li"><span className="sw temp" />Temperature</span>
            <span className="li"><span className="sw hum" />Humidity</span>
          </span>
        </div>
        {!hasHistory ? (
          <div className="chart-canvas" style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
            Loading history…
          </div>
        ) : <div className="chart-canvas">
          <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className="chart-svg">
            <defs>
              <linearGradient id="rc-temp-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.42" />
                <stop offset="60%" stopColor="var(--accent-2)" stopOpacity="0.10" />
                <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Y-axis grid lines (per degree) */}
            {tGrid.map((v) => (
              <line
                key={v}
                x1={PAD_L} x2={SW - PAD_R}
                y1={yTemp(v)} y2={yTemp(v)}
                stroke="var(--rule)"
                strokeWidth="1"
                strokeDasharray="2 5"
                opacity={v === tGridLo || v === tGridHi ? 0.7 : 0.35}
              />
            ))}

            {/* Now vertical line */}
            <line
              x1={nowX} x2={nowX}
              y1={PAD_T - 4} y2={baseY + 6}
              stroke="var(--ink)" strokeWidth="1" opacity="0.18"
            />

            {/* Humidity (dashed, secondary) */}
            <path d={humLine}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="4 4"
              opacity="0.65"
            />

            {/* Temp area + line */}
            <path d={tempArea} fill="url(#rc-temp-grad)" />
            <path d={tempLine}
              fill="none"
              stroke="var(--accent-2)"
              strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round"
            />

          </svg>

          {/* Dot markers as HTML so they don't stretch with the SVG */}
          <div className="chart-dot dot-min" style={{ left: `${(minX / SW) * 100}%`, top: `${(minY / SH) * 100}%` }} />
          {maxIdx !== nowIdx && (
            <div className="chart-dot dot-max" style={{ left: `${(maxX / SW) * 100}%`, top: `${(maxY / SH) * 100}%` }} />
          )}
          <div className="chart-dot dot-now-glow" style={{ left: `${(nowX / SW) * 100}%`, top: `${(nowY / SH) * 100}%` }} />
          <div className="chart-dot dot-now" style={{ left: `${(nowX / SW) * 100}%`, top: `${(nowY / SH) * 100}%` }} />

          {/* Floating annotations — skip HIGH if it overlaps NOW */}
          {maxIdx !== nowIdx && (
            <div className="chart-tag tag-high"
                 style={{ left: `${(maxX / SW) * 100}%`, top: `${(maxY / SH) * 100}%` }}>
              <span className="lbl">HIGH</span>
              <span className="val">{tMax.toFixed(1)}°</span>
            </div>
          )}
          <div className="chart-tag tag-low"
               style={{ left: `${(minX / SW) * 100}%`, top: `${(minY / SH) * 100}%` }}>
            <span className="lbl">LOW</span>
            <span className="val">{tMin.toFixed(1)}°</span>
          </div>
          <div className="chart-tag tag-now"
               style={{ left: `${(nowX / SW) * 100}%`, top: `${(nowY / SH) * 100}%` }}>
            <span className="val">{temp.toFixed(1)}°</span>
            <span className="lbl">{maxIdx === nowIdx ? "NOW · HIGH" : "NOW"}</span>
          </div>
        </div>}
        <div className="chart-axis">
          <span>24h ago</span>
          <span>18h</span>
          <span>12h</span>
          <span>6h</span>
          <span>now</span>
        </div>
      </div>
    </Card>
  );
}
