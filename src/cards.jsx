/* Glasshouse v2 — atomic card components.
   Each card consumes GH_DATA (mock entity state) and exposes simple
   interactivity (toggles, sliders) via local state. */

import { useState, useEffect, useMemo, useRef } from "react";
import { GH_DATA } from "./data.js";
import { nowFractionalHour } from "./theme.js";
import { useEntity, useEntitiesByDomain } from "./ha/useEntity.js";
import { callService, imageUrl } from "./ha/client.js";
import { useCalendarEvents } from "./ha/useCalendarEvents.js";
import { useTodoLists } from "./ha/useTodoLists.js";

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

  const liveRising = useEntity("sensor.sun_next_rising");
  const liveSetting = useEntity("sensor.sun_next_setting");
  const fmtSun = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  const sunrise = fmtSun(liveRising?.state || GH_DATA.sun["sensor.sun_next_rising"].state);
  const sunset = fmtSun(liveSetting?.state || GH_DATA.sun["sensor.sun_next_setting"].state);

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
  const livePerson = useEntity("person.samuel_lawrence");
  const liveDev = useEntity("device_tracker.sams_iphone");
  const p = livePerson || GH_DATA.presence["person.samuel_lawrence"];
  const dev = liveDev || GH_DATA.presence["device_tracker.sams_iphone"];
  const home = p.state === "home";
  const battery = dev.attributes?.battery_level;
  return (
    <Card index={index} eyebrow="Presence · person.samuel_lawrence">
      <div className="presence-row">
        <div className="presence-avatar">S</div>
        <div className="presence-info">
          <div className="nm">{p.attributes?.friendly_name || "Samuel"}</div>
          <div className="where">
            {home ? "Home · iPhone in range" : p.state === "not_home" ? "Away" : p.state}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow" style={{ fontSize: 9 }}>Battery</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, marginTop: 4 }}>
            {battery != null ? `${battery}%` : "—"}
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
  const liveLast = useEntity("sensor.roborock_s8_last_clean_end");
  const liveMap = useEntity("select.roborock_s8_selected_map");
  const v = GH_DATA.vacuum;
  const battery = Number(liveBat?.state ?? v["sensor.roborock_s8_battery"].state);
  const status = liveStatus?.state ?? v["sensor.roborock_s8_status"].state;
  const last = formatRelativeIso(liveLast?.state) || v["sensor.roborock_s8_last_clean_end"].state;
  const mapOptions = liveMap?.attributes?.options || [];
  const currentMap = liveMap?.state;
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
  function fullClean() {
    setState("cleaning");
    callService("button", "press", { entity_id: "button.roborock_s8_full_cleaning" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function pickMap(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_selected_map", option: opt }).catch(() => {});
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
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {cleaning ? (
              <button className="btn" onClick={dock} disabled={unavailable}>Dock</button>
            ) : (
              <>
                <button className="btn accent" onClick={start} disabled={unavailable}>Start</button>
                <button className="btn" onClick={fullClean} disabled={unavailable}>Full</button>
              </>
            )}
          </div>
        </div>
      </div>
      {mapOptions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>Map</span>
          {mapOptions.map((opt) => (
            <button
              key={opt}
              className={`preset ${currentMap === opt ? "on" : ""}`}
              onClick={() => pickMap(opt)}
              disabled={unavailable}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
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
// Pi 4 hardware constants used to render % bars. HA's system_monitor
// integration exposes used (GiB) but not %, so we compute from these.
const PI_RAM_MIB = 4096;     // Pi 4 model B has 4 GB RAM
const PI_DISK_GIB = 220;     // 220 GB SSD (df -h /  →  219.4G total)

export function PiCard({ index = 0 }) {
  const liveCpu = useEntity("sensor.system_monitor_processor_use");
  const liveMem = useEntity("sensor.system_monitor_memory_use");
  const liveTemp = useEntity("sensor.system_monitor_processor_temperature");
  const liveDisk = useEntity("sensor.system_monitor_disk_use_config");
  const s = GH_DATA.system;
  const cpu = Number(liveCpu?.state ?? s["sensor.system_monitor_processor_use"].state);
  const memMiB = Number(liveMem?.state ?? s["sensor.system_monitor_memory_use"].state);
  const memPct = (memMiB / PI_RAM_MIB) * 100;
  const temp = Number(liveTemp?.state ?? s["sensor.system_monitor_processor_temperature"].state);
  const diskGiB = Number(liveDisk?.state ?? s["sensor.system_monitor_disk_use_config"].state);
  const diskPct = (diskGiB / PI_DISK_GIB) * 100;

  // Health summary derived from the worst metric.
  const health =
    temp >= 75 || cpu >= 90 || memPct >= 90 || diskPct >= 90
      ? "degraded"
      : temp >= 65 || cpu >= 70 || memPct >= 75 || diskPct >= 80
        ? "warm"
        : "all healthy";

  return (
    <Card index={index} eyebrow="System · raspberry_pi" title="Pi health" meta={health}>
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
        <div className={`pi-row ${temp >= 65 ? "warn" : ""}`}>
          <span className="k">Temp</span>
          <div className="bar"><span style={{ "--p": `${(temp / 80) * 100}%` }} /></div>
          <span className="v">{temp}°C</span>
        </div>
        <div className="pi-row">
          <span className="k">Disk</span>
          <div className="bar"><span style={{ "--p": `${diskPct}%` }} /></div>
          <span className="v">{diskGiB.toFixed(1)} GiB</span>
        </div>
      </div>
    </Card>
  );
}

// Returns "today · 15:30", "yesterday · 04:00", "in 2 days · 03:47", etc.
// Falls back to the raw string if it isn't parseable (so mock strings still render).
function formatRelativeIso(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / (24 * 3600 * 1000));
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  let day;
  if (diffDays === 0) day = "today";
  else if (diffDays === -1) day = "yesterday";
  else if (diffDays === 1) day = "tomorrow";
  else if (diffDays < 0) day = `${-diffDays} days ago`;
  else day = `in ${diffDays} days`;
  return `${day} · ${time}`;
}

function formatMiB(mib) {
  const n = Number(mib);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GiB`;
  return `${n.toFixed(0)} MiB`;
}

export function BackupCard({ index = 0 }) {
  const liveLast = useEntity("sensor.backup_last_successful_automatic_backup");
  const liveNext = useEntity("sensor.backup_next_scheduled_automatic_backup");
  const liveState = useEntity("sensor.backup_backup_manager_state");
  const liveSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");
  const b = GH_DATA.backup;

  const lastDisplay = formatRelativeIso(liveLast?.state || b["sensor.backup_last_successful_automatic_backup"].state);
  const nextDisplay = formatRelativeIso(liveNext?.state || b["sensor.backup_next_scheduled_automatic_backup"].state);
  const managerState = liveState?.state || "idle";
  const sizeDisplay = liveSize ? formatMiB(liveSize.state) : b.last_size;
  const liveRunning = managerState !== "idle" && managerState !== "unknown" && managerState !== "unavailable";

  // Local optimistic progress bar — the real backup runs server-side via
  // backup.create_automatic; we don't wait for it. The manager_state sensor
  // reflects actual progress and is shown in the "Status" row.
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);

  function runBackup() {
    if (running || liveRunning) return;
    callService("backup", "create_automatic", {}).catch(() => {});
    setRunning(true);
    setPct(0);
    let p = 0;
    const id = setInterval(() => {
      p += 4 + Math.random() * 6;
      if (p >= 100) {
        p = 100;
        clearInterval(id);
        setPct(100);
        setTimeout(() => {
          setRunning(false);
          setPct(0);
        }, 600);
      } else {
        setPct(p);
      }
    }, 220);
  }

  const buttonRunning = running || liveRunning;
  const buttonLabel = liveRunning
    ? `Backup ${managerState}`
    : running
      ? `Backing up · ${Math.round(pct)}%`
      : "Backup now";

  return (
    <Card
      index={index}
      eyebrow="Backup · automatic + manual"
      title="Backups"
      headRight={
        <button
          className={`btn ${buttonRunning ? "" : "primary"}`}
          onClick={runBackup}
          disabled={buttonRunning}
          style={{ opacity: buttonRunning ? 0.7 : 1 }}
        >
          {buttonLabel}
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
        <span className="v">{lastDisplay}</span>
        <span className="k">Next</span>
        <span className="v">{nextDisplay}</span>
        <span className="k">Status</span>
        <span className="v">{managerState}</span>
        <span className="k">Total stored</span>
        <span className="v">{sizeDisplay}</span>
      </div>
    </Card>
  );
}

export function EntityHealthCard({ index = 0 }) {
  const h = GH_DATA.health;
  // Live counts from the template sensors Samuel set up in configuration.yaml.
  // The curated groups list stays in GH_DATA — it's human knowledge about
  // *why* things are unavailable, not entity state.
  const liveAvail = useEntity("sensor.available_entities_count");
  const liveUnavail = useEntity("sensor.unavailable_entities_count");
  const available = Number(liveAvail?.state ?? h.available);
  const unavailable = Number(liveUnavail?.state ?? h.unavailable);
  return (
    <Card
      index={index}
      eyebrow={`Entity registry · ${available} online · ${unavailable} unavailable`}
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
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  function toggleProt() {
    const next = !prot;
    setProt(next);
    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
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
   Updates — driven by live `update.*` entities (core, add-ons, HACS, firmware, …)
   ----------------------------------------------------------------*/
export function AddonsCard({ index = 0 }) {
  const updates = useEntitiesByDomain("update");
  const pending = updates.filter((u) => u.state === "on");
  const [installingId, setInstallingId] = useState(null);
  const [installingAll, setInstallingAll] = useState(false);

  function installOne(entityId) {
    setInstallingId(entityId);
    callService("update", "install", { entity_id: entityId })
      .catch(() => {})
      .finally(() => setInstallingId(null));
  }
  function installAll() {
    setInstallingAll(true);
    Promise.allSettled(
      pending.map((u) => callService("update", "install", { entity_id: u.entity_id })),
    ).finally(() => setInstallingAll(false));
  }

  return (
    <Card
      index={index}
      eyebrow={`Updates · ${updates.length} tracked`}
      title={pending.length ? `${pending.length} update${pending.length > 1 ? "s" : ""} available` : "All up to date"}
      meta={pending.length ? "supervisor" : "✓ current"}
      headRight={
        pending.length > 1 && (
          <button className="btn primary" disabled={installingAll} onClick={installAll}>
            {installingAll ? "Installing all…" : "Install all"}
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
          {updates.length
            ? `All ${updates.length} tracked components are at the latest version.`
            : "Waiting for update entities…"}
        </div>
      ) : (
        <div className="domains" style={{ marginTop: 4 }}>
          {pending.map((u) => {
            const attrs = u.attributes || {};
            const name = attrs.title || attrs.friendly_name || u.entity_id;
            const current = attrs.installed_version || "—";
            const next = attrs.latest_version || "—";
            const busy = installingId === u.entity_id || installingAll;
            return (
              <div key={u.entity_id} className="domain" style={{ gridTemplateColumns: "1fr auto auto", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
                    {name}
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
                    <span style={{ color: "var(--ink-4)" }}>{current}</span>
                    {" → "}
                    <span style={{ color: "var(--good)" }}>{next}</span>
                  </div>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => installOne(u.entity_id)}
                >
                  {installingId === u.entity_id ? "…" : "Install"}
                </button>
              </div>
            );
          })}
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
  const duration = Number(a.media_duration) > 0 ? Number(a.media_duration) : 0;
  const hasDuration = duration > 0;
  const [pos, setPos] = useState(a.media_position || 0);
  const [playing, setPlaying] = useState(m.state === "playing");
  const [vol, setVol] = useState(Math.round((a.volume_level || 0) * 100));
  const idle = live && live.state !== "playing" && live.state !== "paused";
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
    if (!hasDuration) return;
    setPos(toSec);
    callService("media_player", "media_seek", { entity_id: ENTITY, seek_position: toSec }).catch(() => {});
  }
  function commitVolume(v) {
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 }).catch(() => {});
  }
  useEffect(() => {
    if (!playing || !hasDuration) return;
    const id = setInterval(() => setPos((p) => (p + 1) % duration), 1000);
    return () => clearInterval(id);
  }, [playing, duration, hasDuration]);
  const pct = hasDuration ? (pos / duration) * 100 : 0;
  const t = (s) => {
    const n = Math.max(0, Math.floor(Number(s) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  };

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow={`Now playing · ${a.source || "Spotify"}`}
      title={idle ? "Nothing playing" : "Currently listening"}
      meta={idle ? "Idle" : playing ? "Playing" : "Paused"}
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
            backgroundImage:
              a.entity_picture && !idle
                ? `url(${import.meta.env.VITE_HA_URL}${a.entity_picture})`
                : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: idle ? 0.4 : 1,
            transition: "opacity 0.3s ease",
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
            <span>{hasDuration ? t(pos) : "—"}</span>
            <span>{hasDuration ? `-${t(duration - pos)}` : "—"}</span>
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

/* Multi-room audio destinations. Spotify's source_list only ever surfaces
   Spotify Connect devices (just SAM_PC here), so we list the full
   media_player domain instead. Music Assistant entities show up naturally;
   the Spotify source itself and the Chromecast TV (already on TVCard) are
   filtered out. Each row's button calls media_player.media_play_pause on
   that target — universal across cast / MA / airplay / etc. */
const CAST_TARGETS_EXCLUDE = new Set([
  "media_player.spotify_samuel_lawrence",
  "media_player.living_room_tv",
  "media_player.living_room_tv_2", // dlna duplicate of the cast TV
]);

export function CastTargetsCard({ index = 0 }) {
  const all = useEntitiesByDomain("media_player");
  const [pending, setPending] = useState(null);

  const targets = useMemo(() => {
    return all
      .filter((s) => s && !CAST_TARGETS_EXCLUDE.has(s.entity_id))
      .map((s) => {
        const a = s.attributes || {};
        const name = a.friendly_name || s.entity_id.replace(/^media_player\./, "");
        const playing = s.state === "playing";
        const paused = s.state === "paused";
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        const off = s.state === "off";
        const title = playing || paused ? a.media_title : null;
        const artist = playing || paused ? a.media_artist : null;
        const subtitle = unavailable
          ? "offline"
          : off
            ? "off"
            : title
              ? artist
                ? `${title} · ${artist}`
                : title
              : s.state || "idle";
        return {
          id: s.entity_id,
          name,
          subtitle,
          playing,
          unavailable,
          off,
        };
      })
      .sort((a, b) => {
        // playing first, then idle/paused, then off/unavailable
        const rank = (t) => (t.playing ? 0 : t.unavailable || t.off ? 2 : 1);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [all]);

  function toggle(id) {
    setPending(id);
    callService("media_player", "media_play_pause", { entity_id: id })
      .catch((e) => console.warn("[cast] media_play_pause failed", e))
      .finally(() => setPending(null));
  }

  const playingCount = targets.filter((t) => t.playing).length;

  return (
    <Card
      index={index}
      eyebrow={`Speakers · ${targets.length} destinations`}
      title="Multi-room audio"
      meta={playingCount > 0 ? `${playingCount} playing` : null}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        {targets.map((t) => {
          const dimmed = t.unavailable || t.off;
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              disabled={dimmed || (pending && pending !== t.id)}
              style={{
                background: t.playing ? "var(--ink)" : "var(--glass-bg-2)",
                color: t.playing ? "var(--sky-top, white)" : "var(--ink)",
                border: "1px solid var(--glass-stroke)",
                borderRadius: 14,
                padding: "12px 14px",
                display: "grid",
                gridTemplateColumns: "28px 1fr auto",
                alignItems: "center",
                gap: 12,
                cursor: dimmed ? "not-allowed" : pending ? "wait" : "pointer",
                opacity: dimmed ? 0.45 : 1,
                fontFamily: "inherit",
                textAlign: "left",
                transition: "background 0.3s ease, color 0.3s ease, opacity 0.3s ease",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: t.playing ? "var(--accent)" : "color-mix(in oklch, var(--ink), transparent 88%)",
                  boxShadow: t.playing ? `0 0 12px var(--accent)` : "none",
                  transition: "background 0.3s, box-shadow 0.3s",
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    opacity: 0.7,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.subtitle}
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
                {pending === t.id ? "…" : t.playing ? "⏸ Pause" : dimmed ? "—" : "▶ Play"}
              </span>
            </button>
          );
        })}
        {targets.length === 0 && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              padding: "12px 4px",
            }}
          >
            No media destinations reported yet.
          </div>
        )}
      </div>
    </Card>
  );
}

export function TVCard({ index = 0 }) {
  const ENTITY = "media_player.living_room_tv";
  const live = useEntity(ENTITY);
  const attrs = live?.attributes || {};
  const unavailable = !live || live.state === "unavailable" || live.state === "unknown";
  const isOff = live?.state === "off";
  const isOn = !unavailable && !isOff;
  const sources = Array.isArray(attrs.source_list) ? attrs.source_list : [];
  const hasSources = sources.length > 0;

  const [on, setOn] = useState(isOn);
  const [source, setSource] = useState(attrs.source ?? null);
  const [vol, setVol] = useState(Math.round((attrs.volume_level ?? 0) * 100));
  useEffect(() => {
    if (!live) return;
    setOn(live.state !== "off" && live.state !== "unavailable" && live.state !== "unknown");
    if (live.attributes?.source !== undefined) setSource(live.attributes.source);
    if (live.attributes?.volume_level != null) setVol(Math.round(live.attributes.volume_level * 100));
  }, [live?.state, live?.attributes?.source, live?.attributes?.volume_level]);

  const appName = attrs.app_name || null;
  const mediaTitle = attrs.media_title || null;
  const statusLabel = unavailable
    ? "Off"
    : isOff
      ? "Off"
      : appName
        ? appName
        : live?.state === "playing"
          ? "Playing"
          : live?.state === "paused"
            ? "Paused"
            : "Idle";

  function togglePower() {
    if (unavailable) return;
    const next = !on;
    setOn(next);
    callService("media_player", next ? "turn_on" : "turn_off", { entity_id: ENTITY }).catch(() => setOn(on));
  }
  function pickSource(s) {
    setSource(s);
    callService("media_player", "select_source", { entity_id: ENTITY, source: s }).catch(() => setSource(source));
  }
  function commitVolume(v) {
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 }).catch(() => {});
  }

  const disabled = unavailable || isOff;

  return (
    <Card
      index={index}
      eyebrow="TV · living_room_tv"
      title="Living room TV"
      meta={statusLabel}
      headRight={
        <div
          className={`toggle ${on ? "on" : ""}`}
          onClick={unavailable ? undefined : togglePower}
          role="switch"
          aria-checked={on}
          style={{ opacity: unavailable ? 0.4 : 1, cursor: unavailable ? "not-allowed" : "pointer" }}
        />
      }
    >
      <div style={{ opacity: disabled ? 0.55 : 1, transition: "opacity 0.3s ease" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>
          {hasSources ? "Source" : "Now showing"}
        </div>
        {hasSources ? (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {sources.map((s) => (
              <button
                key={s}
                className={`preset ${source === s ? "on" : ""}`}
                onClick={() => pickSource(s)}
                disabled={disabled}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--ink-2)",
              minHeight: 32,
              display: "flex",
              alignItems: "center",
            }}
          >
            {unavailable
              ? "TV is off the network"
              : isOff
                ? "TV is off"
                : appName
                  ? mediaTitle
                    ? `${appName} · ${mediaTitle}`
                    : appName
                  : "Idle"}
          </div>
        )}

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
            disabled={disabled}
            onChange={(e) => setVol(Number(e.target.value))}
            onPointerUp={(e) => commitVolume(Number(e.target.value))}
            onKeyUp={(e) => commitVolume(Number(e.target.value))}
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
  // Still mock. HA's Spotify integration doesn't expose the queue. Music
  // Assistant (installed on the Pi) holds queues internally but doesn't
  // surface them as HA entities — only as `music_assistant.get_queue`
  // service calls that need WS-with-response handling. Either path is
  // a real piece of work; left as mock until prioritised.
  return (
    <Card index={index} eyebrow={`Queue · ${q.length} tracks`} title="Up next" meta="preview">
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
  // Same caveat as QueueCard — no native entity. Music Assistant exposes
  // a "favorite current song" button per player but not a play history.
  // Real history would come from HA's recorder API (state changes on
  // media_player.spotify_*) or MA's library service.
  return (
    <Card index={index} eyebrow="Recent · playback history" title="Recently played" meta="preview">
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

/* "2026-05-22T14:30:00+01:00" style — HA accepts ISO with offset and
   stores the absolute instant correctly. Avoid bare local strings since
   HA's interpretation depends on the calendar's TZ. */
function toLocalISOWithOffset(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const absOff = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`;
}

function ymd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* Mounted on demand by the parent — initial values are read once on mount,
   so opening the dialog from a clicked time slot pre-fills date + time. */
function NewEventDialog({ onClose, calendars, defaultCalendarId, initial, onCreated }) {
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const h = today.getHours();
    return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:00`;
  }, [today]);
  const defaultEnd = useMemo(() => {
    const h = today.getHours();
    return `${String(Math.min(h + 2, 23)).padStart(2, "0")}:00`;
  }, [today]);
  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState(defaultCalendarId || "");
  const [date, setDate] = useState(() => initial?.date || ymd(today));
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(() => initial?.startTime || defaultStart);
  const [endTime, setEndTime] = useState(() => initial?.endTime || defaultEnd);
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!calendarId && defaultCalendarId) setCalendarId(defaultCalendarId);
  }, [defaultCalendarId, calendarId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = title.trim() && calendarId && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = { summary: title.trim() };
      if (location.trim()) data.location = location.trim();
      if (allDay) {
        data.start_date = date;
        const d = new Date(`${date}T00:00:00`);
        d.setDate(d.getDate() + 1);
        data.end_date = ymd(d);
      } else {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const sd = new Date(`${date}T00:00:00`);
        sd.setHours(sh, sm, 0, 0);
        const ed = new Date(`${date}T00:00:00`);
        ed.setHours(eh, em, 0, 0);
        if (ed <= sd) {
          setError("End time must be after start time.");
          setSubmitting(false);
          return;
        }
        data.start_date_time = toLocalISOWithOffset(sd);
        data.end_date_time = toLocalISOWithOffset(ed);
      }
      await callService("calendar", "create_event", data, { entity_id: calendarId });
      setTitle("");
      setLocation("");
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <form className="modal" onSubmit={handleSubmit} onMouseDown={(e) => e.stopPropagation()}>
        <h3>New event</h3>

        <div className="modal-row">
          <span className="lbl">Title</span>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Coffee with Alex"
            required
          />
        </div>

        <div className="modal-row">
          <span className="lbl">Calendar</span>
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>
            {calendars.map((c) => (
              <option key={c.entity_id} value={c.entity_id}>{c.label}</option>
            ))}
          </select>
        </div>

        <label className="modal-toggle-row">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day
        </label>

        <div className="modal-row">
          <span className="lbl">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        {!allDay && (
          <div className="modal-row two">
            <div>
              <span className="lbl">Start</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div>
              <span className="lbl">End</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>
        )}

        <div className="modal-row">
          <span className="lbl">Location (optional)</span>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitting ? "Saving…" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* Greedy lane layout for one day's in-grid events. Each event gets a
   `lane` index and a `totalLanes` count for its overlap group so that
   events sharing a time slot render side-by-side instead of stacking. */
function layoutEventsInDay(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds = []; // last `end` per lane
  const out = [];
  for (const ev of sorted) {
    let lane = laneEnds.findIndex((end) => end <= ev.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.end);
    } else {
      laneEnds[lane] = ev.end;
    }
    out.push({ ...ev, _lane: lane });
  }
  /* totalLanes for each event = (max lane index of any directly-overlapping
     event in the same day) + 1. Direct overlaps only — but because lanes
     are reused greedily, this correctly handles disjoint overlap groups. */
  for (const ev of out) {
    let maxLane = ev._lane;
    for (const other of out) {
      if (other === ev) continue;
      if (other.start < ev.end && other.end > ev.start) {
        if (other._lane > maxLane) maxLane = other._lane;
      }
    }
    ev._totalLanes = maxLane + 1;
  }
  return out;
}

/* 4-var palette defined in styles.css — cycled per live calendar entity */
const CAL_PALETTE = [
  "var(--cal-work)",
  "var(--cal-personal)",
  "var(--cal-home)",
  "var(--cal-family)",
];

/* HA event → { day, start, end } in the visible week's local time.
   `start`/`end` are floats (hours, e.g. 14.5 = 2:30pm).
   `day` is 0-6 where 0 = Monday. Events outside [0,6] are dropped. */
function haEventToGridPos(ev, weekStartLocal) {
  const isAllDay = !ev.start?.dateTime;
  const startStr = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
  const endStr = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00` : null);
  if (!startStr || !endStr) return null;
  const sd = new Date(startStr);
  const ed = new Date(endStr);
  if (isNaN(sd) || isNaN(ed)) return null;

  // Day index relative to Monday-of-week, in local time.
  const dayMs = 24 * 3600 * 1000;
  const sLocalMidnight = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
  const wsMidnight = weekStartLocal.getTime();
  const day = Math.round((sLocalMidnight - wsMidnight) / dayMs);
  if (day < 0 || day > 6) return null;

  if (isAllDay) {
    // Render all-day events as a thin top-of-day bar so they're visible
    // without dominating the column.
    return { day, start: 0, end: 0.5, allDay: true };
  }
  const start = sd.getHours() + sd.getMinutes() / 60;
  const sameDay =
    ed.getFullYear() === sd.getFullYear() &&
    ed.getMonth() === sd.getMonth() &&
    ed.getDate() === sd.getDate();
  const end = sameDay ? ed.getHours() + ed.getMinutes() / 60 : 24;
  return { day, start, end, allDay: false };
}

export function WeeklyCalendarCard({ index = 0 }) {
  const mock = GH_DATA.schedule;
  const startHour = 8;
  const endHour = 22;
  const slotsPerHour = 2;
  const slotPx = 26;

  /* Today / this-week boundaries, computed live (not from mock today_iso). */
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekStart = useMemo(() => {
    const d = new Date(today);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow);
    return d;
  }, [today]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);
  const todayDow = (today.getDay() + 6) % 7;
  /* Display label only — must be local-time YYYY-MM-DD, not toISOString()
     which would shift positive-UTC-offset locales to the previous day. */
  const weekStartISO = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;

  /* Discover live calendar entities (HA's calendar.* domain). */
  const calendarEntities = useEntitiesByDomain("calendar");
  const calendarIds = useMemo(
    () => calendarEntities.map((e) => e.entity_id).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarEntities.length, calendarEntities.map((e) => e.entity_id).join(",")],
  );
  const liveMode = calendarIds.length > 0;

  /* Color + label map: cycle the 4-var palette across whatever calendars exist. */
  const calendars = useMemo(() => {
    if (!liveMode) return mock.calendars;
    const out = {};
    calendarEntities
      .slice()
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .forEach((e, i) => {
        out[e.entity_id] = {
          color: CAL_PALETTE[i % CAL_PALETTE.length],
          label: e.attributes?.friendly_name || e.entity_id.replace(/^calendar\./, ""),
        };
      });
    return out;
  }, [liveMode, calendarEntities, mock.calendars]);

  /* Fetch this week's events from HA's REST calendar API. */
  const { events: liveEventsRaw, loading, refresh } = useCalendarEvents(
    liveMode ? calendarIds : [],
    weekStart.toISOString(),
    weekEnd.toISOString(),
  );

  /* Dialog uses mount/unmount: `dialog === null` means closed.
     `{ initial: { date, startTime, endTime } | null }` means open with
     those pre-fills (null = today + next hour defaults). */
  const [dialog, setDialog] = useState(null);
  const dialogCalendars = useMemo(
    () =>
      Object.entries(calendars).map(([entity_id, c]) => ({
        entity_id,
        label: c.label,
      })),
    [calendars],
  );

  /* Click anywhere in a day column → snap to nearest 30-min slot and
     open the new-event dialog pre-filled with that day/time. */
  function onColClick(ev, day) {
    if (!liveMode) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const hourFloat = startHour + y / (slotsPerHour * slotPx);
    const snapped = Math.floor(hourFloat * slotsPerHour) / slotsPerHour; // round down to 30 min
    const start = Math.max(startHour, Math.min(snapped, endHour));
    const end = Math.min(start + 1, 23.5);
    const fmt = (h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + day);
    setDialog({
      initial: { date: ymd(dayDate), startTime: fmt(start), endTime: fmt(end) },
    });
  }

  /* Transform HA events → grid-positioned events the renderer expects. */
  const events = useMemo(() => {
    if (!liveMode) return mock.events;
    const out = [];
    for (const ev of liveEventsRaw) {
      const pos = haEventToGridPos(ev, weekStart);
      if (!pos) continue;
      out.push({
        id: ev.uid || `${ev.cal_entity_id}-${ev.summary}-${ev.start?.dateTime || ev.start?.date}`,
        cal: ev.cal_entity_id,
        day: pos.day,
        start: pos.start,
        end: pos.end,
        allDay: pos.allDay,
        title: ev.summary || "(untitled)",
        where: ev.location || "",
      });
    }
    return out;
  }, [liveMode, liveEventsRaw, weekStart, mock.events]);

  const now = useNow();
  const nowOffset = (now - startHour) * 2 * slotPx;
  const showNow = now >= startHour && now <= endHour;

  function hourLabel(h) {
    const hh = Math.floor(h);
    return `${String(hh).padStart(2, "0")}:00`;
  }

  function eventTimeLabel(start, end, allDay) {
    if (allDay) return "All day";
    const fmt = (h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    return `${fmt(start)}–${fmt(end)}`;
  }

  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const metaText = liveMode
    ? loading && events.length === 0
      ? "loading…"
      : `${events.length} events`
    : `${mock.events.length} events · mock`;

  return (
    <Card
      index={index}
      eyebrow={`Calendar · week of ${weekStartISO}`}
      title="This week"
      meta={metaText}
      headRight={
        liveMode ? (
          <button
            className="add-btn-mini"
            onClick={() => setDialog({ initial: null })}
            aria-label="Add event"
          >
            + Add event
          </button>
        ) : null
      }
    >
      {dialog && (
        <NewEventDialog
          onClose={() => setDialog(null)}
          calendars={dialogCalendars}
          defaultCalendarId={calendarIds[0]}
          initial={dialog.initial}
          onCreated={refresh}
        />
      )}
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

        {/* Dedicated off-grid row sits between the day header and the
            timed grid — holds all-day, before-grid, and after-grid pills
            so they don't render inside the column where they'd read as
            floating in the day-header strip. */}
        <div className="weekcal-offgrid-row">
          <div className="corner" />
          {DOWS.map((_, day) => {
            const dayOffgrid = events.filter(
              (e) => e.day === day && (e.allDay || e.end <= startHour || e.start >= endHour + 1),
            );
            return (
              <div key={day} className={`cell ${day === todayDow ? "today" : ""}`}>
                {dayOffgrid.map((e) => {
                  const calVar = calendars[e.cal]?.color || CAL_PALETTE[0];
                  const tooltip = `${e.title}\n${eventTimeLabel(e.start, e.end, e.allDay)}${e.where ? `\n${e.where}` : ""}`;
                  const prefix = e.allDay ? "⛶" : e.end <= startHour ? "↑" : "↓";
                  const timeBit = e.allDay ? "" : ` ${eventTimeLabel(e.start, e.end)} ·`;
                  return (
                    <div
                      key={e.id}
                      className="weekcal-offgrid"
                      style={{ "--cal-color": calVar }}
                      title={tooltip}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {prefix}{timeBit} {e.title}
                    </div>
                  );
                })}
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
          const dayInGrid = events.filter(
            (e) => e.day === day && !e.allDay && e.end > startHour && e.start < endHour + 1,
          );
          const laidOut = layoutEventsInDay(dayInGrid);
          return (
            <div
              key={day}
              className={`weekcal-col ${day === todayDow ? "today" : ""} ${liveMode ? "clickable" : ""}`}
              style={{
                height: ((endHour - startHour) * slotsPerHour + 1) * slotPx,
              }}
              onClick={(ev) => onColClick(ev, day)}
            >
              {day === todayDow && showNow && <div className="weekcal-now" style={{ top: nowOffset }} />}
              {laidOut.map((e) => {
                const calVar = calendars[e.cal]?.color || CAL_PALETTE[0];
                const tooltip = `${e.title}\n${eventTimeLabel(e.start, e.end, e.allDay)}${e.where ? `\n${e.where}` : ""}`;
                const visibleStart = Math.max(e.start, startHour);
                const visibleEnd = Math.min(e.end, endHour + 1);
                const top = (visibleStart - startHour) * slotsPerHour * slotPx;
                const h = (visibleEnd - visibleStart) * slotsPerHour * slotPx;
                const short = h < 36;
                /* Lane-based horizontal split. Inline left + width override
                   the CSS defaults of left:4px right:4px so overlapping
                   events sit next to each other with a small gutter. */
                const widthPct = 100 / e._totalLanes;
                const leftPct = e._lane * widthPct;
                const positioning = e._totalLanes > 1
                  ? {
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      right: "auto",
                    }
                  : null;
                return (
                  <div
                    key={e.id}
                    className={`weekcal-event ${short ? "short" : ""}`}
                    style={{ top, height: h, "--cal-color": calVar, ...positioning }}
                    title={tooltip}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="t">{e.title}</div>
                    <div className="w">
                      {eventTimeLabel(e.start, e.end, e.allDay)}
                      {e.where ? ` · ${e.where}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {Object.entries(calendars).map(([id, c]) => (
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
   Kanban — adaptive: one column per live todo.* entity (excluding
   todo.shopping_list which the dashboard uses elsewhere). Falls back
   to GH_DATA mock if no real todo entities exist yet.
   ----------------------------------------------------------------*/

const MOCK_KANBAN_COLS = ["todo.backlog", "todo.today", "todo.doing", "todo.done"];

/* Canonical kanban columns. Always rendered, in this order. If an iCloud
   Reminders list with a matching name (case-insensitive) exists, its
   contents fill the column; otherwise the column shows a placeholder
   with instructions to create that list on the iPhone. */
const CANONICAL_KANBAN_COLS = [
  { label: "Backlog", aliases: ["backlog"] },
  { label: "Today", aliases: ["today"] },
  { label: "Doing", aliases: ["doing", "in progress", "in-progress"] },
  { label: "Done", aliases: ["done", "completed"] },
];

function normalizeListName(s) {
  return (s || "").toLowerCase().replace(/\s*⚠️\s*$/, "").trim();
}

function KanbanAddInput({ onSubmit }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  async function commit() {
    const text = value.trim();
    if (!text) {
      setActive(false);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(text);
      setValue("");
      setActive(false);
    } catch (e) {
      console.warn("[kanban-add] failed", e);
    } finally {
      setSubmitting(false);
    }
  }

  if (!active) {
    return (
      <button className="kanban-add" onClick={() => setActive(true)} disabled={submitting}>
        + Add
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      className="kanban-add"
      style={{ textAlign: "left", textTransform: "none", letterSpacing: 0 }}
      type="text"
      value={value}
      placeholder="What needs doing?"
      disabled={submitting}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setValue("");
          setActive(false);
        }
      }}
    />
  );
}

export function KanbanBoardCard({ index = 0 }) {
  /* Discover live todo.* entities, excluding shopping list. */
  const todoEntities = useEntitiesByDomain("todo");
  const liveTodoEntities = useMemo(
    () =>
      todoEntities
        .filter((e) => e.entity_id !== "todo.shopping_list")
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
    [todoEntities],
  );
  const liveTodoIds = useMemo(
    () => liveTodoEntities.map((e) => e.entity_id),
    [liveTodoEntities],
  );
  const liveMode = liveTodoIds.length > 0;

  const { lists: liveLists, add, move, remove } = useTodoLists(liveTodoIds);

  /* Mock fallback — same shape as before. */
  const [mockLists] = useState(() => {
    const out = {};
    for (const id of MOCK_KANBAN_COLS) out[id] = GH_DATA.todo_lists[id].items.slice();
    return out;
  });
  const [mockState, setMockState] = useState(mockLists);

  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  /* Apple seeds new/legacy Reminders lists with two placeholder VTODOs
     that aren't real tasks. Filter them out so they don't pollute the
     kanban — user has no reason to see them. */
  function isAppleSystemItem(it) {
    if (it.description?.includes("support.apple.com/HT210220")) return true;
    if (it.summary === "Where are my reminders?") return true;
    if (it.summary === "The creator of this list has upgraded these reminders.") return true;
    return false;
  }

  /* Unified column shape for the renderer:
       { id, label, items, isPlaceholder?, isExtra? }
     Live mode ALWAYS includes the 4 canonical columns; missing ones
     render as placeholders. Any other iCloud lists the user has show
     up as extra columns after the canonical four. */
  const cols = useMemo(() => {
    if (liveMode) {
      const matchedIds = new Set();
      const out = [];
      for (const canonical of CANONICAL_KANBAN_COLS) {
        const match = liveTodoEntities.find((e) => {
          const name = normalizeListName(e.attributes?.friendly_name || e.entity_id.replace(/^todo\./, ""));
          return canonical.aliases.includes(name);
        });
        if (match) {
          matchedIds.add(match.entity_id);
          out.push({
            id: match.entity_id,
            label: canonical.label,
            items: (liveLists[match.entity_id]?.items || [])
              .filter((it) => !isAppleSystemItem(it))
              .map((it) => ({ uid: it.uid, summary: it.summary, status: it.status })),
          });
        } else {
          out.push({
            id: `placeholder:${canonical.label.toLowerCase()}`,
            label: canonical.label,
            items: [],
            isPlaceholder: true,
          });
        }
      }
      /* Anything the user has that wasn't matched to a canonical (e.g. their
         default "Reminders" list) — keep it visible to the right. */
      for (const e of liveTodoEntities) {
        if (matchedIds.has(e.entity_id)) continue;
        out.push({
          id: e.entity_id,
          label: (e.attributes?.friendly_name || e.entity_id.replace(/^todo\./, "")).replace(/\s*⚠️\s*$/, ""),
          isExtra: true,
          items: (liveLists[e.entity_id]?.items || [])
            .filter((it) => !isAppleSystemItem(it))
            .map((it) => ({ uid: it.uid, summary: it.summary, status: it.status })),
        });
      }
      return out;
    }
    return MOCK_KANBAN_COLS.map((id) => ({
      id,
      label: GH_DATA.todo_lists[id].label,
      items: mockState[id],
    }));
  }, [liveMode, liveTodoEntities, liveLists, mockState]);

  function isDoneCol(col) {
    return /done$/i.test(col.id) || /^done$/i.test(col.label);
  }

  function onDragStart(ev, uid, summary, col) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ uid, summary, col }));
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
  async function onDrop(ev, toCol) {
    ev.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    let payload;
    try {
      payload = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    const { uid, summary, col: fromCol } = payload;
    if (fromCol === toCol) return;
    if (liveMode) {
      try {
        await move(uid, summary, fromCol, toCol);
      } catch (e) {
        console.warn("[kanban] move failed", e);
      }
    } else {
      setMockState((cur) => {
        const next = { ...cur };
        const card = cur[fromCol].find((c) => c.uid === uid);
        next[fromCol] = cur[fromCol].filter((c) => c.uid !== uid);
        if (card) next[toCol] = [card, ...cur[toCol]];
        return next;
      });
    }
  }

  async function onAdd(colId, text) {
    if (liveMode) {
      await add(colId, text);
    } else {
      setMockState((cur) => ({
        ...cur,
        [colId]: [{ uid: `local-${Date.now()}`, summary: text, tag: "dev" }, ...cur[colId]],
      }));
    }
  }

  async function onRemove(colId, uid) {
    if (liveMode) {
      try {
        await remove(colId, uid);
      } catch (e) {
        console.warn("[kanban] remove failed", e);
      }
    } else {
      setMockState((cur) => ({
        ...cur,
        [colId]: cur[colId].filter((c) => c.uid !== uid),
      }));
    }
  }

  const placeholderCount = cols.filter((c) => c.isPlaceholder).length;
  const wiredCanonical = CANONICAL_KANBAN_COLS.length - placeholderCount;
  const eyebrowText = liveMode
    ? placeholderCount > 0
      ? `Kanban · ${wiredCanonical}/${CANONICAL_KANBAN_COLS.length} canonical lists wired · iCloud Reminders`
      : `Kanban · iCloud Reminders`
    : "Kanban · todo.backlog · today · doing · done";
  const metaText = liveMode ? "drag cards between columns" : "drag cards between columns · mock";

  return (
    <Card index={index} eyebrow={eyebrowText} title="Project board" meta={metaText}>
      <div
        className="kanban"
        style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, 1fr)` }}
      >
        {cols.map((col) => {
          const isDone = isDoneCol(col);
          if (col.isPlaceholder) {
            return (
              <div key={col.id} className="kanban-col placeholder">
                <div className="kanban-col-head">
                  <span className="label">{col.label}</span>
                  <span className="count">—</span>
                </div>
                <div className="kanban-placeholder-body">
                  <div className="kanban-placeholder-icon">+</div>
                  <div className="kanban-placeholder-msg">
                    Create a list named <strong>{col.label}</strong> in the iPhone Reminders app to wire this column.
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div
              key={col.id}
              className={`kanban-col ${col.isExtra ? "extra" : ""} ${dragOver === col.id ? "drag-over" : ""}`}
              onDragOver={(ev) => onDragOver(ev, col.id)}
              onDragLeave={() => setDragOver((cur) => (cur === col.id ? null : cur))}
              onDrop={(ev) => onDrop(ev, col.id)}
            >
              <div className="kanban-col-head">
                <span className="label">{col.label}</span>
                <span className="count">{col.items.length}</span>
              </div>
              {col.items.map((c) => (
                <div
                  key={c.uid}
                  className={`kanban-card ${isDone ? "done" : ""} ${draggingId === c.uid ? "dragging" : ""}`}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, c.uid, c.summary, col.id)}
                  onDragEnd={onDragEnd}
                >
                  <button
                    className="kanban-card-x"
                    aria-label="Delete"
                    title="Delete"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onRemove(col.id, c.uid);
                    }}
                  >
                    ×
                  </button>
                  <div className="summary">{c.summary}</div>
                  {(c.tag || c.due) && (
                    <div className="meta">
                      {c.tag && <span className={`tag tag-${c.tag}`}>{c.tag}</span>}
                      {c.due && <span className="due">due · {c.due}</span>}
                    </div>
                  )}
                </div>
              ))}
              <KanbanAddInput onSubmit={(text) => onAdd(col.id, text)} />
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

/* Live-wired StatBox variants for Overview. Each subscribes to its own
   entities so a single tile updating doesn't re-render the others. */

export function BambuStatBox({ index = 0 }) {
  const PREFIX = "x1c_00m09d522400385";
  const liveProg = useEntity(`sensor.${PREFIX}_print_progress`);
  const liveRem = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  const p = GH_DATA.printer;
  const prog = Number(liveProg?.state ?? p[`sensor.${PREFIX}_print_progress`].state);
  const rem = Number(liveRem?.state ?? p[`sensor.${PREFIX}_remaining_time`].state);
  const file = liveProg?.attributes?.file_name || p.file;
  const stage = liveStage?.state ?? p[`sensor.${PREFIX}_current_stage`].state;
  const idle = !rem && (stage === "idle" || stage === "unknown");
  return (
    <StatBox
      index={index}
      eyebrow="Bambu X1C"
      value={idle ? "idle" : prog}
      unit={idle ? null : "%"}
      caption={idle ? stage : `${(file || "").slice(0, 16)} · ${rem}m`}
      pct={idle ? 0 : prog}
      color="var(--accent-2)"
    />
  );
}

export function LevoitStatBox({ index = 0 }) {
  const liveQ = useEntity("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const a = GH_DATA.air;
  const q = liveQ?.state ?? a["sensor.core_300s_series_air_quality"].state;
  const pm = Number(livePm?.state ?? a["sensor.core_300s_series_pm2_5"].state);
  // PM2.5 to a 0-100 "goodness" score: 0µg=100, 35µg=0 (WHO unhealthy).
  const pct = Math.max(0, Math.min(100, Math.round(100 - (pm / 35) * 100)));
  return (
    <StatBox
      index={index}
      eyebrow="Levoit · air"
      value={q}
      caption={`PM 2.5 · ${pm} µg`}
      pct={pct}
      color={pm < 12 ? "var(--good)" : pm < 35 ? "var(--accent-2)" : "var(--bad)"}
    />
  );
}

export function VacuumStatBox({ index = 0 }) {
  const liveBat = useEntity("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  const v = GH_DATA.vacuum;
  const bat = Number(liveBat?.state ?? v["sensor.roborock_s8_battery"].state);
  const status = liveStatus?.state ?? v["sensor.roborock_s8_status"].state;
  return (
    <StatBox
      index={index}
      eyebrow="Gregory · vacuum"
      value={bat}
      unit="%"
      caption={status ? `${status[0].toUpperCase()}${status.slice(1)}` : "Docked"}
      pct={bat}
      color={bat >= 90 ? "var(--good)" : bat >= 30 ? "var(--accent-2)" : "var(--bad)"}
    />
  );
}

export function AdGuardStatBox({ index = 0 }) {
  const liveRatio = useEntity("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  const a = GH_DATA.adguard;
  const ratio = Number(liveRatio?.state ?? a["sensor.adguard_home_dns_queries_blocked_ratio"].state);
  const blocked = Number(liveBlocked?.state ?? a["sensor.adguard_home_dns_queries_blocked"].state);
  const total = Number(liveTotal?.state ?? a["sensor.adguard_home_dns_queries"].state);
  return (
    <StatBox
      index={index}
      eyebrow="AdGuard"
      value={ratio.toFixed(1)}
      unit="%"
      caption={`${blocked.toLocaleString()} / ${total.toLocaleString()}`}
      pct={ratio}
      color="var(--bad)"
    />
  );
}
