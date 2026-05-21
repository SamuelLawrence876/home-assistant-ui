/* Glasshouse v2 — atomic card components.
   Each card consumes GH_DATA (mock entity state) and exposes simple
   interactivity (toggles, sliders) via local state. */

import { useState, useEffect, useMemo, useRef } from "react";
import { GH_DATA } from "./data.js";
import { nowFractionalHour } from "./theme.js";
import { useEntity } from "./ha/useEntity.js";
import { callService, imageUrl } from "./ha/client.js";

/* ----------------------------------------------------------------
   Small helpers
   ----------------------------------------------------------------*/
export const fmtTime = (h) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

export function useNow() {
  const [now, setNow] = useState(() => nowFractionalHour());
  useEffect(() => {
    const id = setInterval(() => setNow(nowFractionalHour()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ----------------------------------------------------------------
   Reusable Card shell
   ----------------------------------------------------------------*/
export function Card({ index = 0, className = "", children, eyebrow, title, meta, headRight, style }) {
  return (
    <section className={`card ${className}`} style={{ ...style, "--i": index }}>
      {(eyebrow || title || meta || headRight) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <div className="title">{title}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {meta && <span className="meta">{meta}</span>}
            {headRight}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------
   Weather icon
   ----------------------------------------------------------------*/
export function WeatherIcon({ condition, size = 88, sunColor = "var(--accent-2)", cloudColor = "var(--ink-2)" }) {
  const vb = 100;
  const stroke = 2;

  const Sun = ({ cx, cy, r = 16, withRays = true, opacity = 1 }) => (
    <g opacity={opacity}>
      {withRays && (
        <g stroke={sunColor} strokeWidth={stroke} strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={cx + Math.cos(rad) * (r + 5)}
                y1={cy + Math.sin(rad) * (r + 5)}
                x2={cx + Math.cos(rad) * (r + 11)}
                y2={cy + Math.sin(rad) * (r + 11)}
              />
            );
          })}
        </g>
      )}
      <circle cx={cx} cy={cy} r={r} fill={sunColor} />
    </g>
  );

  const Cloud = ({ cx, cy, scale = 1, fill = cloudColor, opacity = 1 }) => (
    <g
      opacity={opacity}
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}
      fill={fill}
    >
      <ellipse cx={cx - 14} cy={cy + 4} rx={11} ry={10} />
      <ellipse cx={cx} cy={cy - 4} rx={14} ry={13} />
      <ellipse cx={cx + 15} cy={cy + 2} rx={10} ry={10} />
      <rect x={cx - 22} y={cy + 2} width={42} height={12} rx={6} />
    </g>
  );

  const Drops = ({ cx, cy, count = 3 }) => (
    <g fill={sunColor} stroke="none">
      {[...Array(count)].map((_, i) => (
        <ellipse key={i} cx={cx - 12 + i * 12} cy={cy + i * 2} rx={2} ry={4.5} opacity={0.85} />
      ))}
    </g>
  );

  const Snow = ({ cx, cy }) => (
    <g stroke={sunColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
      {[-12, 0, 12].map((dx, i) => (
        <g key={i} transform={`translate(${cx + dx} ${cy + 4 + (i % 2) * 2})`}>
          <line x1={-4} y1={0} x2={4} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={-3} y1={-3} x2={3} y2={3} />
          <line x1={3} y1={-3} x2={-3} y2={3} />
        </g>
      ))}
    </g>
  );

  const Wind = () => (
    <g stroke={cloudColor} strokeWidth={3} strokeLinecap="round" fill="none">
      <path d="M 18 40 Q 50 36, 60 40 Q 72 44, 80 40" />
      <path d="M 24 56 Q 56 52, 66 56 Q 78 60, 86 56" />
      <path d="M 20 72 Q 48 68, 58 72" />
    </g>
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-label={condition}>
      {condition === "sunny" && <Sun cx={50} cy={50} r={22} />}
      {condition === "partlycloudy" && (
        <>
          <Sun cx={36} cy={36} r={16} />
          <Cloud cx={62} cy={62} scale={1.15} opacity={0.95} />
        </>
      )}
      {condition === "cloudy" && (
        <>
          <Cloud cx={36} cy={40} scale={1.05} opacity={0.6} />
          <Cloud cx={56} cy={58} scale={1.2} />
        </>
      )}
      {condition === "rainy" && (
        <>
          <Cloud cx={50} cy={36} scale={1.2} />
          <Drops cx={50} cy={68} count={3} />
        </>
      )}
      {condition === "snowy" && (
        <>
          <Cloud cx={50} cy={36} scale={1.2} />
          <Snow cx={50} cy={68} />
        </>
      )}
      {condition === "windy" && <Wind />}
      {!["sunny", "partlycloudy", "cloudy", "rainy", "snowy", "windy"].includes(condition) && (
        <Sun cx={50} cy={50} r={20} />
      )}
    </svg>
  );
}

export function WeatherSunHero({ index = 0, sky, compact }) {
  const live = useEntity("weather.forecast_home");
  const w = live || GH_DATA.weather["weather.forecast_home"];
  const t = w.attributes.temperature;
  // HA dropped the legacy `forecast` attribute in 2024 — until we wire the
  // weather.get_forecasts service call, fall back to the mock forecast list.
  const f = w.attributes.forecast || GH_DATA.weather["weather.forecast_home"].attributes.forecast;
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

  const sunrise = GH_DATA.sun["sensor.sun_next_rising"].state;
  const sunset = GH_DATA.sun["sensor.sun_next_setting"].state;

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow="Weather · weather.forecast_home"
      title="Outside, right now"
      meta={`${sky.isDay ? "Sun" : "Night"} · ${fmtTime(nowFractionalHour())}`}
    >
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
        {f.slice(0, 5).map((d, i) => (
          <div key={i} className="day">
            <div className="d">{["Tomorrow", "Sat", "Sun", "Mon", "Tue"][i] || `+${i + 1}d`}</div>
            <div style={{ marginTop: 4, marginBottom: 4 }}>
              <WeatherIcon condition={d.condition} size={42} />
            </div>
            <div className="t">{d.temperature}°</div>
            <div className="lo">↓ {d.templow}°</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Presence
   ----------------------------------------------------------------*/
export function PresenceCard({ index = 0 }) {
  const p = GH_DATA.presence["person.samuel_lawrence"];
  const dev = GH_DATA.presence["device_tracker.sams_iphone"];
  return (
    <Card index={index} eyebrow="Presence · person.samuel_lawrence">
      <div className="presence-row">
        <div className="presence-avatar">S</div>
        <div className="presence-info">
          <div className="nm">Samuel</div>
          <div className="where">{p.state === "home" ? "Home · iPhone in range" : "Away"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow" style={{ fontSize: 9 }}>Battery</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, marginTop: 4 }}>
            {dev.attributes.battery_level}%
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Scenes
   ----------------------------------------------------------------*/
export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  const scenes = [
    { id: "morning", nm: "Morning", ic: "◑", sub: "scene.morning" },
    { id: "movie", nm: "Movie", ic: "▶", sub: "scene.movie" },
    { id: "goodnight", nm: "Goodnight", ic: "☾", sub: "scene.goodnight" },
    { id: "all_off", nm: "All off", ic: "○", sub: "scene.all_off" },
  ];
  async function run(id) {
    setFiring(id);
    try {
      await callService("scene", "turn_on", { entity_id: `scene.${id}` });
    } catch (e) {
      console.warn("[scenes] failed", id, e);
    }
    setTimeout(() => setFiring(null), 1100);
  }
  return (
    <Card index={index} eyebrow="Scenes · 4 scripts" title="Quick scenes" meta={firing ? `Running · ${firing}` : "Idle"}>
      <div className="scenes-grid">
        {scenes.map((s) => (
          <button key={s.id} className={`scene ${s.id} ${firing === s.id ? "firing" : ""}`} onClick={() => run(s.id)}>
            <div className="scene-ic">{s.ic}</div>
            <div>
              <div className="scene-nm">{s.nm}</div>
              <div className="scene-sub">{s.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Media — Spotify now playing (compact)
   ----------------------------------------------------------------*/
export function MediaCard({ index = 0 }) {
  const live = useEntity("media_player.spotify_samuel_lawrence");
  const m = live || GH_DATA.media["media_player.spotify_samuel_lawrence"];
  const a = m.attributes || {};
  const duration = a.media_duration || 1;
  const [pos, setPos] = useState(a.media_position || 0);
  const [playing, setPlaying] = useState(m.state === "playing");
  useEffect(() => {
    if (live) {
      setPlaying(live.state === "playing");
      if (live.attributes?.media_position != null) setPos(live.attributes.media_position);
    }
  }, [live?.state, live?.attributes?.media_position]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPos((p) => (p + 1) % duration), 1000);
    return () => clearInterval(id);
  }, [playing, duration]);
  const pct = (pos / duration) * 100;
  const t = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function playPause() {
    const next = !playing;
    setPlaying(next);
    callService("media_player", next ? "media_play" : "media_pause", { entity_id: "media_player.spotify_samuel_lawrence" }).catch(() => setPlaying(playing));
  }
  function seek(toSec) {
    setPos(toSec);
    callService("media_player", "media_seek", { entity_id: "media_player.spotify_samuel_lawrence", seek_position: toSec }).catch(() => {});
  }

  return (
    <Card index={index} eyebrow="Spotify · samuel_lawrence" meta={playing ? "Playing" : "Paused"}>
      <div className="media-row">
        <div className="media-art" />
        <div className="media-info">
          <div className="t">{a.media_title}</div>
          <div className="a">
            {a.media_artist} · {a.media_album_name}
          </div>
        </div>
      </div>
      <div className="media-bar">
        <span style={{ "--p": `${pct}%` }} />
      </div>
      <div className="media-times">
        <span>{t(Math.floor(pos))}</span>
        <span>-{t(Math.floor(a.media_duration - pos))}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
        <button className="btn icon" onClick={() => seek(Math.max(0, pos - 15))}>⏮</button>
        <button className="btn icon primary" onClick={playPause}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="btn icon" onClick={() => seek(Math.min(duration - 1, pos + 15))}>⏭</button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Printer — Bambu X1C
   ----------------------------------------------------------------*/
export function PrinterCard({ index = 0, compact }) {
  const PREFIX = "x1c_00m09d522400385";
  const liveProg = useEntity(`sensor.${PREFIX}_print_progress`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  const liveRemaining = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveNozzle = useEntity(`sensor.${PREFIX}_nozzle_temperature`);
  const liveBed = useEntity(`sensor.${PREFIX}_bed_temperature`);
  const liveChamber = useEntity(`sensor.${PREFIX}_chamber_temperature`);
  const liveAms = useEntity(`sensor.${PREFIX}_ams_1_humidity`);
  const liveTray = useEntity(`sensor.${PREFIX}_active_tray`);
  const liveLight = useEntity(`light.${PREFIX}_chamber_light`);
  const liveImage = useEntity(`image.${PREFIX}_cover_image`);

  const p = GH_DATA.printer;
  const prog = Number(liveProg?.state ?? p[`sensor.${PREFIX}_print_progress`].state);
  const stage = liveStage?.state ?? p[`sensor.${PREFIX}_current_stage`].state;
  const remaining = Number(liveRemaining?.state ?? p[`sensor.${PREFIX}_remaining_time`].state);
  const nozzle = Number(liveNozzle?.state ?? p[`sensor.${PREFIX}_nozzle_temperature`].state);
  const bed = Number(liveBed?.state ?? p[`sensor.${PREFIX}_bed_temperature`].state);
  const chamber = Number(liveChamber?.state ?? p[`sensor.${PREFIX}_chamber_temperature`].state);
  const ams = Number(liveAms?.state ?? p[`sensor.${PREFIX}_ams_1_humidity`].state);
  const tray = liveTray?.state ?? p[`sensor.${PREFIX}_active_tray`].state;
  const fileName = liveProg?.attributes?.file_name || p.file;
  const [light, setLight] = useState((liveLight?.state ?? p[`light.${PREFIX}_chamber_light`].state) === "on");
  useEffect(() => { if (liveLight) setLight(liveLight.state === "on"); }, [liveLight?.state]);
  function toggleLight() {
    const next = !light;
    setLight(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: `light.${PREFIX}_chamber_light` }).catch(() => setLight(light));
  }
  // Use last_updated as a cache-bust so the cover image refreshes when HA pushes a new frame.
  const coverSrc = liveImage ? imageUrl(`image.${PREFIX}_cover_image`, liveImage.last_updated) : null;

  return (
    <Card index={index} eyebrow="3D Printer · Bambu X1C" title="Printing" meta={`stage · ${stage}`}>
      <div className="printer-body" style={compact ? { gridTemplateColumns: "120px 1fr", gap: 14 } : null}>
        <div
          className="printer-tile"
          style={{
            ...(compact ? { width: 120, height: 120 } : null),
            backgroundImage: coverSrc ? `url(${coverSrc})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <span className="live">{coverSrc ? "LIVE · cover" : "cover_image"}</span>
          <span className="file">{fileName}</span>
        </div>
        <div className="printer-info">
          <div>
            <div className="printer-stage" style={{ marginBottom: 8 }}>{fileName}</div>
            <div className="progress">
              <span style={{ "--p": `${prog}%` }} />
            </div>
            <div className="progress-foot">
              <span>
                <b>{prog}%</b> complete
              </span>
              <span>
                <b>{remaining} min</b> remaining
              </span>
            </div>
          </div>
          <div className="printer-stats">
            <div>
              <div className="k">Nozzle</div>
              <div className="v">{nozzle}°</div>
            </div>
            <div>
              <div className="k">Bed</div>
              <div className="v">{bed}°</div>
            </div>
            <div>
              <div className="k">Chamber</div>
              <div className="v">{chamber}°</div>
            </div>
            <div>
              <div className="k">AMS RH</div>
              <div className="v">{ams}%</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span className="meta">
              Filament · <b style={{ color: "var(--ink-2)" }}>{tray}</b>
            </span>
            <button className={`chamber-btn ${light ? "on" : ""}`} onClick={toggleLight}>
              <span className="sw" />
              Chamber light · {light ? "on" : "off"}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Vacuum — Roborock S8 "Gregory"
   ----------------------------------------------------------------*/
export function VacuumCard({ index = 0 }) {
  const liveVac = useEntity("vacuum.roborock_s8");
  const liveBat = useEntity("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  const v = GH_DATA.vacuum;
  const battery = Number(liveBat?.state ?? v["sensor.roborock_s8_battery"].state);
  const status = liveStatus?.state ?? v["sensor.roborock_s8_status"].state;
  const last = v["sensor.roborock_s8_last_clean_end"].state;
  const [state, setState] = useState(liveVac?.state ?? v["vacuum.roborock_s8"].state);
  const unavailable = liveVac?.state === "unavailable";
  useEffect(() => {
    if (liveVac?.state) setState(liveVac.state);
  }, [liveVac?.state]);
  const cleaning = state === "cleaning";
  function start() {
    setState("cleaning");
    callService("vacuum", "start", { entity_id: "vacuum.roborock_s8" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function dock() {
    setState("returning");
    callService("vacuum", "return_to_base", { entity_id: "vacuum.roborock_s8" }).catch(() => setState("cleaning"));
  }

  return (
    <Card index={index} eyebrow="Vacuum · roborock_s8" title="Gregory" meta={unavailable ? "Reauth required" : `Last clean · ${last}`}>
      <div className="vacuum-state">
        {unavailable ? "Unavailable — reauth in HA Settings → Devices → Roborock" : (cleaning ? "Cleaning · main floor" : `Docked · ${status}`)}
      </div>
      <div className="vacuum-map">
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="gh-grid" width="14" height="14" patternUnits="userSpaceOnUse">
              <path d="M 14 0 L 0 0 0 14" fill="none" stroke="var(--rule)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="320" height="180" fill="url(#gh-grid)" />
          <g fill="color-mix(in oklch, var(--accent), transparent 88%)" stroke="var(--ink-3)" strokeWidth="0.8">
            <rect x="20" y="22" width="118" height="74" />
            <rect x="142" y="22" width="80" height="74" />
            <rect x="226" y="22" width="74" height="100" />
            <rect x="20" y="100" width="78" height="58" />
            <rect x="102" y="100" width="120" height="58" />
          </g>
          <path
            d="M 60 60 Q 90 40 120 60 T 200 60 T 270 70 T 220 130 T 130 130 T 60 130"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray={cleaning ? "0" : "3 4"}
            opacity="0.7"
          />
          <circle cx="40" cy="135" r="5" fill="var(--good)" />
          <text x="48" y="139" fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-3)" letterSpacing="0.1em">
            DOCK
          </text>
          {cleaning ? (
            <circle cx="200" cy="100" r="4" fill="var(--accent-2)">
              <animate attributeName="cx" values="60;120;200;270;220;130;60" dur="6s" repeatCount="indefinite" />
              <animate attributeName="cy" values="60;60;60;70;130;130;130" dur="6s" repeatCount="indefinite" />
            </circle>
          ) : null}
        </svg>
      </div>
      <div className="vacuum-stats">
        <div>
          <div className="k">Battery</div>
          <div className={`v ${battery >= 90 ? "good" : ""}`}>{battery}%</div>
        </div>
        <div>
          <div className="k">Status</div>
          <div
            className="v"
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            {cleaning ? "ACTIVE" : status.toUpperCase()}
          </div>
        </div>
        <div>
          <div className="k">Action</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {cleaning ? (
              <button className="btn" onClick={dock} disabled={unavailable}>Dock</button>
            ) : (
              <button className="btn accent" onClick={start} disabled={unavailable}>Start</button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Air purifier — Levoit Core 300S
   ----------------------------------------------------------------*/
export function AirPurifierCard({ index = 0 }) {
  const liveFan = useEntity("fan.core_300s_series");
  const liveQ = useEntity("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const liveFilt = useEntity("sensor.core_300s_series_filter_lifetime");
  const a = GH_DATA.air;
  const q = liveQ?.state ?? a["sensor.core_300s_series_air_quality"].state;
  const pm = Number(livePm?.state ?? a["sensor.core_300s_series_pm2_5"].state);
  const filt = Number(liveFilt?.state ?? a["sensor.core_300s_series_filter_lifetime"].state);
  const [preset, setPreset] = useState(liveFan?.attributes?.preset_mode ?? a["fan.core_300s_series"].attributes.preset_mode);
  const [on, setOn] = useState((liveFan?.state ?? a["fan.core_300s_series"].state) === "on");
  useEffect(() => {
    if (!liveFan) return;
    setOn(liveFan.state === "on");
    if (liveFan.attributes?.preset_mode) setPreset(liveFan.attributes.preset_mode);
  }, [liveFan?.state, liveFan?.attributes?.preset_mode]);
  function toggleFan() {
    const next = !on;
    setOn(next);
    callService("fan", next ? "turn_on" : "turn_off", { entity_id: "fan.core_300s_series" }).catch(() => setOn(on));
  }
  function setFanPreset(p) {
    setPreset(p);
    if (!on) setOn(true);
    callService("fan", "set_preset_mode", { entity_id: "fan.core_300s_series", preset_mode: p }).catch(() => {});
  }

  const C = 2 * Math.PI * 90;
  const offset = C * (1 - filt / 100);

  return (
    <Card
      index={index}
      eyebrow="Air · core_300s_series"
      title="Air purifier"
      meta="filter · 96%"
      headRight={
        <div className={`toggle ${on ? "on" : ""}`} onClick={toggleFan} role="switch" aria-checked={on} />
      }
    >
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
            Currently running <b>{preset}</b>. Display is on. Last filter check 12 days ago.
          </div>
          <div className="preset-row">
            {["sleep", "auto", "low", "medium", "high"].map((p) => (
              <button key={p} className={`preset ${preset === p ? "on" : ""}`} onClick={() => setFanPreset(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Heater — Govee
   ----------------------------------------------------------------*/
export function HeaterCard({ index = 0 }) {
  const liveTemp = useEntity("input_number.govee_heater_temperature");
  const initialTemp = Number(liveTemp?.state ?? GH_DATA.climate["input_number.govee_heater_temperature"].state);
  const [temp, setTemp] = useState(initialTemp);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (liveTemp) setTemp(Number(liveTemp.state));
  }, [liveTemp?.state]);
  function commitTemp(v) {
    setTemp(v);
    callService("input_number", "set_value", { entity_id: "input_number.govee_heater_temperature", value: v }).catch(() => {});
  }
  function toggleHeater() {
    const next = !on;
    setOn(next);
    // The Pi has rest_command.govee_heater_control wired up; signature depends on /config.
    // Sending action: on/off as a best-guess; adjust if the rest_command expects different params.
    callService("rest_command", "govee_heater_control", { power: next ? "on" : "off" }).catch((e) => {
      console.warn("[heater] rest_command failed — check param names", e);
      setOn(on);
    });
  }
  const angle = Math.max(0, Math.min(270, ((temp - 12) / 18) * 270));

  return (
    <Card
      index={index}
      eyebrow="Climate · Govee heater"
      title="Heater"
      meta={on ? `On · target ${temp}°` : `Off · target ${temp}°`}
    >
      <div className="heater-body">
        <div>
          <div className="heater-num">
            {temp}
            <span className="u">°c</span>
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            Drives <b style={{ color: "var(--ink-2)" }}>input_number.govee_heater_temperature</b>
          </div>
          <div className="heater-controls">
            <button className="heater-step" onClick={() => commitTemp(Math.max(12, temp - 1))}>−</button>
            <button className="heater-step" onClick={() => commitTemp(Math.min(30, temp + 1))}>+</button>
            <button className={`btn ${on ? "accent" : "primary"}`} onClick={toggleHeater}>
              {on ? "Turn off" : "Turn on"}
            </button>
          </div>
        </div>
        <div className="heater-dial" style={{ "--ang": `${angle}deg` }}>
          <div className="heater-dial-inner">
            <div>
              <div className="set">Target</div>
              <div className="val">{temp}°</div>
              <div className="act">{on ? "Heating" : "Idle"}</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   AdGuard — full card (with ring + filtering toggle)
   ----------------------------------------------------------------*/
export function AdGuardCard({ index = 0 }) {
  const a = GH_DATA.adguard;
  const ratio = a["sensor.adguard_home_dns_queries_blocked_ratio"].state;
  const total = a["sensor.adguard_home_dns_queries"].state;
  const blocked = a["sensor.adguard_home_dns_queries_blocked"].state;
  const [prot, setProt] = useState(a["switch.adguard_home_protection"].state === "on");
  const [filt, setFilt] = useState(a["switch.adguard_home_filtering"].state === "on");

  const C = 2 * Math.PI * 90;
  const offset = C * (1 - ratio / 100);

  return (
    <Card
      index={index}
      eyebrow="Network · AdGuard Home"
      title="Filtering"
      meta={prot ? "Protected" : "Disabled"}
      headRight={<div className={`toggle ${prot ? "on" : ""}`} onClick={() => setProt(!prot)} role="switch" />}
    >
      <div className="adg-body">
        <div className="purifier-ring">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" className="bg" />
            <circle
              cx="100"
              cy="100"
              r="90"
              className="fg"
              strokeDasharray={C}
              strokeDashoffset={offset}
              style={{ stroke: "var(--bad)" }}
            />
          </svg>
          <div className="purifier-num">
            <div>
              <div className="label">Blocked</div>
              <div className="big">
                {ratio.toFixed(1)}
                <span style={{ fontSize: "0.45em", color: "var(--bad)" }}>%</span>
              </div>
              <div className="sub">last 24h</div>
            </div>
          </div>
        </div>
        <div className="adg-info">
          <div className="h">
            <b>{blocked.toLocaleString()}</b> of {total.toLocaleString()} queries blocked today.
          </div>
          <div className="adg-cap">
            <div>
              <div className="k">Queries</div>
              <div className="v">{total.toLocaleString()}</div>
            </div>
            <div>
              <div className="k">Filtering</div>
              <div className="v good" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {filt ? "Active" : "Off"}
                <div
                  className={`toggle ${filt ? "on" : ""}`}
                  style={{ transform: "scale(0.85)" }}
                  onClick={() => setFilt(!filt)}
                  role="switch"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function BlockedDomainsCard({ index = 0 }) {
  const top = GH_DATA.adguard.top_blocked;
  const max = top[0].count;
  return (
    <Card index={index} eyebrow="Top blocked domains · 24h" title="Loudest offenders">
      <div className="domains">
        {top.map((d, i) => (
          <div key={i} className="domain">
            <span className="ix">{String(i + 1).padStart(2, "0")}</span>
            <span className="nm">{d.name}</span>
            <span className="right">
              <span className="bar">
                <span style={{ "--w": `${(d.count / max) * 100}%` }} />
              </span>
              <span className="count">{d.count}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   System — Pi health
   ----------------------------------------------------------------*/
export function PiCard({ index = 0 }) {
  const liveCpu = useEntity("sensor.system_monitor_processor_use");
  const liveMem = useEntity("sensor.system_monitor_memory_use");
  const liveTemp = useEntity("sensor.system_monitor_processor_temperature");
  const liveDisk = useEntity("sensor.system_monitor_disk_usage_config"); // % (was disk_use_config which is bytes)
  const s = GH_DATA.system;
  const cpu = Number(liveCpu?.state ?? s["sensor.system_monitor_processor_use"].state);
  const memMiB = Number(liveMem?.state ?? s["sensor.system_monitor_memory_use"].state);
  const memPct = (memMiB / 4096) * 100;
  const temp = Number(liveTemp?.state ?? s["sensor.system_monitor_processor_temperature"].state);
  const disk = Number(liveDisk?.state ?? s["sensor.system_monitor_disk_use_config"].state);

  return (
    <Card index={index} eyebrow="System · raspberry_pi" title="Pi health" meta="all healthy">
      <div className="pi-rows">
        <div className="pi-row">
          <span className="k">CPU</span>
          <div className="bar"><span style={{ "--p": `${cpu}%` }} /></div>
          <span className="v">{cpu}%</span>
        </div>
        <div className="pi-row">
          <span className="k">Memory</span>
          <div className="bar"><span style={{ "--p": `${memPct}%` }} /></div>
          <span className="v">{memMiB.toFixed(0)} MiB</span>
        </div>
        <div className="pi-row warn">
          <span className="k">Temp</span>
          <div className="bar"><span style={{ "--p": `${(temp / 80) * 100}%` }} /></div>
          <span className="v">{temp}°C</span>
        </div>
        <div className="pi-row">
          <span className="k">Disk</span>
          <div className="bar"><span style={{ "--p": `${disk}%` }} /></div>
          <span className="v">{disk}%</span>
        </div>
      </div>
    </Card>
  );
}

export function BackupCard({ index = 0 }) {
  const b = GH_DATA.backup;
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  function runBackup() {
    if (running) return;
    setRunning(true);
    setPct(0);
    setLastResult(null);
    let p = 0;
    const id = setInterval(() => {
      p += 4 + Math.random() * 6;
      if (p >= 100) {
        p = 100;
        clearInterval(id);
        setPct(100);
        setTimeout(() => {
          setRunning(false);
          setLastResult({ at: "just now", size: "1.43 GB" });
          setPct(0);
        }, 600);
      } else {
        setPct(p);
      }
    }, 220);
  }

  return (
    <Card
      index={index}
      eyebrow="Backup · automatic + manual"
      title="Backups"
      headRight={
        <button
          className={`btn ${running ? "" : "primary"}`}
          onClick={runBackup}
          disabled={running}
          style={{ opacity: running ? 0.7 : 1 }}
        >
          {running ? `Backing up · ${Math.round(pct)}%` : "Backup now"}
        </button>
      }
    >
      {running && (
        <div className="progress" style={{ marginBottom: 12 }}>
          <span style={{ "--p": `${pct}%` }} />
        </div>
      )}
      <div className="kv">
        <span className="k">Last</span>
        <span className="v">
          {lastResult
            ? `just now · ${lastResult.size}`
            : `${b["sensor.backup_last_successful_automatic_backup"].state} · ${b.last_size}`}
        </span>
        <span className="k">Next</span>
        <span className="v">{b["sensor.backup_next_scheduled_automatic_backup"].state}</span>
        <span className="k">Method</span>
        <span className="v">{b.method}</span>
        <span className="k">Retention</span>
        <span className="v">{b.retention_days} days</span>
      </div>
    </Card>
  );
}

export function EntityHealthCard({ index = 0 }) {
  const h = GH_DATA.health;
  // Live counts come from the shared socket — see useEntityCounts in ha/useEntity.js.
  // Importing here would create a circular dep, so we read once from state in the parent
  // via the topbar; this card keeps the curated "expected unavailable" groups list which
  // is human knowledge, not entity state.
  return (
    <Card
      index={index}
      eyebrow={`Entity registry · ${h.available} online · ${h.unavailable} unavailable`}
      title="Unavailable groups"
      meta="known, expected"
    >
      <div className="health">
        {h.groups.map((g, i) => (
          <div key={i} className="health-row">
            <div className="ct">{g.count}</div>
            <div>
              <div className="nm">{g.name}</div>
              <div className="note">{g.note}</div>
            </div>
            <span className="pill">expected</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ShoppingCard({ index = 0 }) {
  const live = useEntity("todo.shopping_list");
  const [items, setItems] = useState(GH_DATA.todo["todo.shopping_list"].items);
  const count = Number(live?.state ?? GH_DATA.todo["todo.shopping_list"].count);
  // todo lists need a service call to read items — the entity's state is just a count.
  useEffect(() => {
    if (!live) return;
    callService("todo", "get_items", { entity_id: "todo.shopping_list" }, undefined)
      .then((r) => {
        const list = r?.service_response?.["todo.shopping_list"]?.items;
        if (Array.isArray(list)) setItems(list.map((x) => x.summary || x.uid));
      })
      .catch(() => {});
  }, [live?.state]);
  return (
    <Card index={index} eyebrow={`Shopping · ${count} items`} title="Shopping list">
      <ul className="shopping">
        {items.slice(0, 6).map((it, i) => (
          <li key={i}>{it}</li>
        ))}
        {items.length > 6 && (
          <li style={{ color: "var(--ink-3)", borderBottom: 0 }}>… and {items.length - 6} more</li>
        )}
      </ul>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Light card — toggle + brightness + color
   ----------------------------------------------------------------*/
const LIGHT_PRESETS = [
  { id: "warm", label: "Warm 2200K", rgb: [255, 170, 110], kelvin: 2200 },
  { id: "amber", label: "Amber 2700K", rgb: [255, 198, 130], kelvin: 2700 },
  { id: "neutral", label: "Neutral 4000K", rgb: [255, 235, 200], kelvin: 4000 },
  { id: "cool", label: "Cool 5500K", rgb: [220, 235, 255], kelvin: 5500 },
  { id: "red", label: "Red", rgb: [255, 80, 80] },
  { id: "orange", label: "Orange", rgb: [255, 140, 60] },
  { id: "green", label: "Forest", rgb: [110, 200, 130] },
  { id: "blue", label: "Blue", rgb: [110, 180, 255] },
  { id: "purple", label: "Purple", rgb: [200, 130, 240] },
  { id: "pink", label: "Pink", rgb: [255, 130, 200] },
];

function rgbStr(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function LightCard({ index = 0, entityId }) {
  const live = useEntity(entityId);
  const e = live || GH_DATA.lights[entityId];
  const placeholder = e.attributes?.placeholder;
  const initialRgb = e.attributes?.rgb_color || [255, 198, 130];
  const [on, setOn] = useState(e.state === "on");
  const [bright, setB] = useState(e.attributes?.brightness || 180);
  const [rgb, setRgb] = useState(initialRgb);

  useEffect(() => {
    if (!live) return;
    setOn(live.state === "on");
    if (live.attributes?.brightness != null) setB(live.attributes.brightness);
    if (live.attributes?.rgb_color) setRgb(live.attributes.rgb_color);
  }, [live?.state, live?.attributes?.brightness, live?.attributes?.rgb_color?.join(",")]);

  function toggle() {
    if (placeholder) return;
    const next = !on;
    setOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => setOn(on));
  }

  function pickColor(p) {
    if (placeholder) return;
    setRgb(p.rgb);
    if (!on) setOn(true);
    const data = { entity_id: entityId, rgb_color: p.rgb };
    if (p.kelvin) data.color_temp_kelvin = p.kelvin;
    callService("light", "turn_on", data).catch(() => {});
  }

  function commitBrightness(v) {
    setB(v);
    if (placeholder || !on) return;
    callService("light", "turn_on", { entity_id: entityId, brightness: v }).catch(() => {});
  }

  const glow = on
    ? `0 0 24px ${rgbStr([rgb[0], rgb[1], rgb[2]])}33, 0 0 80px ${rgbStr([rgb[0], rgb[1], rgb[2]])}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow={`Light · ${entityId}`}
      title={e.attributes.friendly_name}
      meta={placeholder ? "Not yet added" : on ? `On · ${Math.round((bright / 255) * 100)}%` : "Off"}
      headRight={
        placeholder ? (
          <span
            className="pill"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px dashed var(--rule)",
            }}
          >
            future
          </span>
        ) : (
          <div className={`toggle ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} />
        )
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
          opacity: placeholder ? 0.5 : 1,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: on
              ? `radial-gradient(circle at 32% 32%, white 0%, ${rgbStr(rgb)} 55%, ${rgbStr([
                  Math.max(0, rgb[0] - 60),
                  Math.max(0, rgb[1] - 60),
                  Math.max(0, rgb[2] - 60),
                ])} 100%)`
              : "color-mix(in oklch, var(--ink), transparent 88%)",
            boxShadow: glow,
            transition: "background 0.3s ease, box-shadow 0.4s ease",
            border: "1px solid var(--glass-stroke)",
          }}
        />
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Brightness</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {Math.round((bright / 255) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={bright}
            disabled={placeholder || !on}
            onChange={(ev) => setB(Number(ev.target.value))}
            onPointerUp={(ev) => commitBrightness(Number(ev.target.value))}
            onKeyUp={(ev) => commitBrightness(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: on ? rgbStr(rgb) : "var(--ink-4)" }}
          />
        </div>
      </div>

      {!placeholder && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Color · curated</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LIGHT_PRESETS.map((p) => {
              const selected = rgb[0] === p.rgb[0] && rgb[1] === p.rgb[1] && rgb[2] === p.rgb[2];
              return (
                <button
                  key={p.id}
                  onClick={() => pickColor(p)}
                  title={p.label}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: rgbStr(p.rgb),
                    border: selected ? "2px solid var(--ink)" : "2px solid var(--glass-stroke-2)",
                    cursor: "pointer",
                    padding: 0,
                    boxShadow: selected ? "0 0 0 2px var(--glass-bg-2)" : "0 1px 3px rgba(0,0,0,0.08)",
                    transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s ease",
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------
   Fan
   ----------------------------------------------------------------*/
export function FanCard({ index = 0 }) {
  const live = useEntity("fan.ceiling");
  const f = live || GH_DATA.fans["fan.ceiling"];
  const [on, setOn] = useState(f.state === "on");
  const [pct, setPct] = useState(f.attributes?.percentage || 0);
  const presets = f.attributes?.preset_modes || GH_DATA.fans["fan.ceiling"].attributes.preset_modes;
  const [preset, setPreset] = useState(f.attributes?.preset_mode);
  useEffect(() => {
    if (!live) return;
    setOn(live.state === "on");
    if (live.attributes?.percentage != null) setPct(live.attributes.percentage);
    if (live.attributes?.preset_mode) setPreset(live.attributes.preset_mode);
  }, [live?.state, live?.attributes?.percentage, live?.attributes?.preset_mode]);

  function toggleFan() {
    const next = !on;
    setOn(next);
    callService("fan", next ? "turn_on" : "turn_off", { entity_id: "fan.ceiling" }).catch(() => setOn(on));
  }
  function pick(p) {
    setPreset(p);
    setOn(true);
    setPct(p === "sleep" ? 25 : p === "low" ? 40 : p === "medium" ? 65 : 100);
    callService("fan", "set_preset_mode", { entity_id: "fan.ceiling", preset_mode: p }).catch(() => {});
  }

  return (
    <Card
      index={index}
      eyebrow="Fan · fan.ceiling"
      title="Ceiling fan"
      meta={on ? `${preset || "manual"} · ${pct}%` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={toggleFan} role="switch" />}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 4 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--glass-bg-2)",
            border: "1px solid var(--glass-stroke)",
            display: "grid",
            placeItems: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              position: "relative",
              animation: on ? `fanspin ${Math.max(0.4, 3 - pct / 40)}s linear infinite` : "none",
            }}
          >
            {[0, 60, 120].map((d) => (
              <div
                key={d}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 3,
                  height: 28,
                  background: "var(--ink-2)",
                  borderRadius: 3,
                  transformOrigin: "center bottom",
                  transform: `translate(-50%, -100%) rotate(${d}deg)`,
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 8,
                height: 8,
                background: "var(--ink)",
                borderRadius: "50%",
                transform: "translate(-50%, -50%)",
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Speed</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p} className={`preset ${preset === p ? "on" : ""}`} onClick={() => pick(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Quick toggles (Overview)
   ----------------------------------------------------------------*/
function QuickToggle({ entityId }) {
  const live = useEntity(entityId);
  const e = live || GH_DATA.lights[entityId];
  const initRgb = e.attributes?.rgb_color || [255, 198, 130];
  const [on, setOn] = useState(e.state === "on");
  useEffect(() => {
    if (live) setOn(live.state === "on");
  }, [live?.state]);
  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => setOn(on));
  }
  return (
    <button
      onClick={toggle}
      style={{
        background: "var(--glass-bg-2)",
        border: "1px solid var(--glass-stroke)",
        borderRadius: 14,
        padding: "12px 14px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "center",
        gap: 12,
        fontFamily: "inherit",
        color: "var(--ink)",
        textAlign: "left",
        transition: "background 0.3s ease, transform 0.2s ease",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: on
            ? `radial-gradient(circle at 35% 35%, white, ${rgbStr(initRgb)} 60%, ${rgbStr([
                Math.max(0, initRgb[0] - 60),
                Math.max(0, initRgb[1] - 60),
                Math.max(0, initRgb[2] - 60),
              ])} 100%)`
            : "color-mix(in oklch, var(--ink), transparent 88%)",
          boxShadow: on ? `0 0 14px ${rgbStr(initRgb)}55` : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{e.attributes.friendly_name}</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginTop: 2,
          }}
        >
          {on ? "On" : "Off"}
        </div>
      </div>
      <div className={`toggle ${on ? "on" : ""}`} style={{ transform: "scale(0.8)", transformOrigin: "right center" }} />
    </button>
  );
}

export function QuickLightsCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Quick · favorite lights" title="Lights at hand">
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        <QuickToggle entityId="light.bedroom" />
        <QuickToggle entityId="light.living_room" />
        <QuickToggle entityId="light.desk_strip" />
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Simple AdGuard
   ----------------------------------------------------------------*/
export function AdGuardSimpleCard({ index = 0 }) {
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveRatio = useEntity("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveProt = useEntity("switch.adguard_home_protection");
  const a = GH_DATA.adguard;
  const total = Number(liveTotal?.state ?? a["sensor.adguard_home_dns_queries"].state);
  const blocked = Number(liveBlocked?.state ?? a["sensor.adguard_home_dns_queries_blocked"].state);
  const ratio = Number(liveRatio?.state ?? a["sensor.adguard_home_dns_queries_blocked_ratio"].state);
  const [prot, setProt] = useState((liveProt?.state ?? a["switch.adguard_home_protection"].state) === "on");
  const [restarting, setRestarting] = useState(false);
  const [updating, setUpdating] = useState(false);
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  function toggleProt() {
    const next = !prot;
    setProt(next);
    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
  }

  function restart() {
    setRestarting(true);
    setTimeout(() => setRestarting(false), 1800);
  }
  function update() {
    setUpdating(true);
    setTimeout(() => setUpdating(false), 2400);
  }

  return (
    <Card index={index} eyebrow="Network · AdGuard" title="AdGuard" meta={prot ? "Live" : "Off"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: prot ? "var(--good)" : "var(--ink-4)",
              boxShadow: prot ? "0 0 0 4px rgba(50, 160, 100, 0.18)" : "none",
              transition: "background 0.3s, box-shadow 0.3s",
            }}
          />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em" }}>
              {prot ? "Protected" : "Disabled"}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginTop: 2,
              }}
            >
              {ratio.toFixed(1)}% blocked · {blocked.toLocaleString()} / {total.toLocaleString()}
            </div>
          </div>
        </div>
        <div className={`toggle ${prot ? "on" : ""}`} onClick={toggleProt} role="switch" />
      </div>

      <div
        style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rule)" }}
      >
        <button className="btn" onClick={restart} disabled={restarting} style={{ opacity: restarting ? 0.7 : 1 }}>
          <span
            style={{
              display: "inline-block",
              transition: "transform 0.6s",
              transform: restarting ? "rotate(360deg)" : "none",
            }}
          >
            ↻
          </span>
          {restarting ? "Restarting…" : "Restart"}
        </button>
        <button className="btn" onClick={update} disabled={updating} style={{ opacity: updating ? 0.7 : 1 }}>
          {updating ? "Updating…" : "Update deps"}
        </button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Uptime
   ----------------------------------------------------------------*/
export function UptimeCard({ index = 0 }) {
  const live = useEntity("sensor.uptime");
  const iso = live?.state || GH_DATA.system["sensor.uptime"].state;
  const started = new Date(iso);
  const now = new Date();
  const diffMs = now - started;
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));

  return (
    <Card index={index} eyebrow="Uptime · sensor.uptime" title="Up since">
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 44,
          fontWeight: 300,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontFeatureSettings: "'tnum'",
        }}
      >
        {days}
        <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>d</span>{" "}
        {hours}
        <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>h</span>{" "}
        {minutes}
        <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>m</span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          marginTop: 8,
          letterSpacing: "0.04em",
        }}
      >
        Since{" "}
        {started.toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Pixoo 64
   ----------------------------------------------------------------*/
export function PixooCard({ index = 0 }) {
  const live = useEntity("light.divoom_pixoo_64");
  const e = live || GH_DATA.lights["light.divoom_pixoo_64"];
  const notInstalled = !live; // Divoom integration is not on the Pi per the canonical config — card runs on mock as a preview.
  const [on, setOn] = useState(e.state === "on");
  const [bright, setB] = useState(e.attributes?.brightness ?? 200);
  const [channel, setChannel] = useState(e.attributes?.channel ?? "Clock");
  const channels = e.attributes?.available_channels ?? GH_DATA.lights["light.divoom_pixoo_64"].attributes.available_channels;

  function ChannelPreview() {
    if (!on) {
      return (
        <div
          style={{
            color: "#222",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            opacity: 0.5,
          }}
        >
          OFF
        </div>
      );
    }
    if (channel === "Clock") {
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            color: "#ff7733",
            fontSize: 24,
            letterSpacing: "-0.02em",
            textShadow: "0 0 8px #ff7733",
          }}
        >
          {hh}:{mm}
        </div>
      );
    }
    if (channel === "Weather") {
      return (
        <div
          style={{
            color: "#ffd866",
            fontFamily: "var(--font-mono)",
            fontSize: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            textShadow: "0 0 6px #ffd866",
          }}
        >
          <div style={{ fontSize: 22 }}>11°</div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>P. CLOUDY</div>
        </div>
      );
    }
    if (channel === "Visualizer") {
      return (
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 40 }}>
          {[18, 32, 24, 38, 22, 30, 16, 28].map((h, i) => (
            <div
              key={i}
              style={{
                width: 4,
                height: h,
                background: `hsl(${260 + i * 14}, 80%, 60%)`,
                borderRadius: 1,
                boxShadow: `0 0 6px hsl(${260 + i * 14}, 80%, 60%)`,
                animation: `pixooBar ${0.4 + (i % 3) * 0.15}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      );
    }
    if (channel === "Animations") {
      return (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: "conic-gradient(from 0deg, #ff66cc, #66ccff, #ffcc66, #66ffcc, #ff66cc)",
            boxShadow: "0 0 10px #ff66cc",
            animation: "pixooSpin 4s linear infinite",
          }}
        />
      );
    }
    return (
      <div style={{ color: "#aaa", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em" }}>
        CUSTOM
      </div>
    );
  }

  return (
    <Card
      index={index}
      eyebrow={notInstalled ? "Light · light.divoom_pixoo_64 · preview" : "Light · light.divoom_pixoo_64"}
      title="Pixoo 64 · bedroom"
      meta={notInstalled ? "integration not installed" : on ? `${channel} · ${Math.round((bright / 255) * 100)}%` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)} role="switch" />}
    >
      <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 18, alignItems: "center", marginTop: 4 }}>
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 12,
            background: "#0a0a0d",
            border: "1px solid var(--glass-stroke)",
            padding: 6,
            boxShadow: on
              ? `0 0 22px ${
                  channel === "Clock" ? "#ff7733" : channel === "Weather" ? "#ffd866" : "#7755ff"
                }44, inset 0 0 0 1px rgba(255,255,255,0.06)`
              : "inset 0 0 0 1px rgba(255,255,255,0.04)",
            transition: "box-shadow 0.5s ease",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 6,
              background: "linear-gradient(135deg, #050507, #0a0a10)",
              display: "grid",
              placeItems: "center",
              opacity: on ? 1 : 0.4,
              transition: "opacity 0.3s ease",
              backgroundImage:
                "linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "5px 5px",
            }}
          >
            <ChannelPreview />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Brightness</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {Math.round((bright / 255) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={bright}
            disabled={!on}
            onChange={(ev) => setB(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Channel</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {channels.map((c) => (
            <button
              key={c}
              className={`preset ${channel === c ? "on" : ""}`}
              disabled={!on}
              onClick={() => setChannel(c)}
              style={{ opacity: !on ? 0.5 : 1 }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Add-ons updates
   ----------------------------------------------------------------*/
export function AddonsCard({ index = 0 }) {
  const a = GH_DATA.addons;
  const [pending, setPending] = useState(a.list);
  const [updatingId, setUpdatingId] = useState(null);
  const [allUpdating, setAllUpdating] = useState(false);

  function updateOne(slug) {
    setUpdatingId(slug);
    setTimeout(() => {
      setPending((list) => list.filter((x) => x.slug !== slug));
      setUpdatingId(null);
    }, 1400);
  }
  function updateAll() {
    setAllUpdating(true);
    setTimeout(() => {
      setPending([]);
      setAllUpdating(false);
    }, 2400);
  }

  return (
    <Card
      index={index}
      eyebrow={`Add-ons · ${a.all_addons} installed`}
      title={pending.length ? `${pending.length} update${pending.length > 1 ? "s" : ""} available` : "All up to date"}
      meta={pending.length ? "supervisor" : "✓ current"}
      headRight={
        pending.length > 0 && (
          <button className="btn primary" disabled={allUpdating} onClick={updateAll}>
            {allUpdating ? "Updating all…" : "Update all"}
          </button>
        )
      }
    >
      {pending.length === 0 ? (
        <div
          style={{
            color: "var(--ink-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            padding: "8px 0",
          }}
        >
          All {a.all_addons} add-ons are at the latest version. Next supervisor scan in ~1h.
        </div>
      ) : (
        <div className="domains" style={{ marginTop: 4 }}>
          {pending.map((p) => (
            <div key={p.slug} className="domain" style={{ gridTemplateColumns: "1fr auto auto", gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
                  {p.name}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: "0.04em",
                    marginTop: 2,
                  }}
                >
                  <span style={{ color: "var(--ink-4)" }}>{p.current}</span>
                  {" → "}
                  <span style={{ color: "var(--good)" }}>{p.next}</span>
                  {" · "}
                  <span
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: p.severity === "minor" ? "var(--accent-2)" : "var(--ink-4)",
                    }}
                  >
                    {p.severity}
                  </span>
                </div>
              </div>
              <button
                className="btn"
                disabled={updatingId === p.slug || allUpdating}
                onClick={() => updateOne(p.slug)}
              >
                {updatingId === p.slug ? "…" : "Update"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ================================================================
   MEDIA tab
   ================================================================*/
export function NowPlayingHero({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const live = useEntity(ENTITY);
  const m = live || GH_DATA.media[ENTITY];
  const a = m.attributes || {};
  const duration = a.media_duration || 1;
  const [pos, setPos] = useState(a.media_position || 0);
  const [playing, setPlaying] = useState(m.state === "playing");
  const [vol, setVol] = useState(Math.round((a.volume_level || 0) * 100));
  useEffect(() => {
    if (!live) return;
    setPlaying(live.state === "playing");
    if (live.attributes?.media_position != null) setPos(live.attributes.media_position);
    if (live.attributes?.volume_level != null) setVol(Math.round(live.attributes.volume_level * 100));
  }, [live?.state, live?.attributes?.media_position, live?.attributes?.volume_level]);
  function playPause() {
    const next = !playing;
    setPlaying(next);
    callService("media_player", next ? "media_play" : "media_pause", { entity_id: ENTITY }).catch(() => setPlaying(playing));
  }
  function seek(toSec) {
    setPos(toSec);
    callService("media_player", "media_seek", { entity_id: ENTITY, seek_position: toSec }).catch(() => {});
  }
  function commitVolume(v) {
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 }).catch(() => {});
  }
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPos((p) => (p + 1) % a.media_duration), 1000);
    return () => clearInterval(id);
  }, [playing, a.media_duration]);
  const pct = (pos / a.media_duration) * 100;
  const t = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow={`Now playing · ${a.source}`}
      title="Currently listening"
      meta={playing ? "Playing" : "Paused"}
    >
      <div
        className="nowplaying-grid"
        style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 24, alignItems: "center" }}
      >
        <div
          className="media-art"
          style={{
            width: 180,
            height: 180,
            borderRadius: 22,
            backgroundImage: a.entity_picture ? `url(${import.meta.env.VITE_HA_URL}${a.entity_picture})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            className="nowplaying-title"
            style={{
              fontSize: 36,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              color: "var(--ink)",
            }}
          >
            {a.media_title}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginTop: 8,
            }}
          >
            {a.media_artist} · {a.media_album_name}
          </div>

          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "var(--rule)",
              marginTop: 22,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "linear-gradient(90deg, #1db954, var(--ink))",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 6,
            }}
          >
            <span>{t(Math.floor(pos))}</span>
            <span>-{t(Math.floor(a.media_duration - pos))}</span>
          </div>

          <div
            className="nowplaying-controls"
            style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}
          >
            <button className="btn icon" onClick={() => seek(Math.max(0, pos - 15))}>⏮</button>
            <button
              className="btn icon primary"
              onClick={playPause}
              style={{ width: 48, height: 48 }}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button className="btn icon" onClick={() => seek(Math.min(duration - 1, pos + 15))}>⏭</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12, flex: 1, minWidth: 120 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                Vol
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={vol}
                onChange={(e) => setVol(Number(e.target.value))}
                onPointerUp={(e) => commitVolume(Number(e.target.value))}
                onKeyUp={(e) => commitVolume(Number(e.target.value))}
                className="gh-slider"
                style={{ flex: 1, maxWidth: 200, accentColor: "var(--accent)" }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", minWidth: 30, textAlign: "right" }}>
                {vol}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function CastTargetsCard({ index = 0 }) {
  const tgts = GH_DATA.media.cast_targets;
  const [active, setActive] = useState(tgts.find((t) => t.state === "playing")?.id || tgts[0].id);

  return (
    <Card index={index} eyebrow="Cast · audio destinations" title="Send audio to">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        {tgts.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              background: active === t.id ? "var(--ink)" : "var(--glass-bg-2)",
              color: active === t.id ? "var(--sky-top, white)" : "var(--ink)",
              border: "1px solid var(--glass-stroke)",
              borderRadius: 14,
              padding: "12px 14px",
              display: "grid",
              gridTemplateColumns: "28px 1fr auto",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background 0.3s ease, color 0.3s ease",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: active === t.id ? "var(--accent)" : "color-mix(in oklch, var(--ink), transparent 88%)",
                boxShadow: active === t.id ? `0 0 12px var(--accent)` : "none",
                transition: "background 0.3s, box-shadow 0.3s",
              }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  opacity: 0.7,
                  marginTop: 2,
                }}
              >
                {t.room} · {t.state}
              </div>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              {active === t.id ? "● Active" : "Send"}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export function TVCard({ index = 0 }) {
  const tv = GH_DATA.media["media_player.living_room_tv_5"];
  const [on, setOn] = useState(tv.state !== "off");
  const [source, setSource] = useState(tv.attributes.source || tv.attributes.source_list[0]);
  const [vol, setVol] = useState(Math.round(tv.attributes.volume_level * 100));

  return (
    <Card
      index={index}
      eyebrow="TV · living_room_tv_5"
      title="Living room TV"
      meta={on ? `${source}` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)} role="switch" />}
    >
      <div style={{ opacity: on ? 1 : 0.55, transition: "opacity 0.3s ease" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Source</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {tv.attributes.source_list.map((s) => (
            <button
              key={s}
              className={`preset ${source === s ? "on" : ""}`}
              onClick={() => {
                setSource(s);
                if (!on) setOn(true);
              }}
              disabled={!on}
            >
              {s}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--rule)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Volume
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={vol}
            disabled={!on}
            onChange={(e) => setVol(Number(e.target.value))}
            className="gh-slider"
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", minWidth: 30, textAlign: "right" }}>
            {vol}%
          </span>
        </div>
      </div>
    </Card>
  );
}

export function QueueCard({ index = 0 }) {
  const q = GH_DATA.media.queue;
  return (
    <Card index={index} eyebrow={`Queue · ${q.length} tracks`} title="Up next">
      <div className="domains" style={{ marginTop: 4 }}>
        {q.map((track, i) => (
          <div key={i} className="domain" style={{ gridTemplateColumns: "24px 1fr auto" }}>
            <span className="ix">{track.now ? "▶" : String(i + 1).padStart(2, "0")}</span>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: track.now ? "var(--accent)" : "var(--ink)",
                  letterSpacing: "-0.005em",
                }}
              >
                {track.title}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                {track.artist}
              </div>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>{track.dur}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RecentCard({ index = 0 }) {
  const r = GH_DATA.media.recent;
  return (
    <Card index={index} eyebrow="Recent · playback history" title="Recently played">
      <div className="domains" style={{ marginTop: 4 }}>
        {r.map((t, i) => (
          <div key={i} className="domain" style={{ gridTemplateColumns: "1fr auto" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
                {t.title}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                {t.artist}
              </div>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              {t.played}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ================================================================
   SCHEDULE — weekly calendar + kanban board
   ================================================================*/
const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeeklyCalendarCard({ index = 0 }) {
  const s = GH_DATA.schedule;
  const startHour = 7;
  const endHour = 22;
  const slotsPerHour = 2;
  const slotPx = 26;

  const weekStart = new Date(s.week_start_iso + "T00:00:00");
  const today = new Date(s.today_iso + "T00:00:00");
  const todayDow = (today.getDay() + 6) % 7;

  const now = useNow();
  const nowOffset = (now - startHour) * 2 * slotPx;
  const showNow = now >= startHour && now <= endHour;

  function hourLabel(h) {
    const hh = Math.floor(h);
    return `${String(hh).padStart(2, "0")}:00`;
  }

  function eventTimeLabel(start, end) {
    const fmt = (h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    return `${fmt(start)}–${fmt(end)}`;
  }

  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  return (
    <Card
      index={index}
      eyebrow={`Calendar · week of ${s.week_start_iso}`}
      title="This week"
      meta={`${s.events.length} events`}
    >
      <div className="weekcal">
        <div className="weekcal-head">
          <div className="corner" />
          {DOWS.map((d, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            return (
              <div key={d} className={`dow ${i === todayDow ? "today" : ""}`}>
                {d}
                <span className="num">{date.getDate()}</span>
              </div>
            );
          })}
        </div>

        <div className="weekcal-times">
          {hours.map((h) => (
            <div key={h} className="h">
              {hourLabel(h)}
            </div>
          ))}
        </div>

        {DOWS.map((_, day) => {
          const dayEvents = s.events.filter((e) => e.day === day);
          return (
            <div
              key={day}
              className={`weekcal-col ${day === todayDow ? "today" : ""}`}
              style={{
                gridColumn: day + 2,
                gridRow: "2 / span 1",
                height: ((endHour - startHour) * slotsPerHour + 1) * slotPx,
              }}
            >
              {day === todayDow && showNow && <div className="weekcal-now" style={{ top: nowOffset }} />}
              {dayEvents.map((e) => {
                const top = (e.start - startHour) * slotsPerHour * slotPx;
                const h = (e.end - e.start) * slotsPerHour * slotPx;
                const short = h < 36;
                const calVar = s.calendars[e.cal].color;
                return (
                  <div
                    key={e.id}
                    className={`weekcal-event ${short ? "short" : ""}`}
                    style={{ top, height: h, "--cal-color": calVar }}
                    title={`${e.title}\n${eventTimeLabel(e.start, e.end)}\n${e.where}`}
                  >
                    <div className="t">{e.title}</div>
                    <div className="w">
                      {eventTimeLabel(e.start, e.end)} · {e.where}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {Object.entries(s.calendars).map(([id, c]) => (
          <span key={id} className="item">
            <span className="sw" style={{ "--cal-color": c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Kanban — 4 columns, HTML5 DnD
   ----------------------------------------------------------------*/
export function KanbanBoardCard({ index = 0 }) {
  const COLS = ["todo.backlog", "todo.today", "todo.doing", "todo.done"];
  const [lists, setLists] = useState(() => {
    const out = {};
    for (const id of COLS) out[id] = GH_DATA.todo_lists[id].items.slice();
    return out;
  });
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  function moveCard(uid, fromCol, toCol) {
    if (fromCol === toCol) return;
    setLists((cur) => {
      const next = { ...cur };
      next[fromCol] = cur[fromCol].filter((c) => c.uid !== uid);
      const card = cur[fromCol].find((c) => c.uid === uid);
      if (card) next[toCol] = [card, ...cur[toCol]];
      return next;
    });
  }

  function onDragStart(ev, uid, col) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ uid, col }));
    ev.dataTransfer.effectAllowed = "move";
    setDraggingId(uid);
  }
  function onDragEnd() {
    setDraggingId(null);
    setDragOver(null);
  }
  function onDragOver(ev, col) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    setDragOver(col);
  }
  function onDrop(ev, col) {
    ev.preventDefault();
    try {
      const { uid, col: fromCol } = JSON.parse(ev.dataTransfer.getData("text/plain"));
      moveCard(uid, fromCol, col);
    } catch {}
    setDragOver(null);
    setDraggingId(null);
  }

  return (
    <Card
      index={index}
      eyebrow="Kanban · todo.backlog · today · doing · done"
      title="Project board"
      meta="drag cards between columns"
    >
      <div className="kanban">
        {COLS.map((id) => {
          const meta = GH_DATA.todo_lists[id];
          const items = lists[id];
          const isDone = id === "todo.done";
          return (
            <div
              key={id}
              className={`kanban-col ${dragOver === id ? "drag-over" : ""}`}
              onDragOver={(ev) => onDragOver(ev, id)}
              onDragLeave={() => setDragOver((cur) => (cur === id ? null : cur))}
              onDrop={(ev) => onDrop(ev, id)}
            >
              <div className="kanban-col-head">
                <span className="label">{meta.label}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map((c) => (
                <div
                  key={c.uid}
                  className={`kanban-card ${isDone ? "done" : ""} ${draggingId === c.uid ? "dragging" : ""}`}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, c.uid, id)}
                  onDragEnd={onDragEnd}
                >
                  <div className="summary">{c.summary}</div>
                  <div className="meta">
                    <span className={`tag tag-${c.tag}`}>{c.tag}</span>
                    {c.due && <span className="due">due · {c.due}</span>}
                  </div>
                </div>
              ))}
              <button className="kanban-add">+ Add</button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   At-a-glance stat boxes (used on Overview)
   ----------------------------------------------------------------*/
export function StatBox({ index = 0, eyebrow, value, unit, caption, pct, color }) {
  return (
    <Card index={index} className="statbox">
      <div className="eyebrow">{eyebrow}</div>
      <div className="v">
        {value}
        {unit && <span className="u">{unit}</span>}
      </div>
      <div className="cap">{caption}</div>
      {pct !== undefined && (
        <div className="progress-mini">
          <span style={{ "--p": `${pct}%`, "--c": color || "var(--accent)" }} />
        </div>
      )}
    </Card>
  );
}
