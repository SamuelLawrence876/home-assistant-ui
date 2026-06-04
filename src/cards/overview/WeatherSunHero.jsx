import { useState, useEffect } from "react";
import { nowFractionalHour } from "../../theme.js";
import { fmtTime } from "../../lib/format.js";
import { useEntityStatus, combineStatuses } from "../../ha/useEntity.js";
import { getForecast } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { WeatherIcon } from "../../components/WeatherIcon.jsx";

export function WeatherSunHero({ index = 0, sky, compact }) {
  const { entity: w, status: wStatus } = useEntityStatus("weather.forecast_home");
  const t = w?.attributes?.temperature;
  const [forecast, setForecast] = useState([]);
  useEffect(() => {
    if (!w) return;
    getForecast("weather.forecast_home", "daily")
      .then((fc) => { if (fc.length) setForecast(fc); })
      .catch(() => {});
  }, [w?.last_updated]);
  const f = forecast;
  const condLabels = {
    sunny: "Sunny",
    partlycloudy: "Partly cloudy",
    cloudy: "Cloudy",
    rainy: "Rain",
    snowy: "Snow",
    windy: "Windy",
  };
  const condDescription = {
    sunny: "Clear sky, full sun. Bright and dry.",
    partlycloudy: "Mixed sun and cloud. Light cover but mostly bright.",
    cloudy: "Overcast with full cloud cover. No precipitation.",
    rainy: "Wet — light to moderate rain.",
    snowy: "Snowing.",
    windy: "Breezy with notable wind.",
  };

  const W = 360,
    H = compact ? 110 : 130;
  const cx = W / 2;
  const cy = H - 8;
  const r = compact ? 90 : 110;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const phase = sky.phase;
  const phaseDay = Math.max(0, Math.min(1, phase));
  const angle = Math.PI * (1 - phaseDay);
  const sunX = cx + r * Math.cos(angle);
  const sunY = cy - r * Math.sin(angle);
  const sunOnArc = phase >= 0 && phase <= 1;

  const { entity: liveRising, status: rStatus } = useEntityStatus("sensor.sun_next_rising");
  const { entity: liveSetting, status: sStatus } = useEntityStatus("sensor.sun_next_setting");
  const status = combineStatuses(wStatus, rStatus, sStatus);
  const fmtSun = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  const sunrise = fmtSun(liveRising?.state);
  const sunset = fmtSun(liveSetting?.state);

  if (!w) {
    return (
      <Card index={index} className="weather-hero" eyebrow="Weather · weather.forecast_home" title="Outside, right now" meta="Loading…">
        <EntityGuard status={status} entityId="weather.forecast_home" />
      </Card>
    );
  }

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow="Weather · weather.forecast_home"
      title="Outside, right now"
      meta={`${sky.isDay ? "Sun" : "Night"} · ${fmtTime(nowFractionalHour())}`}
    >
      <EntityGuard status={status} entityId="weather.forecast_home">
      <div className="weather-body">
        <div className="weather-now">
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 110,
                height: 110,
                borderRadius: 22,
                background: "color-mix(in oklch, var(--accent-2), transparent 88%)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                border: "1px solid var(--glass-stroke)",
              }}
            >
              <WeatherIcon condition={w.state} size={88} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="readout temp" style={{ fontSize: 96 }}>
                {t}
                <span className="u">°c</span>
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                  marginTop: 6,
                }}
              >
                {condLabels[w.state] || w.state}
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 14,
              color: "var(--ink-2)",
              lineHeight: 1.5,
              marginTop: 8,
              maxWidth: 420,
            }}
          >
            {condDescription[w.state] || ""}{" "}
            Feels like <b style={{ color: "var(--ink)" }}>{w.attributes.apparent_temperature}°</b>,
            humidity <b style={{ color: "var(--ink)" }}>{w.attributes.humidity}%</b>, wind{" "}
            <b style={{ color: "var(--ink)" }}>{w.attributes.wind_speed} km/h</b>.
          </div>

          <div className="weather-attrs" style={{ marginTop: 14 }}>
            <div>
              <div className="k">Humidity</div>
              <div className="v">{w.attributes.humidity}%</div>
            </div>
            <div>
              <div className="k">Pressure</div>
              <div className="v">
                {w.attributes.pressure}
                <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 3 }}>hPa</span>
              </div>
            </div>
            <div>
              <div className="k">Wind</div>
              <div className="v">
                {w.attributes.wind_speed}
                <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 3 }}>km/h</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sun-arc">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            <line x1={0} x2={W} y1={cy} y2={cy} className="horizon" />
            <path d={arcPath} className="arc-bg" />
            <path
              d={arcPath}
              className="arc-fg"
              strokeDasharray={Math.PI * r}
              strokeDashoffset={(1 - phaseDay) * Math.PI * r}
              opacity={sunOnArc ? 1 : 0.25}
            />
            <line x1={cx - r} x2={cx - r} y1={cy - 6} y2={cy + 4} className="tick" />
            <line x1={cx + r} x2={cx + r} y1={cy - 6} y2={cy + 4} className="tick" />
            <text x={cx - r} y={cy + 18} textAnchor="middle" className="label">
              {sunrise}
            </text>
            <text x={cx + r} y={cy + 18} textAnchor="middle" className="label">
              {sunset}
            </text>

            {sunOnArc ? (
              <>
                <circle cx={sunX} cy={sunY} r={10} className="sun-dot" />
                <circle cx={sunX} cy={sunY} r={4} fill="#fff8e0" />
              </>
            ) : (
              <>
                <circle cx={cx} cy={20} r={10} className="moon-dot" />
                <circle cx={cx + 3} cy={18} r={8} fill="var(--sky-top, #111)" />
              </>
            )}
          </svg>
          <div className="sun-info">
            <span>
              Rise <b>{sunrise}</b>
            </span>
            <span>{sunOnArc ? `${Math.round(phaseDay * 100)}% through daylight` : "Below horizon"}</span>
            <span>
              Set <b>{sunset}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="forecast">
        {f.slice(0, 5).map((d, i) => {
          const dt = d.datetime ? new Date(d.datetime) : null;
          const dayLabel = dt && !isNaN(dt)
            ? dt.toLocaleDateString("en-GB", { weekday: "short" })
            : `+${i + 1}d`;
          return (
            <div key={i} className="day">
              <div className="d">{dayLabel}</div>
              <div style={{ marginTop: 4, marginBottom: 4 }}>
                <WeatherIcon condition={d.condition} size={42} />
              </div>
              <div className="t">{d.temperature}°</div>
              <div className="lo">↓ {d.templow}°</div>
            </div>
          );
        })}
      </div>
      </EntityGuard>
    </Card>
  );
}
