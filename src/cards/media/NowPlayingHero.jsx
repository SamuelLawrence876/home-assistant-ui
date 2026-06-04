import { useState, useEffect } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

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
