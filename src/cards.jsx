/* Glasshouse v2 — atomic card components. */

import { useState, useEffect, useMemo, useRef } from "react";
import { GH_DATA } from "./data.js";
import { nowFractionalHour } from "./theme.js";
import { useEntity, useEntitiesByDomain, useConnectionStatus, useEntityStatus, combineStatuses, useStatistics } from "./ha/useEntity.js";
import { callService, imageUrl, getTodoItems, getForecast } from "./ha/client.js";
import { getAllStates, onStatesChanged } from "./ha/socket.js";
import {
  isSpotifyConfigured, isSpotifyConnected, startSpotifyAuth,
  callbackReady, clearSpotifyToken, getPlaylists,
  getRecentlyPlayed, getDevices, playUri, searchTracks, getQueue,
} from "./ha/spotify.js";
import { useCalendarEvents } from "./ha/useCalendarEvents.js";

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
export function Card({ index = 0, className = "", children, eyebrow, title, meta, badge, headRight, style }) {
  return (
    <section className={`card ${className}`} style={{ ...style, "--i": index }}>
      {(eyebrow || title || meta || headRight || badge) && (
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
            {badge && <span className="card-badge">{badge}</span>}
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
   Entity guard — loading / not-found / unavailable overlays
   ----------------------------------------------------------------*/
export function EntityGuard({ status, entityId, children, style }) {
  if (status === "loading") {
    return <div className="entity-loading" style={style} />;
  }
  if (status === "not_found") {
    return (
      <div className="entity-warning" style={style}>
        <span className="entity-warning-icon">{"⚠️"}</span>
        <span className="entity-warning-text">
          {entityId ? `${entityId} not found` : "Entity not found"}
        </span>
      </div>
    );
  }
  if (status === "unavailable") {
    return (
      <div className="entity-warning" style={style}>
        <span className="entity-warning-icon">{"⚠️"}</span>
        <span className="entity-warning-text">Unavailable</span>
      </div>
    );
  }
  return children;
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

/* ----------------------------------------------------------------
   Presence
   ----------------------------------------------------------------*/
export function PresenceCard({ index = 0 }) {
  const { entity: p, status: pStatus } = useEntityStatus("person.samuel_lawrence");
  const home = p?.state === "home";
  return (
    <Card index={index} eyebrow="Presence · person.samuel_lawrence">
      <EntityGuard status={pStatus} entityId="person.samuel_lawrence">
      <div className="presence-row">
        <div className="presence-avatar">S</div>
        <div className="presence-info">
          <div className="nm">{p?.attributes?.friendly_name || "Samuel"}</div>
          <div className="where">
            {home ? "Home" : p?.state === "not_home" ? "Away" : p?.state}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`presence-badge ${home ? "home" : "away"}`}>
            {home ? "Home" : "Away"}
          </span>
        </div>
      </div>
      </EntityGuard>
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
   Media — Spotify now playing (compact, Overview tab)
   ----------------------------------------------------------------*/
export function MediaCard({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m, status } = useEntityStatus(ENTITY);
  const a = m?.attributes || {};
  const duration = Number(a.media_duration) || 0;
  const playing = m?.state === "playing";
  const paused = m?.state === "paused";
  const idle = !playing && !paused;
  const [isPlaying, setIsPlaying] = useState(playing);
  const [pos, setPos] = useState(Number(a.media_position) || 0);
  const [vol, setVol] = useState(Math.round((a.volume_level || 0) * 100));
  useEffect(() => {
    if (!m) return;
    setIsPlaying(m.state === "playing");
    if (m.attributes?.media_position != null) setPos(Number(m.attributes.media_position));
    if (m.attributes?.volume_level != null) setVol(Math.round(m.attributes.volume_level * 100));
  }, [m?.state, m?.attributes?.media_position, m?.attributes?.volume_level]);
  useEffect(() => {
    if (!isPlaying || !duration) return;
    const id = setInterval(() => setPos((p) => Math.min(p + 1, duration)), 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  const pct = duration > 0 ? (pos / duration) * 100 : 0;

  function playPause() {
    const next = !isPlaying;
    setIsPlaying(next);
    callService("media_player", next ? "media_play" : "media_pause", { entity_id: ENTITY }).catch(() => setIsPlaying(isPlaying));
  }
  function commitVolume(v) {
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 }).catch(() => {});
  }

  const haUrl = import.meta.env.VITE_HA_URL || "";
  const art = a.entity_picture && !idle ? `${haUrl}${a.entity_picture}` : null;
  const dimmed = idle ? 0.4 : 1;

  return (
    <Card index={index} eyebrow="Spotify · Now playing" meta={idle ? "Idle" : isPlaying ? "Playing" : "Paused"}>
      <EntityGuard status={status} entityId={ENTITY}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            backgroundImage: art ? `url(${art})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundColor: "color-mix(in oklch, var(--ink), transparent 88%)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          {!art && "♪"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {idle ? "Nothing playing" : a.media_title}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {idle ? "Spotify Connect" : a.media_artist}
          </div>
        </div>
      </div>

      <div style={{ height: 3, borderRadius: 2, background: "var(--rule)", marginTop: 14, overflow: "hidden", opacity: dimmed }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #1db954, var(--ink))", transition: "width 1s linear" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, opacity: dimmed }}>
        <button className="btn icon" onClick={playPause} style={{ width: 32, height: 32 }}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <input
          type="range" min="0" max="100" value={vol}
          onChange={(e) => setVol(Number(e.target.value))}
          onPointerUp={(e) => commitVolume(Number(e.target.value))}
          className="gh-slider"
          style={{ flex: 1, accentColor: "#1db954" }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", minWidth: 28, textAlign: "right" }}>
          {vol}%
        </span>
      </div>
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Printer — Bambu X1C
   ----------------------------------------------------------------*/
function PrinterPreview({ progress = 0, color = "#d97757" }) {
  const H = 220, W = 240;
  const layers = 36;
  const printedLayers = Math.floor((progress / 100) * layers);
  const baseY = H - 24;
  const profile = (i) => {
    const t = i / layers;
    const r = 48 + Math.sin(t * Math.PI * 1.2) * 12 - t * 14;
    return Math.max(22, r);
  };
  const stripes = [];
  for (let i = 0; i < layers; i++) {
    const y = baseY - (i + 0.5) * ((H - 60) / layers);
    const r = profile(i);
    stripes.push({ y, r, printed: i < printedLayers, i });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="pp-svg">
      <defs>
        <linearGradient id="pp-plate" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
        <radialGradient id="pp-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <ellipse cx={W / 2} cy={baseY + 4} rx="84" ry="14" fill="url(#pp-floor)" />
      <rect x={W / 2 - 78} y={baseY} width="156" height="6" rx="2" fill="url(#pp-plate)" />
      <line x1={W / 2 - 78} y1={baseY + 6} x2={W / 2 + 78} y2={baseY + 6} stroke="rgba(255,255,255,0.22)" strokeWidth="0.6" />
      <g>
        {stripes.filter(s => s.printed).map((s) => (
          <ellipse key={s.i} cx={W / 2} cy={s.y} rx={s.r} ry="3.2"
            fill={color} opacity={0.92 - (s.i / layers) * 0.05} />
        ))}
        {printedLayers > 0 && (() => {
          const top = stripes[printedLayers - 1];
          return (
            <>
              <ellipse cx={W / 2} cy={top.y - 1} rx={top.r} ry="2" fill="rgba(255,255,255,0.35)" />
              <g>
                <line x1={W / 2} x2={W / 2} y1={top.y - 36} y2={top.y - 6}
                  stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
                <polygon points={`${W / 2 - 5},${top.y - 6} ${W / 2 + 5},${top.y - 6} ${W / 2},${top.y + 2}`}
                  fill="rgba(255,255,255,0.85)" />
              </g>
            </>
          );
        })()}
      </g>
      <g opacity="0.18">
        {stripes.filter(s => !s.printed).map((s) => (
          <ellipse key={`g${s.i}`} cx={W / 2} cy={s.y} rx={s.r} ry="2.2"
            fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.5" strokeDasharray="1 2" />
        ))}
      </g>
    </svg>
  );
}

export function PrinterCard({ index = 0 }) {
  const PREFIX = "x1c_00m09d522400385";
  const { entity: liveProg, status } = useEntityStatus(`sensor.${PREFIX}_print_progress`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  const liveRemaining = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveNozzle = useEntity(`sensor.${PREFIX}_nozzle_temperature`);
  const liveNozzleTarget = useEntity(`sensor.${PREFIX}_nozzle_target_temperature`);
  const liveBed = useEntity(`sensor.${PREFIX}_bed_temperature`);
  const liveBedTarget = useEntity(`sensor.${PREFIX}_bed_target_temperature`);
  const liveChamber = useEntity(`sensor.${PREFIX}_chamber_temperature`);
  const liveAms = useEntity(`sensor.${PREFIX}_ams_1_humidity`);
  const liveTray = useEntity(`sensor.${PREFIX}_active_tray`);
  const liveLight = useEntity(`light.${PREFIX}_chamber_light`);
  const liveImage = useEntity(`image.${PREFIX}_cover_image`);
  const liveLayer = useEntity(`sensor.${PREFIX}_current_layer`);
  const liveTotalLayers = useEntity(`sensor.${PREFIX}_total_layer_count`);
  const liveSpeed = useEntity(`sensor.${PREFIX}_speed_profile`);
  const liveAuxFan = useEntity(`sensor.${PREFIX}_aux_fan_speed`);
  const liveChamberFan = useEntity(`sensor.${PREFIX}_chamber_fan_speed`);
  const liveCoolingFan = useEntity(`sensor.${PREFIX}_cooling_fan_speed`);
  const liveStart = useEntity(`sensor.${PREFIX}_start_time`);
  const liveEnd = useEntity(`sensor.${PREFIX}_end_time`);
  const livePrintStatus = useEntity(`sensor.${PREFIX}_print_status`);
  const liveDoor = useEntity(`binary_sensor.${PREFIX}_door`);
  const liveHmsErrors = useEntity(`binary_sensor.${PREFIX}_hms_errors`);
  const livePrintError = useEntity(`binary_sensor.${PREFIX}_print_error`);
  const liveCamera = useEntity(`switch.${PREFIX}_camera`);
  const liveOnline = useEntity(`binary_sensor.${PREFIX}_online`);
  const liveTray1 = useEntity(`sensor.${PREFIX}_ams_1_tray_1`);
  const liveTray2 = useEntity(`sensor.${PREFIX}_ams_1_tray_2`);
  const liveTray3 = useEntity(`sensor.${PREFIX}_ams_1_tray_3`);
  const liveTray4 = useEntity(`sensor.${PREFIX}_ams_1_tray_4`);
  const liveWeight = useEntity(`sensor.${PREFIX}_print_weight`);
  const liveLength = useEntity(`sensor.${PREFIX}_print_length`);

  const prog = Number(liveProg?.state ?? 0);
  const stage = liveStage?.state ?? "—";
  const remaining = Number(liveRemaining?.state ?? 0);
  const nozzle = Number(liveNozzle?.state ?? 0);
  const nozzleTarget = Number(liveNozzleTarget?.state ?? 0);
  const bed = Number(liveBed?.state ?? 0);
  const bedTarget = Number(liveBedTarget?.state ?? 0);
  const chamber = Number(liveChamber?.state ?? 0);
  const ams = Number(liveAms?.state ?? 0);
  const tray = liveTray?.state ?? "—";
  const fileName = liveProg?.attributes?.file_name || "—";
  const curLayer = liveLayer?.state ?? "—";
  const totalLayers = liveTotalLayers?.state ?? "—";
  const speedProfile = liveSpeed?.state ?? "—";
  const auxFan = liveAuxFan?.state ?? "—";
  const chamberFan = liveChamberFan?.state ?? "—";
  const coolingFan = liveCoolingFan?.state ?? "—";
  const startTime = liveStart?.state;
  const endTime = liveEnd?.state;
  const printStatus = livePrintStatus?.state ?? "unknown";
  const doorOpen = liveDoor?.state === "on";
  const hasHmsError = liveHmsErrors?.state === "on";
  const hasPrintError = livePrintError?.state === "on";
  const online = liveOnline?.state === "on";
  const cameraOn = liveCamera?.state === "on";
  const printWeight = liveWeight?.state;
  const printLength = liveLength?.state;
  const printing = printStatus === "running" || (remaining > 0 && stage !== "idle");
  const amsTrayNames = [liveTray1, liveTray2, liveTray3, liveTray4].map(
    (t) => t?.state && t.state !== "unknown" && t.state !== "Empty" ? t.state : null
  );

  const [light, setLight] = useState(liveLight?.state === "on");
  useEffect(() => { if (liveLight) setLight(liveLight.state === "on"); }, [liveLight?.state]);
  function toggleLight() {
    const next = !light;
    setLight(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: `light.${PREFIX}_chamber_light` }).catch(() => setLight(light));
  }
  function toggleCamera() {
    callService("switch", cameraOn ? "turn_off" : "turn_on", { entity_id: `switch.${PREFIX}_camera` }).catch(() => {});
  }
  const coverSrc = liveImage ? imageUrl(`image.${PREFIX}_cover_image`, liveImage.last_updated) : null;

  const fmtIsoTime = (iso) => {
    if (!iso || iso === "unknown") return "—";
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
  };

  const formatRemaining = (m) => {
    if (!m && m !== 0) return "—";
    if (m < 60) return `${Math.round(m)}m`;
    const h = Math.floor(m / 60), mm = Math.round(m % 60);
    return mm ? `${h}h ${mm}m` : `${h}h`;
  };

  const trayColors = ["#d97757", "#4a9eff", "#6ecf6e", "#f5d442"];
  const activeTrayIdx = amsTrayNames.findIndex(n => n && n === tray);

  return (
    <Card
      index={index}
      className="ws-printer"
      eyebrow="3D Printer · Bambu X1C"
      title={printing ? "Printing" : printStatus === "unknown" ? "Idle" : printStatus.charAt(0).toUpperCase() + printStatus.slice(1)}
      meta={`Stage · ${stage}`}
      headRight={
        <span className={`ws-status-pill ${printing ? "live" : online ? "ok" : ""}`}>
          <span className="dot" style={!printing && online ? { background: "var(--good)" } : !online ? { background: "var(--ink-4)" } : undefined} />
          {printing ? "live" : online ? "online" : "offline"}
        </span>
      }
    >
      <EntityGuard status={status} entityId={`sensor.${PREFIX}_print_progress`}>
      {(hasHmsError || hasPrintError) && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          {hasHmsError && "HMS ERROR"}
          {hasHmsError && hasPrintError && " · "}
          {hasPrintError && "PRINT ERROR"}
        </div>
      )}
      <div className="ws-printer-grid">
        {/* LEFT: live preview tile */}
        <div className="ws-printer-tile" style={coverSrc ? {
          backgroundImage: `url(${coverSrc})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        } : undefined}>
          {!coverSrc && <PrinterPreview progress={prog} color={activeTrayIdx >= 0 ? trayColors[activeTrayIdx] : "#d97757"} />}
          <div className="ws-tile-overlay">
            <span className="ws-tile-live">
              <span className="dot" /> {coverSrc ? "LIVE · cover" : "cover_image"}
            </span>
            <span className="ws-tile-layer">
              Layer <b>{String(curLayer).padStart(3, "0")}</b> / {totalLayers}
            </span>
          </div>
          <div className="ws-tile-toggles">
            <button className={`ws-tog ${cameraOn ? "on" : ""}`} onClick={toggleCamera}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1" y="4" width="10" height="8" rx="1.5" />
                <path d="M11 7l4-2v6l-4-2z" />
              </svg>
              Cam
            </button>
            <button className={`ws-tog ${light ? "on" : ""}`} onClick={toggleLight}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M5 7a3 3 0 1 1 6 0c0 1.5-1.2 2.2-1.2 3.5H6.2C6.2 9.2 5 8.5 5 7z" />
                <path d="M6.5 13h3M7 14.5h2" strokeLinecap="round" />
              </svg>
              Light
            </button>
          </div>
        </div>

        {/* RIGHT: file + progress + temps */}
        <div className="ws-printer-info">
          <div className="ws-file">
            <div className="ws-file-name" title={fileName}>{fileName}</div>
            <div className="ws-file-sub">
              {startTime && startTime !== "unknown" ? `Started ${fmtIsoTime(startTime)}` : "—"}
              {endTime && endTime !== "unknown" && <> · ETA <b>{fmtIsoTime(endTime)}</b></>}
              {doorOpen && <span style={{ color: "var(--accent-2)", marginLeft: 6 }}>· door open</span>}
            </div>
          </div>

          <div className="ws-progress-block">
            <div className="ws-progress-readout">
              <span className="big">{prog}<span className="u">%</span></span>
              <span className="rem">{formatRemaining(remaining)} <span className="muted">remaining</span></span>
            </div>
            <div className="ws-progress-track">
              <span style={{ "--p": `${prog}%` }} />
              <em style={{ left: `${prog}%` }} />
            </div>
            {printing && (
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                <span>Speed · <b style={{ color: "var(--ink-2)" }}>{speedProfile}</b></span>
                {printWeight && printWeight !== "unknown" && <span>Weight · <b style={{ color: "var(--ink-2)" }}>{printWeight}g</b></span>}
              </div>
            )}
          </div>

          <div className="ws-therm-grid">
            <div className="ws-therm">
              <span className="k">Nozzle</span>
              <span className="v">{nozzle}<i>°</i></span>
              <span className="tgt">{nozzleTarget > 0 ? `→ ${nozzleTarget}°` : "idle"}</span>
            </div>
            <div className="ws-therm">
              <span className="k">Bed</span>
              <span className="v">{bed}<i>°</i></span>
              <span className="tgt">{bedTarget > 0 ? `→ ${bedTarget}°` : "idle"}</span>
            </div>
            <div className="ws-therm">
              <span className="k">Chamber</span>
              <span className="v">{chamber}<i>°</i></span>
              <span className="tgt">passive</span>
            </div>
            <div className="ws-therm">
              <span className="k">AMS RH</span>
              <span className="v">{ams}<i>%</i></span>
              <span className="tgt">{ams < 50 ? "ok < 50%" : "high"}</span>
            </div>
          </div>

          {printing && (
            <div className="ws-therm-grid" style={{ paddingTop: 0, borderTop: "none" }}>
              <div className="ws-therm">
                <span className="k">Part fan</span>
                <span className="v">{coolingFan}<i>%</i></span>
              </div>
              <div className="ws-therm">
                <span className="k">Aux fan</span>
                <span className="v">{auxFan}<i>%</i></span>
              </div>
              <div className="ws-therm">
                <span className="k">Cham. fan</span>
                <span className="v">{chamberFan}<i>%</i></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AMS tray strip */}
      {amsTrayNames.some(Boolean) && (
        <div className="ws-ams">
          <div className="ws-ams-head">
            <span className="lbl">AMS · {amsTrayNames.filter(Boolean).length} trays loaded</span>
            <span className="hint">active · {tray}</span>
          </div>
          <div className="ws-ams-trays">
            {amsTrayNames.map((name, i) => (
              <button key={i} className={`ws-ams-tray ${name && name === tray ? "active" : ""}`}>
                <span className="swatch" style={{ background: name ? trayColors[i] : "var(--ink-4)" }}>
                  {name && name === tray && <span className="active-mark" />}
                </span>
                <span className="ws-ams-meta">
                  <span className="slot">Tray {i + 1}</span>
                  <span className="mat">{name || "Empty"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Vacuum — Roborock S8 "Gregory"
   ----------------------------------------------------------------*/
function FloorPlan({ cleaning }) {
  const W = 320, H = 220;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="fp-svg">
      <defs>
        <pattern id="fp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--rule)" strokeWidth="0.4" />
        </pattern>
        <linearGradient id="fp-floor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--accent-2), transparent 92%)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--accent), transparent 92%)" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" fill="url(#fp-grid)" />
      <g className="fp-rooms">
        <g>
          <rect x="14" y="86" width="160" height="124" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="22" y="104" className="rm">LIVING</text>
          <text x="22" y="118" className="rm-sub">24 m²</text>
        </g>
        <g>
          <rect x="180" y="86" width="126" height="78" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="188" y="104" className="rm">KITCHEN</text>
          <text x="188" y="118" className="rm-sub">11 m²</text>
        </g>
        <g>
          <rect x="180" y="170" width="58" height="40" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="188" y="186" className="rm">BATH</text>
        </g>
        <g>
          <rect x="244" y="170" width="62" height="40" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="252" y="186" className="rm">BED</text>
        </g>
        <g>
          <rect x="14" y="14" width="292" height="60" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" opacity="0.85" />
          <text x="22" y="32" className="rm">HALL · OFFICE</text>
          <text x="22" y="46" className="rm-sub">7 m²</text>
        </g>
      </g>
      <g className="fp-path">
        <path
          d="M 34 196 Q 60 170 100 188 T 160 178 Q 168 152 130 140 T 60 130 Q 38 118 60 100 T 130 100 Q 160 96 188 110 T 254 124 Q 290 132 280 152"
          fill="none"
          stroke={cleaning ? "var(--accent)" : "var(--ink-3)"}
          strokeWidth={cleaning ? "1.6" : "1.2"}
          strokeDasharray={cleaning ? "0" : "2 3"}
          opacity={cleaning ? 0.85 : 0.45}
          strokeLinecap="round"
        />
      </g>
      <g className="fp-dock">
        <rect x="20" y="192" width="20" height="14" rx="3" fill="var(--good)" opacity="0.18" stroke="var(--good)" strokeWidth="0.8" />
        <circle cx="30" cy="199" r="3" fill="var(--good)" />
        <text x="46" y="203" className="dock-lbl">DOCK</text>
      </g>
      {cleaning && (
        <g>
          <circle cx="160" cy="178" r="6" fill="var(--accent)" opacity="0.22">
            <animate attributeName="r" values="6;10;6" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="160" cy="178" r="3.5" fill="var(--accent)" stroke="var(--glass-bg)" strokeWidth="1.2" />
        </g>
      )}
    </svg>
  );
}

export function VacuumCard({ index = 0 }) {
  const { entity: liveVac, status: vacStatus } = useEntityStatus("vacuum.roborock_s8");
  const liveBat = useEntity("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  const liveLast = useEntity("sensor.roborock_s8_last_clean_end");
  const liveMap = useEntity("select.roborock_s8_selected_map");
  const liveMopIntensity = useEntity("select.roborock_s8_mop_intensity");
  const liveMopMode = useEntity("select.roborock_s8_mop_mode");
  const liveRoom = useEntity("sensor.roborock_s8_current_room");
  const liveArea = useEntity("sensor.roborock_s8_cleaning_area");
  const liveTime = useEntity("sensor.roborock_s8_cleaning_time");
  const liveProgress = useEntity("sensor.roborock_s8_cleaning_progress");
  const liveDnd = useEntity("switch.roborock_s8_do_not_disturb");
  const liveCharging = useEntity("binary_sensor.roborock_s8_charging");
  const liveMopAttached = useEntity("binary_sensor.roborock_s8_mop_attached");
  const liveWaterShortage = useEntity("binary_sensor.roborock_s8_water_shortage");
  const liveMainBrush = useEntity("sensor.roborock_s8_main_brush_time_left");
  const liveSideBrush = useEntity("sensor.roborock_s8_side_brush_time_left");
  const liveFilter = useEntity("sensor.roborock_s8_filter_time_left");
  const liveMapImage = useEntity("image.roborock_s8_map_0");
  const liveError = useEntity("sensor.roborock_s8_vacuum_error");

  const battery = Number(liveBat?.state ?? 0);
  const vStatus = liveStatus?.state ?? "—";
  const last = formatRelativeIso(liveLast?.state) || "—";
  const mapOptions = liveMap?.attributes?.options || [];
  const currentMap = liveMap?.state;
  const mopIntensityOptions = liveMopIntensity?.attributes?.options || [];
  const currentMopIntensity = liveMopIntensity?.state;
  const mopModeOptions = liveMopMode?.attributes?.options || [];
  const currentMopMode = liveMopMode?.state;
  const currentRoom = liveRoom?.state;
  const cleanArea = liveArea?.state;
  const cleanTime = liveTime?.state;
  const cleanProgress = Number(liveProgress?.state ?? 0);
  const dndOn = liveDnd?.state === "on";
  const charging = liveCharging?.state === "on";
  const mopAttached = liveMopAttached?.state === "on";
  const waterShortage = liveWaterShortage?.state === "on";
  const mainBrushRaw = Number(liveMainBrush?.state ?? 0);
  const sideBrushRaw = Number(liveSideBrush?.state ?? 0);
  const filterRaw = Number(liveFilter?.state ?? 0);
  const consumableUnit = liveMainBrush?.attributes?.unit_of_measurement || "";
  const toHours = (v) => consumableUnit === "s" || v > 10000 ? Math.round(v / 3600) : v;
  const mainBrushLeft = toHours(mainBrushRaw);
  const sideBrushLeft = toHours(sideBrushRaw);
  const filterLeft = toHours(filterRaw);
  const maxBrush = 300;
  const brushPct = (v) => Math.max(0, Math.min(100, (v / maxBrush) * 100));
  const brushColor = (v) => brushPct(v) > 50 ? "var(--good)" : brushPct(v) > 20 ? "var(--warn)" : "var(--bad)";
  const vacError = liveError?.state;
  const hasError = vacError && vacError !== "none" && vacError !== "0" && vacError !== "unknown";
  const mapImgSrc = liveMapImage ? imageUrl("image.roborock_s8_map_0", liveMapImage.last_updated) : null;
  const [mapBroken, setMapBroken] = useState(false);
  useEffect(() => { setMapBroken(false); }, [mapImgSrc]);

  const [state, setState] = useState(liveVac?.state ?? "docked");
  const unavailable = liveVac?.state === "unavailable";
  useEffect(() => {
    if (liveVac?.state) setState(liveVac.state);
  }, [liveVac?.state]);
  const cleaning = state === "cleaning";
  const paused = state === "paused";

  function start() {
    setState("cleaning");
    callService("vacuum", "start", { entity_id: "vacuum.roborock_s8" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function pause() {
    setState("paused");
    callService("vacuum", "pause", { entity_id: "vacuum.roborock_s8" }).catch(() => setState(liveVac?.state || "cleaning"));
  }
  function dock() {
    setState("returning");
    callService("vacuum", "return_to_base", { entity_id: "vacuum.roborock_s8" }).catch(() => setState("cleaning"));
  }
  function fullClean() {
    setState("cleaning");
    callService("button", "press", { entity_id: "button.roborock_s8_full_cleaning" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function locate() {
    callService("vacuum", "locate", { entity_id: "vacuum.roborock_s8" }).catch(() => {});
  }
  function pickMap(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_selected_map", option: opt }).catch(() => {});
  }
  function pickMopIntensity(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_mop_intensity", option: opt }).catch(() => {});
  }
  function pickMopMode(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_mop_mode", option: opt }).catch(() => {});
  }
  function toggleDnd() {
    callService("switch", dndOn ? "turn_off" : "turn_on", { entity_id: "switch.roborock_s8_do_not_disturb" }).catch(() => {});
  }

  const charge = cleaning ? "var(--accent)" : "var(--good)";
  const chargeLabel = cleaning
    ? `cleaning · ${battery}%`
    : charging
    ? `charging · ${battery}%`
    : `${vStatus} · ${battery}%`;

  return (
    <Card
      index={index}
      className="ws-vacuum"
      eyebrow="Vacuum · roborock_s8"
      title="Gregory"
      meta={`Last clean · ${last}`}
      headRight={
        <span className={`ws-status-pill ${cleaning ? "live" : "ok"}`}>
          <span className="dot" style={{ background: charge }} /> {chargeLabel}
        </span>
      }
    >
      <EntityGuard status={vacStatus} entityId="vacuum.roborock_s8">
      {hasError && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          Error · {vacError}
        </div>
      )}
      {waterShortage && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          Water shortage
        </div>
      )}

      {/* Floor plan / live map */}
      <div className="ws-floorplan">
        {mapImgSrc && !mapBroken ? (
          <img src={mapImgSrc} alt="Vacuum map" onError={() => setMapBroken(true)} style={{ width: "100%", height: "auto", borderRadius: 8, opacity: 0.9 }} />
        ) : (
          <FloorPlan cleaning={cleaning} />
        )}
      </div>

      {/* Stats + actions */}
      <div className="ws-vac-actions">
        <div className="ws-vac-stat">
          <span className="k">Battery</span>
          <span className="v" style={{ color: battery >= 90 ? "var(--good)" : "var(--ink)" }}>
            {battery}<i>%</i>
          </span>
        </div>
        <div className="ws-vac-stat">
          <span className="k">Status</span>
          <span className="v small">{cleaning ? "ACTIVE" : paused ? "PAUSED" : (vStatus || "—").toUpperCase()}</span>
        </div>
        <div className="ws-vac-actbtns">
          {cleaning ? (
            <>
              <button className="btn primary" onClick={pause} disabled={unavailable}>Pause</button>
              <button className="btn" onClick={dock} disabled={unavailable}>Return</button>
            </>
          ) : paused ? (
            <>
              <button className="btn accent" onClick={start} disabled={unavailable}>Resume</button>
              <button className="btn" onClick={dock} disabled={unavailable}>Dock</button>
            </>
          ) : (
            <>
              <button className="btn accent" onClick={start} disabled={unavailable}>Start</button>
              <button className="btn" onClick={fullClean} disabled={unavailable}>Full</button>
            </>
          )}
          <button className="btn ghost" onClick={locate} disabled={unavailable} title="Beep so I can find it">Locate</button>
        </div>
      </div>

      {(cleaning || paused) && (
        <div className="ws-therm-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="ws-therm">
            <span className="k">Progress</span>
            <span className="v">{cleanProgress}<i>%</i></span>
          </div>
          <div className="ws-therm">
            <span className="k">Area</span>
            <span className="v">{cleanArea ?? "—"}<i>m²</i></span>
          </div>
          <div className="ws-therm">
            <span className="k">Time</span>
            <span className="v">{cleanTime ?? "—"}<i>min</i></span>
          </div>
        </div>
      )}

      {/* Mop intensity + mode + map controls */}
      <div className="ws-vac-controls">
        {mopIntensityOptions.length > 0 && (
          <div className="ws-control-row">
            <span className="k">Mop intensity</span>
            <div className="seg">
              {mopIntensityOptions.map((p) => (
                <button key={p} className={currentMopIntensity === p ? "on" : ""} onClick={() => pickMopIntensity(p)} disabled={unavailable}>{p}</button>
              ))}
            </div>
          </div>
        )}
        {mopModeOptions.length > 0 && (
          <div className="ws-control-row">
            <span className="k">Mop mode</span>
            <div className="seg">
              {mopModeOptions.map((p) => (
                <button key={p} className={currentMopMode === p ? "on" : ""} onClick={() => pickMopMode(p)} disabled={unavailable}>{p}</button>
              ))}
            </div>
          </div>
        )}
        <div className="ws-control-row">
          {mapOptions.length > 0 && (
            <>
              <span className="k">Map</span>
              <div className="seg compact">
                {mapOptions.map((opt) => (
                  <button key={opt} className={currentMap === opt ? "on" : ""} onClick={() => pickMap(opt)} disabled={unavailable}>{opt}</button>
                ))}
              </div>
            </>
          )}
          <span className="ws-flag" title="Do not disturb">
            <span className={`mini-tog ${dndOn ? "on" : ""}`} onClick={toggleDnd} />
            DND
          </span>
          {mopAttached && (
            <span className="ws-flag ok">
              <span className="dot" /> Mop attached
            </span>
          )}
        </div>
      </div>

      {/* Brushes / filter wear */}
      <div className="ws-wear">
        {[
          { lbl: "Main brush", v: mainBrushLeft },
          { lbl: "Side brush", v: sideBrushLeft },
          { lbl: "Filter", v: filterLeft },
        ].map(({ lbl, v }) => (
          <div className="ws-wear-row" key={lbl}>
            <span className="lbl">{lbl}</span>
            <span className="bar">
              <span style={{ "--p": `${brushPct(v)}%`, "--c": brushColor(v) }} />
            </span>
            <span className="val">
              {v}<i>h left</i>
            </span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Air purifier — Levoit Core 300S
   ----------------------------------------------------------------*/
const SPEED_TO_PCT = { low: 33, medium: 67, high: 100 };
const PCT_TO_SPEED = (pct) => pct <= 33 ? "low" : pct <= 67 ? "medium" : "high";

export function AirPurifierCard({ index = 0 }) {
  const { entity: liveFan, status: fanStatus } = useEntityStatus("fan.core_300s_series");
  const liveQ = useEntity("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  const liveFilt = useEntity("sensor.core_300s_series_filter_lifetime");
  const unavailable = liveFan?.state === "unavailable" || liveFan?.state === "unknown";
  const q = liveQ?.state ?? "—";
  const pm = Number(livePm?.state ?? 0);
  const filt = Number(liveFilt?.state ?? 0);
  const [mode, setMode] = useState(liveFan?.attributes?.preset_mode ?? "auto");
  const [on, setOn] = useState(liveFan?.state === "on");
  useEffect(() => {
    if (!liveFan) return;
    setOn(liveFan.state === "on");
    const attrs = liveFan.attributes;
    if (attrs?.preset_mode) setMode(attrs.preset_mode);
    else if (attrs?.percentage) setMode(PCT_TO_SPEED(attrs.percentage));
  }, [liveFan?.state, liveFan?.attributes?.preset_mode, liveFan?.attributes?.percentage]);
  function toggleFan() {
    if (unavailable) return;
    const next = !on;
    setOn(next);
    callService("fan", next ? "turn_on" : "turn_off", { entity_id: "fan.core_300s_series" }).catch(() => setOn(on));
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

/* ----------------------------------------------------------------
   Heater — Govee
   ----------------------------------------------------------------*/
export function HeaterCard({ index = 0 }) {
  const { entity: liveTarget, status: heaterStatus } = useEntityStatus("input_number.govee_heater_temperature");
  const roomTempEntity = useEntity("sensor.h5075_4fb6_temperature");
  const roomHumidity = useEntity("sensor.h5075_4fb6_humidity");

  const roomTempRaw = roomTempEntity?.state;
  const humRaw = roomHumidity?.state;
  const roomTempValid = roomTempRaw && roomTempRaw !== "unavailable" && roomTempRaw !== "unknown";
  const roomTemp = roomTempValid ? Number(roomTempRaw) : null;
  const humidity = humRaw && humRaw !== "unavailable" && humRaw !== "unknown" ? Number(humRaw) : null;

  const [target, setTarget] = useState(Number(liveTarget?.state ?? 20));
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (liveTarget) setTarget(Number(liveTarget.state));
  }, [liveTarget?.state]);

  function commitTemp(v) {
    setTarget(v);
    callService("input_number", "set_value", { entity_id: "input_number.govee_heater_temperature", value: v }).catch(() => {});
  }
  function toggleHeater() {
    const next = !on;
    setOn(next);
    callService("script", next ? "turn_on_govee_heater" : "turn_off_govee_heater", {}).catch(() => setOn(on));
  }
  const angle = Math.max(0, Math.min(270, ((target - 12) / 18) * 270));

  return (
    <Card
      index={index}
      eyebrow="Climate · Govee heater"
      title="Heater"
      meta={on ? `On · target ${target}°` : `Off · target ${target}°`}
    >
      <EntityGuard status={heaterStatus} entityId="input_number.govee_heater_temperature">
      <div className="heater-body">
        <div className="heater-controls-col">
          <div className="eyebrow" style={{ fontSize: 9 }}>Setpoint</div>
          <div className="heater-stepper">
            <button className="heater-step" onClick={() => commitTemp(Math.max(12, target - 1))}>−</button>
            <div className="heater-target-val">
              {target}<span className="u">°</span>
            </div>
            <button className="heater-step" onClick={() => commitTemp(Math.min(30, target + 1))}>+</button>
          </div>
          <div className="meta" style={{ marginTop: 8 }}>
            {roomTemp != null ? `Room is ${roomTemp}° · ${humidity ?? "—"}% humidity` : "Room sensor offline"}
          </div>
          <button
            className={`btn ${on ? "accent" : "primary"}`}
            onClick={toggleHeater}
            style={{ marginTop: 14, alignSelf: "flex-start" }}
          >
            {on ? "Turn off" : "Turn on"}
          </button>
        </div>
        <div className="heater-dial" style={{ "--ang": `${angle}deg` }}>
          <div className="heater-dial-inner">
            <div>
              <div className="set">Target</div>
              <div className="val">{target}°</div>
              <div className="act">{on ? "Heating" : "Unplugged"}</div>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   AdGuard — full card (with ring + filtering toggle)
   ----------------------------------------------------------------*/
export function AdGuardCard({ index = 0 }) {
  const { entity: liveRatio, status: adgStatus } = useEntityStatus("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveProt = useEntity("switch.adguard_home_protection");
  const liveFilt = useEntity("switch.adguard_home_filtering");
  const ratio = Number(liveRatio?.state ?? 0);
  const total = Number(liveTotal?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const [prot, setProt] = useState(liveProt?.state === "on");
  const [filt, setFilt] = useState(liveFilt?.state === "on");
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  useEffect(() => { if (liveFilt) setFilt(liveFilt.state === "on"); }, [liveFilt?.state]);

  const C = 2 * Math.PI * 90;
  const offset = C * (1 - ratio / 100);

  return (
    <Card
      index={index}
      eyebrow="Network · AdGuard Home"
      title="Filtering"
      meta={prot ? "Protected" : "Disabled"}
      headRight={<div className={`toggle ${prot ? "on" : ""}`} onClick={() => {
        const next = !prot; setProt(next);
        callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
      }} role="switch" />}
    >
      <EntityGuard status={adgStatus} entityId="sensor.adguard_home_dns_queries_blocked_ratio">
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
                  onClick={() => {
                    const next = !filt; setFilt(next);
                    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_filtering" }).catch(() => setFilt(filt));
                  }}
                  role="switch"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}

export function BlockedDomainsCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Top blocked domains · 24h" title="Loudest offenders">
      <div className="entity-warning">
        <span className="entity-warning-icon">{"⚠️"}</span>
        <span className="entity-warning-text">Needs AdGuard Home API integration</span>
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
  const { entity: liveCpu, status: piStatus } = useEntityStatus("sensor.system_monitor_processor_use");
  const liveMem = useEntity("sensor.system_monitor_memory_use");
  const liveTemp = useEntity("sensor.system_monitor_processor_temperature");
  const liveDisk = useEntity("sensor.system_monitor_disk_use_config");
  const cpu = Number(liveCpu?.state ?? 0);
  const memMiB = Number(liveMem?.state ?? 0);
  const memPct = (memMiB / PI_RAM_MIB) * 100;
  const temp = Number(liveTemp?.state ?? 0);
  const diskGiB = Number(liveDisk?.state ?? 0);
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
      <EntityGuard status={piStatus} entityId="sensor.system_monitor_processor_use">
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
      </EntityGuard>
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
  const { entity: liveLast, status: backupStatus } = useEntityStatus("sensor.backup_last_successful_automatic_backup");
  const liveNext = useEntity("sensor.backup_next_scheduled_automatic_backup");
  const liveState = useEntity("sensor.backup_backup_manager_state");
  const liveSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const lastDisplay = formatRelativeIso(liveLast?.state);
  const nextDisplay = formatRelativeIso(liveNext?.state);
  const managerState = liveState?.state || "idle";
  const sizeDisplay = liveSize ? formatMiB(liveSize.state) : "—";
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
      <EntityGuard status={backupStatus} entityId="sensor.backup_last_successful_automatic_backup">
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
      </EntityGuard>
    </Card>
  );
}

export function StorageCard({ index = 0 }) {
  const { entity: diskUsed, status: diskStatus } = useEntityStatus("sensor.system_monitor_disk_use");
  const configUsed = useEntity("sensor.system_monitor_disk_use_config");
  const backupSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const totalGiB = PI_DISK_GIB;
  const usedGiB = Number(diskUsed?.state ?? 0);
  const freeGiB = totalGiB - usedGiB;
  const configGiB = Number(configUsed?.state ?? 0);
  const backupGiB = Number(backupSize?.state ?? 0) / 1024;
  const systemGiB = Math.max(0, usedGiB - configGiB);

  const segments = [
    { label: "System", value: systemGiB, color: "var(--accent)" },
    { label: "Config", value: configGiB, color: "var(--accent-2)" },
    { label: "Backups", value: backupGiB, color: "var(--ink-2)" },
    { label: "Free", value: freeGiB, color: "var(--glass-stroke)" },
  ];

  return (
    <Card index={index} eyebrow={`Storage · ${usedGiB.toFixed(1)} / ${totalGiB} GiB used`} title="Disk breakdown">
      <EntityGuard status={diskStatus} entityId="sensor.system_monitor_disk_use">
      <div className="storage-bar">
        {segments.map((s) => (
          <span
            key={s.label}
            style={{ "--p": `${(s.value / totalGiB) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value.toFixed(2)} GiB`}
          />
        ))}
      </div>
      <div className="storage-legend">
        {segments.map((s) => (
          <div key={s.label} className="storage-legend-item">
            <span className="storage-dot" style={{ background: s.color }} />
            <span className="storage-label">{s.label}</span>
            <span className="storage-val">
              {s.value >= 1 ? `${s.value.toFixed(1)} GiB` : `${(s.value * 1024).toFixed(0)} MiB`}
            </span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}

export function EntityHealthCard({ index = 0 }) {
  const connStatus = useConnectionStatus();
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(null);
  useEffect(() => onStatesChanged(() => setTick((t) => t + 1)), []);

  const { groups, available, unavailable } = useMemo(() => {
    const all = getAllStates();
    let avail = 0;
    let unavail = 0;
    const byDomain = {};
    for (const s of all) {
      const bad = s.state === "unavailable" || s.state === "unknown";
      if (bad) {
        unavail++;
        const domain = s.entity_id.split(".")[0];
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(s);
      } else {
        avail++;
      }
    }
    const sorted = Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length);
    return { groups: sorted, available: avail, unavailable: unavail };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, connStatus]);

  const loading = connStatus !== "ready";

  return (
    <Card
      index={index}
      eyebrow={`Entity registry · ${available} online · ${unavailable} unavailable`}
      title="Unavailable groups"
    >
      {loading ? (
        <div className="entity-loading" />
      ) : unavailable === 0 ? (
        <div className="health-all-good">All entities available</div>
      ) : (
        <div className="health-groups">
          {groups.map(([domain, entities]) => (
            <div key={domain} className="health-group">
              <button
                className={`health-group-header ${expanded === domain ? "open" : ""}`}
                onClick={() => setExpanded(expanded === domain ? null : domain)}
              >
                <span className="health-domain">{domain}</span>
                <span className="health-count">{entities.length}</span>
                <span className="health-chevron">{expanded === domain ? "−" : "+"}</span>
              </button>
              {expanded === domain && (
                <ul className="health-entities">
                  {entities.map((e) => (
                    <li key={e.entity_id}>
                      <span className="health-eid">{e.entity_id}</span>
                      <span className={`health-state ${e.state}`}>{e.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const SYSTEM_ACTIONS = [
  { id: "restart_ha", label: "Restart HA", icon: "↻", desc: "homeassistant.restart", confirm: true,
    run: () => callService("homeassistant", "restart") },
  { id: "reboot_host", label: "Reboot Pi", icon: "⏻", desc: "hassio.host_reboot", confirm: true,
    run: () => callService("hassio", "host_reboot") },
  { id: "reload_auto", label: "Reload Automations", icon: "⟲", desc: "automation.reload",
    run: () => callService("automation", "reload") },
  { id: "reload_scripts", label: "Reload Scripts", icon: "⟲", desc: "script.reload",
    run: () => callService("script", "reload") },
];

export function SystemActionsCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function exec(action) {
    if (action.confirm && confirm !== action.id) {
      setConfirm(action.id);
      return;
    }
    setConfirm(null);
    setFiring(action.id);
    try {
      await action.run();
    } catch (e) {
      console.warn("[system-action] failed", action.id, e);
    }
    setTimeout(() => setFiring(null), 2000);
  }

  return (
    <Card index={index} eyebrow="System · actions" title="Quick actions" meta={firing ? `Running…` : ""}>
      <div className="sys-actions-grid">
        {SYSTEM_ACTIONS.map((a) => (
          <button
            key={a.id}
            className={`sys-action ${firing === a.id ? "firing" : ""} ${confirm === a.id ? "confirming" : ""} ${a.id}`}
            onClick={() => exec(a)}
            disabled={!!firing}
          >
            <div className="sys-action-ic">{a.icon}</div>
            <div>
              <div className="sys-action-nm">
                {confirm === a.id ? "Confirm?" : a.label}
              </div>
              <div className="sys-action-sub">{a.desc}</div>
            </div>
          </button>
        ))}
      </div>
      {confirm && (
        <button className="sys-action-cancel" onClick={() => setConfirm(null)}>
          Cancel
        </button>
      )}
    </Card>
  );
}

export function InProgressCard({ index = 0 }) {
  const { entity: live, status } = useEntityStatus("todo.doing_2");
  const [items, setItems] = useState([]);
  const count = Number(live?.state ?? 0);
  useEffect(() => {
    if (!live) return;
    getTodoItems("todo.doing_2")
      .then((list) => {
        if (Array.isArray(list)) setItems(list.map((x) => x.summary || x.uid));
      })
      .catch(() => {});
  }, [live?.state]);
  return (
    <Card index={index} eyebrow={`In Progress · ${count} items`} title="Doing now">
      <EntityGuard status={status} entityId="todo.doing_2">
      <ul className="shopping">
        {items.slice(0, 6).map((it, i) => (
          <li key={i}>{it}</li>
        ))}
        {items.length > 6 && (
          <li style={{ color: "var(--ink-3)", borderBottom: 0 }}>… and {items.length - 6} more</li>
        )}
      </ul>
      </EntityGuard>
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

function kelvinToRgb(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; } else { r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(t - 60, -0.1332047592))); }
  if (t <= 66) { g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(t) - 161.1195681661)); } else { g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(t - 60, -0.0755148492))); }
  if (t >= 66) { b = 255; } else if (t <= 19) { b = 0; } else { b = Math.min(255, Math.max(0, 138.5177312231 * Math.log(t - 10) - 305.0447927307)); }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

export function LightCard({ index = 0, entityId }) {
  const { entity: e, status } = useEntityStatus(entityId);
  const placeholder = e?.attributes?.placeholder;
  const unavailable = status === "unavailable";
  const initialRgb = e?.attributes?.rgb_color || [255, 198, 130];
  const supportsColorTemp = e?.attributes?.supported_color_modes?.includes("color_temp");
  const minKelvin = e?.attributes?.min_color_temp_kelvin || 2000;
  const maxKelvin = e?.attributes?.max_color_temp_kelvin || 6500;
  const [on, setOn] = useState(e?.state === "on");
  const [bright, setB] = useState(e?.attributes?.brightness || 180);
  const [rgb, setRgb] = useState(initialRgb);
  const [kelvin, setKelvin] = useState(e?.attributes?.color_temp_kelvin || 4000);

  useEffect(() => {
    if (!e) return;
    setOn(e.state === "on");
    if (e.attributes?.brightness != null) setB(e.attributes.brightness);
    if (e.attributes?.rgb_color) setRgb(e.attributes.rgb_color);
    if (e.attributes?.color_temp_kelvin != null) setKelvin(e.attributes.color_temp_kelvin);
  }, [e?.state, e?.attributes?.brightness, e?.attributes?.rgb_color?.join(","), e?.attributes?.color_temp_kelvin]);

  function toggle() {
    if (placeholder || unavailable) return;
    const next = !on;
    setOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => setOn(on));
  }

  function pickColor(p) {
    if (placeholder || unavailable) return;
    if (!on) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: p.kelvin }).catch(() => {});
    } else {
      setRgb(p.rgb);
      callService("light", "turn_on", { entity_id: entityId, rgb_color: p.rgb }).catch(() => {});
    }
  }

  function commitBrightness(v) {
    setB(v);
    if (placeholder || unavailable || !on) return;
    callService("light", "turn_on", { entity_id: entityId, brightness: v }).catch(() => {});
  }

  function commitKelvin(v) {
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (placeholder || unavailable || !on) return;
    callService("light", "turn_on", { entity_id: entityId, color_temp_kelvin: v }).catch(() => {});
  }

  const glow = on
    ? `0 0 24px ${rgbStr([rgb[0], rgb[1], rgb[2]])}33, 0 0 80px ${rgbStr([rgb[0], rgb[1], rgb[2]])}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow={`Light · ${entityId}`}
      title={e?.attributes?.friendly_name || entityId.split(".")[1]}
      meta={placeholder ? "Not yet added" : unavailable ? "Unavailable" : on ? `On · ${Math.round((bright / 255) * 100)}%` : "Off"}
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
        ) : unavailable ? (
          <span className="pill" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--bad)", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--bad)" }}>offline</span>
        ) : (
          <div className={`toggle ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} />
        )
      }
    >
      <EntityGuard status={status} entityId={entityId}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
          opacity: placeholder || unavailable ? 0.5 : 1,
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
            disabled={placeholder || unavailable || !on}
            onChange={(ev) => setB(Number(ev.target.value))}
            onPointerUp={(ev) => commitBrightness(Number(ev.target.value))}
            onKeyUp={(ev) => commitBrightness(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: on ? rgbStr(rgb) : "var(--ink-4)" }}
          />
        </div>
      </div>

      {!placeholder && !unavailable && supportsColorTemp && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {kelvin}K
            </span>
          </div>
          <input
            type="range"
            min={minKelvin}
            max={maxKelvin}
            step="100"
            value={kelvin}
            disabled={!on}
            onChange={(ev) => { setKelvin(Number(ev.target.value)); setRgb(kelvinToRgb(Number(ev.target.value))); }}
            onPointerUp={(ev) => commitKelvin(Number(ev.target.value))}
            onKeyUp={(ev) => commitKelvin(Number(ev.target.value))}
            className="gh-slider"
            style={{
              width: "100%",
              background: on
                ? `linear-gradient(to right, rgb(255,147,41), rgb(255,198,130), rgb(255,235,200), rgb(220,235,255))`
                : "var(--glass-bg-2)",
              borderRadius: 6,
            }}
          />
        </div>
      )}

      {!placeholder && !unavailable && (
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
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Desk strip — Govee H6159 (cloud API via rest_command)
   State synced from sensor.desk_strip_state (REST polling).
   ----------------------------------------------------------------*/
function parseGoveeProps(attrs) {
  const props = attrs?.properties;
  if (!Array.isArray(props)) return {};
  const out = {};
  for (const p of props) {
    if (p.powerState !== undefined) out.power = p.powerState;
    if (p.brightness !== undefined) out.brightness = p.brightness;
    if (p.color !== undefined) out.color = [p.color.r, p.color.g, p.color.b];
  }
  return out;
}

const GOVEE_GAP = 2000;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const GOVEE_PRESETS = [
  { id: "warm", label: "Warm 2200K", rgb: [255, 170, 110], kelvin: 2200 },
  { id: "amber", label: "Amber 2700K", rgb: [255, 198, 130], kelvin: 2700 },
  { id: "neutral", label: "Neutral 4000K", rgb: [255, 235, 200], kelvin: 4000 },
  { id: "cool", label: "Cool 5500K", rgb: [220, 235, 255], kelvin: 5500 },
  { id: "red", label: "Red", rgb: [255, 0, 0] },
  { id: "orange", label: "Orange", rgb: [255, 100, 0] },
  { id: "green", label: "Forest", rgb: [0, 255, 50] },
  { id: "blue", label: "Blue", rgb: [0, 50, 255] },
  { id: "purple", label: "Purple", rgb: [150, 0, 255] },
  { id: "pink", label: "Pink", rgb: [255, 0, 150] },
];

export function DeskStripCard({ index = 0 }) {
  const live = useEntity("sensor.desk_strip_state");
  const hw = useMemo(() => parseGoveeProps(live?.attributes), [live?.attributes?.properties]);

  const [on, setOn] = useState(false);
  const [bright, setB] = useState(100);
  const [rgb, setRgb] = useState([255, 198, 130]);
  const [kelvin, setKelvin] = useState(2700);
  const userActedAt = useRef(0);
  const lastCmdTime = useRef(0);
  const cmdQueue = useRef(Promise.resolve());
  const cmdEpoch = useRef(0);
  const verifyTimer = useRef(null);

  useEffect(() => {
    if (Date.now() - userActedAt.current < 5000) return;
    if (live) setOn(live.state === "on");
    if (hw.brightness != null) setB(hw.brightness);
    if (hw.color) setRgb(hw.color);
  }, [live?.state, hw.brightness, hw.color?.join(",")]);

  function scheduleVerify() {
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => {
      callService("homeassistant", "update_entity", { entity_id: "sensor.desk_strip_state" }).catch(() => {});
    }, 3000);
  }

  function govee(cmd, data) {
    userActedAt.current = Date.now();
    const epoch = ++cmdEpoch.current;
    const p = cmdQueue.current.then(async () => {
      if (cmdEpoch.current !== epoch) return;
      const wait = GOVEE_GAP - (Date.now() - lastCmdTime.current);
      if (wait > 0) await delay(wait);
      if (cmdEpoch.current !== epoch) return;
      lastCmdTime.current = Date.now();
      await callService("rest_command", `govee_desk_strip_${cmd}`, data);
      scheduleVerify();
    });
    cmdQueue.current = p.catch(() => {});
    return p;
  }

  function toggle() {
    const next = !on;
    setOn(next);
    cmdEpoch.current++;
    const epoch = cmdEpoch.current;
    const p = cmdQueue.current.then(async () => {
      if (cmdEpoch.current !== epoch) return;
      const wait = GOVEE_GAP - (Date.now() - lastCmdTime.current);
      if (wait > 0) await delay(wait);
      lastCmdTime.current = Date.now();
      await callService("rest_command", "govee_desk_strip_turn", { value: next ? "on" : "off" });
      scheduleVerify();
    });
    cmdQueue.current = p.catch(() => {});
    p.catch(() => setOn(!next));
  }

  function commitBrightness(v) {
    setB(v);
    if (!on) return;
    govee("brightness", { value: v }).catch(() => {});
  }

  function pickColor(p) {
    const wasOff = !on;
    if (wasOff) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      const send = () => govee("color_temp", { value: p.kelvin });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    } else {
      setRgb(p.rgb);
      const send = () => govee("color", { r: p.rgb[0], g: p.rgb[1], b: p.rgb[2] });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    }
  }

  function commitKelvin(v) {
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (!on) return;
    govee("color_temp", { value: v }).catch(() => {});
  }

  const glow = on
    ? `0 0 24px ${rgbStr(rgb)}33, 0 0 80px ${rgbStr(rgb)}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow="Light · Govee H6159"
      title="Desk strip"
      meta={on ? `On · ${bright}%` : "Off"}
      headRight={
        <div className={`toggle ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} />
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
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
              {bright}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={bright}
            disabled={!on}
            onChange={(ev) => setB(Number(ev.target.value))}
            onPointerUp={(ev) => commitBrightness(Number(ev.target.value))}
            onKeyUp={(ev) => commitBrightness(Number(ev.target.value))}
            className="gh-slider"
            style={{ width: "100%", accentColor: on ? rgbStr(rgb) : "var(--ink-4)" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
            {kelvin}K
          </span>
        </div>
        <input
          type="range"
          min={2000}
          max={9000}
          step="100"
          value={kelvin}
          disabled={!on}
          onChange={(ev) => { setKelvin(Number(ev.target.value)); setRgb(kelvinToRgb(Number(ev.target.value))); }}
          onPointerUp={(ev) => commitKelvin(Number(ev.target.value))}
          onKeyUp={(ev) => commitKelvin(Number(ev.target.value))}
          className="gh-slider"
          style={{
            width: "100%",
            background: on
              ? `linear-gradient(to right, rgb(255,147,41), rgb(255,198,130), rgb(255,235,200), rgb(220,235,255))`
              : "var(--glass-bg-2)",
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Color · curated</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GOVEE_PRESETS.map((p) => {
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
    </Card>
  );
}

/* ----------------------------------------------------------------
   Fan
   ----------------------------------------------------------------*/
export function FanCard({ index = 0 }) {
  const { entity: live, status: fanStatus } = useEntityStatus("fan.ceiling");
  const unavailable = fanStatus === "unavailable" || fanStatus === "not_found";
  const [on, setOn] = useState(live?.state === "on");
  const [pct, setPct] = useState(live?.attributes?.percentage || 0);
  const presets = live?.attributes?.preset_modes || ["sleep", "low", "medium", "high"];
  const [preset, setPreset] = useState(live?.attributes?.preset_mode);
  useEffect(() => {
    if (!live) return;
    setOn(live.state === "on");
    if (live.attributes?.percentage != null) setPct(live.attributes.percentage);
    if (live.attributes?.preset_mode) setPreset(live.attributes.preset_mode);
  }, [live?.state, live?.attributes?.percentage, live?.attributes?.preset_mode]);

  function toggleFan() {
    if (unavailable) return;
    const next = !on;
    setOn(next);
    callService("fan", next ? "turn_on" : "turn_off", { entity_id: "fan.ceiling" }).catch(() => setOn(on));
  }
  function pick(p) {
    if (unavailable) return;
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
      meta={unavailable ? "Entity not found" : on ? `${preset || "manual"} · ${pct}%` : "Off"}
      headRight={<div className={`toggle ${on && !unavailable ? "on" : ""}`} onClick={toggleFan} role="switch" style={unavailable ? { opacity: 0.4 } : undefined} />}
    >
      <EntityGuard status={fanStatus} entityId="fan.ceiling">
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
              <button key={p} className={`preset ${preset === p ? "on" : ""}`} onClick={() => pick(p)} disabled={unavailable}>
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

/* ----------------------------------------------------------------
   Quick toggles (Overview)
   ----------------------------------------------------------------*/
function QuickToggle({ entityId }) {
  const { entity: e, status } = useEntityStatus(entityId);
  const unavailable = status === "unavailable" || status === "not_found";
  const initRgb = e?.attributes?.rgb_color || [255, 198, 130];
  const [on, setOn] = useState(e?.state === "on");
  useEffect(() => {
    if (e) setOn(e.state === "on");
  }, [e?.state]);
  if (status === "loading") return <div className="entity-loading" style={{ borderRadius: 14, minHeight: 52 }} />;
  function toggle() {
    if (unavailable) return;
    const next = !on;
    setOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: entityId }).catch(() => setOn(on));
  }
  return (
    <button
      onClick={toggle}
      disabled={unavailable}
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
        <div style={{ fontSize: 13, fontWeight: 500 }}>{e?.attributes?.friendly_name || entityId.split(".")[1]}</div>
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
          {unavailable ? "Unavailable" : on ? "On" : "Off"}
        </div>
      </div>
      <div className={`toggle ${on && !unavailable ? "on" : ""}`} style={{ transform: "scale(0.8)", transformOrigin: "right center", opacity: unavailable ? 0.4 : 1 }} />
    </button>
  );
}

export function QuickLightsCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Quick · favorite lights" title="Lights at hand">
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        <QuickToggle entityId="light.smartbulb_5c_h" />
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
  const { entity: liveTotal, status: adgStatus } = useEntityStatus("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveRatio = useEntity("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveProt = useEntity("switch.adguard_home_protection");
  const total = Number(liveTotal?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const ratio = Number(liveRatio?.state ?? 0);
  const [prot, setProt] = useState(liveProt?.state === "on");
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  function toggleProt() {
    const next = !prot;
    setProt(next);
    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
  }

  return (
    <Card index={index} eyebrow="Network · AdGuard" title="AdGuard" meta={prot ? "Live" : "Off"}>
      <EntityGuard status={adgStatus} entityId="sensor.adguard_home_dns_queries">
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
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Uptime
   ----------------------------------------------------------------*/
export function UptimeCard({ index = 0 }) {
  const { entity: live, status: uptimeStatus } = useEntityStatus("sensor.uptime");
  const iso = live?.state || "2000-01-01T00:00:00";
  const started = new Date(iso);
  const now = new Date();
  const diffMs = now - started;
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));

  return (
    <Card index={index} eyebrow="Uptime · sensor.uptime" title="Up since">
      <EntityGuard status={uptimeStatus} entityId="sensor.uptime">
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
      </EntityGuard>
    </Card>
  );
}

/* ----------------------------------------------------------------
   Pixoo 64
   ----------------------------------------------------------------*/
export function PixooCard({ index = 0 }) {
  const { entity: e, status: pixooStatus } = useEntityStatus("light.divoom_pixoo_64");
  const [on, setOn] = useState(e?.state === "on");
  const [bright, setB] = useState(e?.attributes?.brightness ?? 200);
  const [channel, setChannel] = useState(e?.attributes?.channel ?? "Clock");
  const channels = e?.attributes?.available_channels ?? ["Clock", "Weather", "Visualizer", "Custom"];

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
      eyebrow="Light · light.divoom_pixoo_64"
      title="Pixoo 64 · bedroom"
      meta={pixooStatus !== "ready" ? "—" : on ? `${channel} · ${Math.round((bright / 255) * 100)}%` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={() => setOn(!on)} role="switch" />}
    >
      <EntityGuard status={pixooStatus} entityId="light.divoom_pixoo_64">
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
      </EntityGuard>
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
// ListenHereCard — "Play on this device" stream option (glasshouse-v2 stream-options design)
export function ListenHereCard({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const live = useEntity(ENTITY);
  const e = live || (GH_DATA.media && GH_DATA.media[ENTITY]) || {};
  const playing = e.state === "playing";

  const play = () =>
    callService("media_player", "media_play", { entity_id: ENTITY }).catch(() => {});

  return (
    <Card index={index} className={`listen-here${playing ? " active" : ""}`}>
      <button className="listen-here-row" onClick={play}>
        <span className="lh-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </span>
        <span className="lh-text">
          <span className="lh-title">Listen here</span>
          <span className="lh-sub">{playing ? "Playing on this device" : "Play on this device"}</span>
        </span>
        <span className="lh-chev">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </button>
    </Card>
  );
}

export function NowPlayingHero({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m, status: npStatus } = useEntityStatus(ENTITY);
  const a = m?.attributes || {};
  const duration = Number(a.media_duration) > 0 ? Number(a.media_duration) : 0;
  const hasDuration = duration > 0;
  const [pos, setPos] = useState(a.media_position || 0);
  const [playing, setPlaying] = useState(m?.state === "playing");
  const [vol, setVol] = useState(Math.round((a.volume_level || 0) * 100));
  const idle = m && m.state !== "playing" && m.state !== "paused";
  useEffect(() => {
    if (!m) return;
    setPlaying(m.state === "playing");
    if (m.attributes?.media_position != null) setPos(m.attributes.media_position);
    if (m.attributes?.volume_level != null) setVol(Math.round(m.attributes.volume_level * 100));
  }, [m?.state, m?.attributes?.media_position, m?.attributes?.volume_level]);
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
      <EntityGuard status={npStatus} entityId={ENTITY}>
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
      </EntityGuard>
    </Card>
  );
}

function useSpotifyConnect() {
  const [connected, setConnected] = useState(isSpotifyConnected);
  useEffect(() => { callbackReady.then((ok) => { if (ok) setConnected(true); }); }, []);
  return [connected, setConnected];
}

export function SpotifyConnectCard({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m } = useEntityStatus(ENTITY);
  const a = m?.attributes || {};
  const sources = Array.isArray(a.source_list) ? a.source_list : [];
  const activeSource = a.source || null;
  const playing = m?.state === "playing";
  const paused = m?.state === "paused";
  const [spotifyConnected, setSpotifyConnected] = useSpotifyConnect();
  const configured = isSpotifyConfigured();

  return (
    <Card
      index={index}
      eyebrow="Spotify Connect · Pi speaker"
      title="Guest playback"
      meta={playing ? "In use" : "Available"}
    >
      <div
        style={{
          background: "var(--glass-bg-2)",
          border: "1px solid var(--glass-stroke)",
          borderRadius: 14,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: playing || paused
              ? "linear-gradient(135deg, #1db954, #1ed760)"
              : "color-mix(in oklch, var(--ink), transparent 88%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            flexShrink: 0,
            transition: "background 0.3s ease",
          }}
        >
          {playing ? "♪" : "🔊"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Home Assistant</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginTop: 2,
            }}
          >
            {playing
              ? `Playing · ${a.media_title || "unknown"}`
              : paused
                ? "Paused"
                : "Ready for connections"}
          </div>
        </div>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: playing || paused ? "#1db954" : "var(--ink-3)",
            boxShadow: playing ? "0 0 8px #1db954" : "none",
            flexShrink: 0,
            transition: "background 0.3s, box-shadow 0.3s",
          }}
        />
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.5 }}>
        Open Spotify → Connect to a device → "Home Assistant"
      </div>

      {sources.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
          {sources.map((s) => (
            <span key={s} className={`preset ${activeSource === s ? "on" : ""}`}>{s}</span>
          ))}
        </div>
      )}

      {configured && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          {spotifyConnected ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1db954", boxShadow: "0 0 6px #1db954" }} />
                Spotify connected
              </div>
              <span
                onClick={() => { clearSpotifyToken(); setSpotifyConnected(false); }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", cursor: "pointer" }}
              >
                Disconnect
              </span>
            </div>
          ) : (
            <button
              className="btn primary"
              onClick={startSpotifyAuth}
              style={{ width: "100%", padding: "10px 16px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <span style={{ fontSize: 16 }}>♪</span>
              Connect to Spotify
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

const _spotifyItemStyle = {
  background: "var(--glass-bg-2)",
  border: "1px solid var(--glass-stroke)",
  borderRadius: 12,
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
  color: "var(--ink)",
  transition: "background 0.2s ease, opacity 0.2s ease",
  width: "100%",
};

const _spotifyThumbStyle = {
  width: 40,
  height: 40,
  borderRadius: 8,
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundColor: "color-mix(in oklch, var(--ink), transparent 88%)",
  flexShrink: 0,
};

function useSpotifyPlay() {
  const [playing, setPlaying] = useState(null);
  const [error, setError] = useState(null);
  const [, setConnected] = useSpotifyConnect();
  async function play(uri) {
    setPlaying(uri);
    setError(null);
    try { await playUri(uri); }
    catch (e) {
      if (e.message?.includes("expired")) { setConnected(false); setError("Session expired"); }
      else setError("Open Spotify on a device first");
    }
    setTimeout(() => setPlaying(null), 2000);
  }
  return { playing, error, play };
}

function SpotifyTrackRow({ item, playing, onPlay, subtitle, label, keyPrefix }) {
  const uri = item.uri;
  const isPlaying = playing === uri;
  const img = item.image || null;
  const sub = subtitle || `${item.artist} · ${item.album}`;
  return (
    <button
      style={{ ..._spotifyItemStyle, opacity: isPlaying ? 0.6 : 1 }}
      onClick={() => onPlay(uri)}
    >
      <div style={{ ..._spotifyThumbStyle, backgroundImage: img ? `url(${img})` : undefined }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginRight: 6 }}>
              {label}
            </span>
          )}
          {item.name}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub}
        </div>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", flexShrink: 0 }}>
        {isPlaying ? "..." : "▶"}
      </span>
    </button>
  );
}

const _emptyMsg = (text) => (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", padding: "8px 4px" }}>{text}</div>
);

const _notConnected = (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", padding: "8px 4px" }}>
    Connect to Spotify to use this card.
  </div>
);

export function SpotifySearchCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();
  const timer = useRef(null);

  function handleSearch(q) {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(() => {
      setLoading(true);
      searchTracks(q).then(setResults).catch(() => setResults([])).finally(() => setLoading(false));
    }, 400);
  }

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Search · Spotify" title="Search">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Search · Spotify" title="Search" meta={loading ? "Loading" : null}>
      <input
        type="text"
        placeholder="Search songs, artists, albums..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        style={{
          background: "var(--glass-bg-2)", border: "1px solid var(--glass-stroke)", borderRadius: 10,
          padding: "10px 12px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--ink)",
          outline: "none", width: "100%", boxSizing: "border-box", marginBottom: 10,
        }}
      />
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {results.map((item) => (
          <SpotifyTrackRow key={item.uri} item={item} playing={playing} onPlay={play} />
        ))}
      </div>
      {!loading && query && results.length === 0 && _emptyMsg(`No results for "${query}"`)}
      {!query && _emptyMsg("Type to search Spotify")}
    </Card>
  );
}

export function SpotifyPlaylistsCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    getPlaylists(30).then(setPlaylists).catch(() => []).finally(() => setLoading(false));
  }, [connected]);

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Playlists · Spotify" title="Playlists">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Playlists · Spotify" title="Playlists" meta={loading ? "Loading" : `${playlists.length}`}>
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {playlists.map((item) => (
          <SpotifyTrackRow key={item.uri} item={item} playing={playing} onPlay={play} subtitle={`${item.tracks} tracks · ${item.owner}`} />
        ))}
      </div>
      {!loading && playlists.length === 0 && _emptyMsg("No playlists found.")}
    </Card>
  );
}

export function SpotifyQueueCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [queueData, setQueueData] = useState({ current: null, queue: [] });
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    getQueue().then(setQueueData).catch(() => setQueueData({ current: null, queue: [] })).finally(() => setLoading(false));
  }, [connected]);

  function refresh() {
    setLoading(true);
    getQueue().then(setQueueData).catch(() => {}).finally(() => setLoading(false));
  }

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Queue · Spotify" title="Up next">{_notConnected}</Card>;
  }

  return (
    <Card
      index={index}
      eyebrow="Queue · Spotify"
      title="Up next"
      meta={loading ? "Loading" : queueData.queue.length > 0 ? `${queueData.queue.length} tracks` : null}
      headRight={
        <span onClick={refresh} style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", cursor: "pointer" }}>
          Refresh
        </span>
      }
    >
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {queueData.current && <SpotifyTrackRow item={queueData.current} playing={playing} onPlay={play} label="Now" />}
        {queueData.queue.map((item, i) => (
          <SpotifyTrackRow key={`q${i}-${item.uri}`} item={item} playing={playing} onPlay={play} label={`${i + 1}`} />
        ))}
      </div>
      {!loading && !queueData.current && queueData.queue.length === 0 && _emptyMsg("Nothing in the queue — play something first.")}
    </Card>
  );
}

export function SpotifyRecentCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    getRecentlyPlayed(15).then(setRecent).catch(() => []).finally(() => setLoading(false));
  }, [connected]);

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Recent · Spotify" title="Recently played">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Recent · Spotify" title="Recently played" meta={loading ? "Loading" : null}>
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {recent.map((item, i) => (
          <SpotifyTrackRow key={`r${i}-${item.uri}`} item={item} playing={playing} onPlay={() => play(item.contextUri || item.uri)} />
        ))}
      </div>
      {!loading && recent.length === 0 && _emptyMsg("No recent tracks.")}
    </Card>
  );
}

/* ----------------------------------------------------------------
   Next event — compact card for Overview
   ----------------------------------------------------------------*/
export function NextEventCard({ index = 0 }) {
  const calendarEntities = useEntitiesByDomain("calendar");
  const calendarIds = useMemo(
    () => calendarEntities.map((e) => e.entity_id).sort(),
    [calendarEntities.length, calendarEntities.map((e) => e.entity_id).join(",")],
  );

  const now = new Date();
  const startISO = now.toISOString();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  const endISO = end.toISOString();

  const { events, loading } = useCalendarEvents(calendarIds, startISO, endISO);

  const upcoming = useMemo(() => {
    if (!events.length) return [];
    return events
      .map((ev) => {
        const startRaw = ev.start?.dateTime || ev.start?.date;
        const allDay = !ev.start?.dateTime;
        const start = startRaw ? new Date(startRaw) : null;
        if (!start || start < now) return null;
        const calName = calendarEntities.find((e) => e.entity_id === ev.cal_entity_id)?.attributes?.friendly_name || "";
        return { summary: ev.summary, start, allDay, calName };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start)
      .slice(0, 3);
  }, [events]);

  function fmtDate(d, allDay) {
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const dayLabel = isToday ? "Today" : isTomorrow ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    if (allDay) return dayLabel;
    return `${dayLabel} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  return (
    <Card index={index} eyebrow="Calendar · Upcoming" meta={loading ? "Loading" : upcoming.length > 0 ? `${upcoming.length} events` : null}>
      {upcoming.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {upcoming.map((ev, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 4, height: 32, borderRadius: 2, flexShrink: 0,
                background: i === 0 ? "var(--accent)" : "color-mix(in oklch, var(--ink), transparent 80%)",
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.summary}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 1 }}>
                  {fmtDate(ev.start, ev.allDay)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
          {loading ? "Loading events..." : "Nothing scheduled this week"}
        </div>
      )}
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
   Kanban — local todo lists stored on the Pi (local_todo integration).
   Columns: Backlog → Next → In Progress → Done.
   Tags stored as #tag in description. Due dates optional.
   ----------------------------------------------------------------*/
const KANBAN_COLS = [
  { id: "todo.backlog", label: "Backlog" },
  { id: "todo.next",    label: "Next" },
  { id: "todo.doing_2", label: "In Progress" },
  { id: "__done__",      label: "Done" },
];

const KANBAN_PRESET_TAGS = [
  { id: "ha",           label: "HA" },
  { id: "work",         label: "Work" },
  { id: "side-project", label: "Side Project" },
  { id: "fun",          label: "Fun" },
  { id: "errand",       label: "Errand" },
  { id: "learning",     label: "Learning" },
  { id: "health",       label: "Health" },
  { id: "finance",      label: "Finance" },
];
const KANBAN_ENTITY_IDS = KANBAN_COLS.filter((c) => c.id !== "__done__").map((c) => c.id);

function parseTags(description) {
  if (!description) return { tags: [], text: "" };
  const tags = [];
  const text = description.replace(/#(\w[\w-]*)/g, (_, t) => { tags.push(t); return ""; }).trim();
  return { tags, text };
}

function buildDescription(tags, text) {
  const parts = [];
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(" "));
  if (text) parts.push(text);
  return parts.join(" ") || undefined;
}

function fmtDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
}

function useKanbanItems(entityIds) {
  const connStatus = useConnectionStatus();
  const [columns, setColumns] = useState(() => {
    const out = {};
    for (const id of entityIds) out[id] = [];
    out.__done__ = [];
    return out;
  });
  const [loading, setLoading] = useState(true);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (connStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      const out = {};
      const done = [];
      for (const id of entityIds) {
        out[id] = [];
        try {
          const [active, completed] = await Promise.all([
            getTodoItems(id, "needs_action"),
            getTodoItems(id, "completed"),
          ]);
          out[id] = active.map((it) => ({ ...it, _entity: id }));
          done.push(...completed.map((it) => ({ ...it, _entity: id })));
        } catch {}
      }
      if (cancelled) return;
      setColumns({ ...out, __done__: done });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [connStatus, fetchTick]);

  const refresh = () => setFetchTick((t) => t + 1);

  return { columns, setColumns, loading, refresh };
}

export function KanbanBoardCard({ index = 0 }) {
  const { columns, setColumns, loading, refresh } = useKanbanItems(KANBAN_ENTITY_IDS);
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [adding, setAdding] = useState(null);

  function optimisticMove(uid, fromCol, toCol) {
    setColumns((cur) => {
      const next = { ...cur };
      const card = cur[fromCol].find((c) => (c.uid || c.summary) === uid);
      if (!card) return cur;
      next[fromCol] = cur[fromCol].filter((c) => (c.uid || c.summary) !== uid);
      next[toCol] = [card, ...cur[toCol]];
      return next;
    });
  }

  async function moveCard(uid, fromCol, toCol) {
    if (fromCol === toCol) return;
    const card = columns[fromCol]?.find((c) => (c.uid || c.summary) === uid);
    if (!card) return;
    optimisticMove(uid, fromCol, toCol);
    try {
      if (toCol === "__done__") {
        await callService("todo", "update_item", {
          entity_id: card._entity,
          item: card.summary,
          status: "completed",
        });
      } else if (fromCol === "__done__") {
        const targetEntity = toCol;
        if (card._entity === targetEntity) {
          await callService("todo", "update_item", {
            entity_id: card._entity,
            item: card.summary,
            status: "needs_action",
          });
        } else {
          await callService("todo", "update_item", {
            entity_id: card._entity,
            item: card.summary,
            status: "needs_action",
          });
          await callService("todo", "remove_item", {
            entity_id: card._entity,
            item: card.summary,
          });
          await callService("todo", "add_item", {
            entity_id: targetEntity,
            item: card.summary,
            ...(card.due ? { due_date: card.due } : {}),
            ...(card.description ? { description: card.description } : {}),
          });
        }
      } else {
        await callService("todo", "remove_item", {
          entity_id: fromCol,
          item: card.summary,
        });
        await callService("todo", "add_item", {
          entity_id: toCol,
          item: card.summary,
          ...(card.due ? { due_date: card.due } : {}),
          ...(card.description ? { description: card.description } : {}),
        });
      }
      setTimeout(refresh, 500);
    } catch {
      optimisticMove(uid, toCol, fromCol);
    }
  }

  async function addItem(colId, summary, tags, due) {
    const desc = buildDescription(tags, "");
    const temp = { uid: `temp-${Date.now()}`, summary, description: desc, due: due || undefined, status: "needs_action", _entity: colId };
    setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], temp] }));
    setAdding(null);
    try {
      await callService("todo", "add_item", {
        entity_id: colId,
        item: summary,
        ...(due ? { due_date: due } : {}),
        ...(desc ? { description: desc } : {}),
      });
      setTimeout(refresh, 500);
    } catch {
      setColumns((cur) => ({ ...cur, [colId]: cur[colId].filter((c) => c.uid !== temp.uid) }));
    }
  }

  async function removeItem(colId, card) {
    setColumns((cur) => ({
      ...cur,
      [colId]: cur[colId].filter((c) => (c.uid || c.summary) !== (card.uid || card.summary)),
    }));
    try {
      await callService("todo", "remove_item", {
        entity_id: card._entity || colId,
        item: card.summary,
      });
      setTimeout(refresh, 500);
    } catch {
      setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], card] }));
    }
  }

  function onDragStart(ev, uid, col) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ uid, col }));
    ev.dataTransfer.effectAllowed = "move";
    setDraggingId(uid);
  }
  function onDragEnd() { setDraggingId(null); setDragOver(null); }
  function onDragOver(ev, col) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOver(col); }
  function onDrop(ev, col) {
    ev.preventDefault();
    try {
      const { uid, col: fromCol } = JSON.parse(ev.dataTransfer.getData("text/plain"));
      moveCard(uid, fromCol, col);
    } catch {}
    setDragOver(null);
    setDraggingId(null);
  }

  const liveCount = KANBAN_ENTITY_IDS.reduce((n, id) => n + (columns[id]?.length || 0), 0) + (columns.__done__?.length || 0);

  return (
    <Card
      index={index}
      eyebrow={`Kanban${loading ? "" : ` · ${liveCount} items`}`}
      title="Project board"
      meta={loading ? "loading…" : "drag cards between columns"}
    >
      <div className="kanban">
        {KANBAN_COLS.map(({ id, label }) => {
          const items = columns[id] || [];
          const isDone = id === "__done__";
          const canAdd = id !== "__done__";
          return (
            <div
              key={id}
              className={`kanban-col ${dragOver === id ? "drag-over" : ""}`}
              onDragOver={(ev) => onDragOver(ev, id)}
              onDragLeave={() => setDragOver((cur) => (cur === id ? null : cur))}
              onDrop={(ev) => onDrop(ev, id)}
            >
              <div className="kanban-col-head">
                <span className="label">{label}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map((c) => {
                const key = c.uid || c.summary;
                const { tags } = parseTags(c.description);
                const dueLabel = fmtDue(c.due);
                return (
                  <div
                    key={key}
                    className={`kanban-card ${isDone ? "done" : ""} ${draggingId === key ? "dragging" : ""}${dueLabel === "overdue" ? " overdue" : ""}`}
                    draggable
                    onDragStart={(ev) => onDragStart(ev, key, id)}
                    onDragEnd={onDragEnd}
                  >
                    <button className="kanban-card-x" onClick={() => removeItem(id, c)} title="Delete">&times;</button>
                    <div className="summary">{c.summary}</div>
                    <div className="meta">
                      <span className="tags">
                        {tags.map((t) => <span key={t} className={`tag tag-${t}`}>{t}</span>)}
                      </span>
                      {dueLabel && <span className={`due${dueLabel === "overdue" ? " due-overdue" : ""}`}>due · {dueLabel}</span>}
                    </div>
                  </div>
                );
              })}
              {adding === id ? (
                <KanbanAddForm onSubmit={(s, t, d) => addItem(id, s, t, d)} onCancel={() => setAdding(null)} />
              ) : canAdd ? (
                <button className="kanban-add" onClick={() => setAdding(id)}>+ Add</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function KanbanAddForm({ onSubmit, onCancel }) {
  const [summary, setSummary] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [due, setDue] = useState("");
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!showTagMenu) return;
    function close(ev) { if (menuRef.current && !menuRef.current.contains(ev.target)) setShowTagMenu(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showTagMenu]);

  function toggleTag(id) {
    setSelectedTags((cur) => cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]);
  }
  function addCustomTag(ev) {
    ev.preventDefault();
    const t = customTag.replace(/^#/, "").replace(/\s+/g, "-").toLowerCase().trim();
    if (t && !selectedTags.includes(t)) setSelectedTags((cur) => [...cur, t]);
    setCustomTag("");
  }
  function removeTag(id) { setSelectedTags((cur) => cur.filter((t) => t !== id)); }

  function handle(ev) {
    ev.preventDefault();
    const s = summary.trim();
    if (!s) return;
    onSubmit(s, selectedTags, due || null);
  }

  const tagLabel = (id) => KANBAN_PRESET_TAGS.find((p) => p.id === id)?.label || id;

  return (
    <form className="kanban-add-form" onSubmit={handle}>
      <input ref={ref} className="kanban-input" placeholder="What needs doing?" value={summary} onChange={(ev) => setSummary(ev.target.value)} />
      <div className="kanban-add-row">
        <div className="kanban-tag-picker" ref={menuRef}>
          <button type="button" className="kanban-tag-toggle" onClick={() => setShowTagMenu(!showTagMenu)}>
            {selectedTags.length ? selectedTags.map((t) => (
              <span key={t} className={`tag tag-${t}`}>{tagLabel(t)} <span className="tag-rm" onClick={(ev) => { ev.stopPropagation(); removeTag(t); }}>&times;</span></span>
            )) : <span className="placeholder">+ Tags</span>}
          </button>
          {showTagMenu && (
            <div className="kanban-tag-menu">
              {KANBAN_PRESET_TAGS.map(({ id, label }) => (
                <button key={id} type="button" className={`kanban-tag-option ${selectedTags.includes(id) ? "selected" : ""}`} onClick={() => toggleTag(id)}>
                  <span className={`tag-dot tag-${id}`} />
                  {label}
                  {selectedTags.includes(id) && <span className="check">✓</span>}
                </button>
              ))}
              <form className="kanban-tag-custom" onSubmit={addCustomTag}>
                <input className="kanban-input kanban-input-sm" placeholder="Custom tag…" value={customTag} onChange={(ev) => setCustomTag(ev.target.value)} />
              </form>
            </div>
          )}
        </div>
        <input className="kanban-input kanban-input-sm kanban-date" type="date" value={due} onChange={(ev) => setDue(ev.target.value)} />
      </div>
      <div className="kanban-add-row">
        <button type="submit" className="kanban-add-btn">Add</button>
        <button type="button" className="kanban-add-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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

const CLIMATE_STAT_IDS = ["sensor.h5075_4fb6_temperature", "sensor.h5075_4fb6_humidity"];

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

export function BambuStatBox({ index = 0 }) {
  const PREFIX = "x1c_00m09d522400385";
  const { entity: liveProg, status } = useEntityStatus(`sensor.${PREFIX}_print_progress`);
  const liveRem = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId={`sensor.${PREFIX}_print_progress`} /></Card>;
  const prog = Number(liveProg?.state ?? 0);
  const rem = Number(liveRem?.state ?? 0);
  const file = liveProg?.attributes?.file_name || "—";
  const stage = liveStage?.state ?? "—";
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
  const { entity: liveQ, status } = useEntityStatus("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.core_300s_series_air_quality" /></Card>;
  const q = liveQ?.state ?? "—";
  const pm = Number(livePm?.state ?? 0);
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
  const { entity: liveBat, status } = useEntityStatus("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.roborock_s8_battery" /></Card>;
  const bat = Number(liveBat?.state ?? 0);
  const vStatus = liveStatus?.state ?? "docked";
  return (
    <StatBox
      index={index}
      eyebrow="Gregory · vacuum"
      value={bat}
      unit="%"
      caption={vStatus ? `${vStatus[0].toUpperCase()}${vStatus.slice(1)}` : "Docked"}
      pct={bat}
      color={bat >= 90 ? "var(--good)" : bat >= 30 ? "var(--accent-2)" : "var(--bad)"}
    />
  );
}

export function AdGuardStatBox({ index = 0 }) {
  const { entity: liveRatio, status } = useEntityStatus("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.adguard_home_dns_queries_blocked_ratio" /></Card>;
  const ratio = Number(liveRatio?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const total = Number(liveTotal?.state ?? 0);
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
