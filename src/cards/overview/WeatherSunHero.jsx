import { nowFractionalHour } from "../../theme.js";
import { fmtTime } from "../../lib/format.js";
import { useEntityStatus, combineStatuses } from "../../ha/useEntity.js";
import { useForecast } from "../../ha/useForecast.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { WeatherIcon } from "../../components/WeatherIcon.jsx";

const WEATHER_ENTITY = "weather.forecast_home";
const DASH = "—";

/* A sensor that has gone quiet renders an em-dash, never a number we made up
   and never NaN. LESSONS.md pattern 4. */
const num = (v, suffix = "") =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? DASH : `${v}${suffix}`;

export function WeatherSunHero({ index = 0, sky, compact }) {
  const { entity: w, status: wStatus } = useEntityStatus(WEATHER_ENTITY);
  const t = w?.attributes?.temperature;
  // Live via the weather.get_forecasts service on a deliberate hourly schedule —
  // the legacy `attributes.forecast` HA used to publish is empty post-2024.
  const { forecast: f, status: fStatus } = useForecast(WEATHER_ENTITY, "daily");
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
  /* sensor.sun_next_* carries an ISO timestamp, or "unavailable"/"unknown" when
     the integration is down. Anything that isn't a real date renders as an
     em-dash — never the raw sensor string, and never "Invalid Date". */
  const fmtSun = (s) => {
    if (!s) return DASH;
    const d = new Date(s);
    return isNaN(d.getTime())
      ? DASH
      : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  const sunrise = fmtSun(liveRising?.state);
  const sunset = fmtSun(liveSetting?.state);

  if (!w) {
    return (
      <Card index={index} className="weather-hero" eyebrow={`Weather · ${WEATHER_ENTITY}`} title="Outside, right now" meta="Loading…">
        <EntityGuard status={status} entityId={WEATHER_ENTITY} />
      </Card>
    );
  }

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow={`Weather · ${WEATHER_ENTITY}`}
      title="Outside, right now"
      meta={`${sky.isDay ? "Sun" : "Night"} · ${fmtTime(nowFractionalHour())}`}
    >
      <EntityGuard status={status} entityId={WEATHER_ENTITY}>
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
                {num(t)}
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
            Feels like <b style={{ color: "var(--ink)" }}>{num(w.attributes.apparent_temperature, "°")}</b>,
            humidity <b style={{ color: "var(--ink)" }}>{num(w.attributes.humidity, "%")}</b>, wind{" "}
            <b style={{ color: "var(--ink)" }}>{num(w.attributes.wind_speed, " km/h")}</b>.
          </div>

          <div className="weather-attrs" style={{ marginTop: 14 }}>
            <div>
              <div className="k">Humidity</div>
              <div className="v">{num(w.attributes.humidity, "%")}</div>
            </div>
            <div>
              <div className="k">Pressure</div>
              <div className="v">
                {num(w.attributes.pressure)}
                <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 3 }}>hPa</span>
              </div>
            </div>
            <div>
              <div className="k">Wind</div>
              <div className="v">
                {num(w.attributes.wind_speed)}
                <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 3 }}>km/h</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sun-arc">
          {/* Decorative. Every fact it draws — sunrise, sunset, how far
              through the daylight we are — is restated as text in
              .sun-info below, so exposing it as well would read the two
              bare times out a second time with no context. */}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
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

      {fStatus === "ready" ? (
        <div className="forecast">
          {f.slice(0, 5).map((d, i) => {
            const dt = d.datetime ? new Date(d.datetime) : null;
            const dayLabel = dt && !isNaN(dt.getTime())
              ? dt.toLocaleDateString("en-GB", { weekday: "short" })
              : DASH;
            return (
              <div key={d.datetime || i} className="day">
                <div className="d">{dayLabel}</div>
                <div style={{ marginTop: 4, marginBottom: 4 }}>
                  <WeatherIcon condition={d.condition} size={42} />
                </div>
                <div className="t">{num(d.temperature, "°")}</div>
                <div className="lo">↓ {num(d.templow, "°")}</div>
              </div>
            );
          })}
        </div>
      ) : (
        /* No invented strip. Either we are still waiting on the first
           weather.get_forecasts response, or the service did not answer —
           and in that case the card says so instead of showing old numbers. */
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
          <EntityGuard status={fStatus === "loading" ? "loading" : "unavailable"} entityId="5-day forecast" />
        </div>
      )}
      </EntityGuard>
    </Card>
  );
}
