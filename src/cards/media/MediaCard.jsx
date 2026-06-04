import { useState, useEffect } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

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
