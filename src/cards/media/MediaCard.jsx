import { useState, useEffect, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { useRangeCommit } from "../../hooks/useRangeCommit.js";

/* ----------------------------------------------------------------
   Media — Spotify now playing (compact, Overview tab)
   ----------------------------------------------------------------*/

/* HA strips attributes from an unavailable player, so a missing volume_level
   is unknown, not 0% — null renders as an em-dash. */
const volPct = (v) => (Number.isFinite(v) ? Math.round(v * 100) : null);

export function MediaCard({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m, status } = useEntityStatus(ENTITY);
  /* Only a "ready" player gets controls or a Playing/Paused/Idle claim. HA
     silently skips a service call to an unavailable entity (it resolves, no
     error), so an optimistic Play there would stick on Pause for good. */
  const live = status === "ready";
  const a = m?.attributes || {};
  const duration = Number(a.media_duration) || 0;
  const playing = live && m.state === "playing";
  const paused = live && m.state === "paused";
  const idle = live && !playing && !paused;
  const [isPlaying, setIsPlaying] = useState(playing);
  const [pos, setPos] = useState(Number(a.media_position) || 0);
  const [vol, setVol] = useState(() => volPct(a.volume_level));
  useEffect(() => {
    setIsPlaying(m?.state === "playing");
    if (m?.attributes?.media_position != null) setPos(Number(m.attributes.media_position));
    setVol(volPct(m?.attributes?.volume_level));
  }, [m?.state, m?.attributes?.media_position, m?.attributes?.volume_level]);
  useEffect(() => {
    if (!isPlaying || !duration) return;
    const id = setInterval(() => setPos((p) => Math.min(p + 1, duration)), 1000);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  const pct = duration > 0 ? (pos / duration) * 100 : 0;

  // Revert from HA's truth at failure time, not the boolean captured at click
  // time — the resync effect only fires on a changed state, so a stale revert sticks.
  const mRef = useRef(m);
  mRef.current = m;

  function playPause() {
    if (!live) return;
    const next = !isPlaying;
    setIsPlaying(next);
    callService("media_player", next ? "media_play" : "media_pause", { entity_id: ENTITY })
      .catch(() => setIsPlaying(mRef.current?.state === "playing"));
  }
  function commitVolume(v) {
    if (!live) return;
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 })
      .catch(() => setVol(volPct(mRef.current?.attributes?.volume_level)));
  }
  const volRef = useRangeCommit(commitVolume);
  const volUnknown = vol == null;

  const haUrl = import.meta.env.VITE_HA_URL || "";
  const art = live && a.entity_picture && !idle ? `${haUrl}${a.entity_picture}` : null;
  const dimmed = !live || idle ? 0.4 : 1;
  // "loading" also covers a dropped socket and mock mode — em-dash, not "connecting…".
  const meta = !live ? (status === "loading" ? "—" : "Unavailable") : idle ? "Idle" : isPlaying ? "Playing" : "Paused";

  return (
    <Card index={index} eyebrow="Spotify · Now playing" meta={meta}>
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
            {!live ? "—" : idle ? "Nothing playing" : a.media_title || "—"}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {!live || idle ? "Spotify Connect" : a.media_artist || "—"}
          </div>
        </div>
      </div>

      <div style={{ height: 3, borderRadius: 2, background: "var(--rule)", marginTop: 14, overflow: "hidden", opacity: dimmed }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #1db954, var(--ink))", transition: "width 1s linear" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, opacity: dimmed }}>
        <button className="btn icon" onClick={playPause} disabled={!live} aria-label={isPlaying ? "Pause" : "Play"} style={{ width: 32, height: 32 }}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <input
          ref={volRef}
          type="range" min="0" max="100" value={vol ?? 0}
          aria-label="Volume"
          aria-valuetext={volUnknown ? "Unknown" : `${vol}%`}
          disabled={!live || volUnknown}
          onChange={(e) => setVol(Number(e.target.value))}
          className="gh-slider"
          style={{ flex: 1, accentColor: "#1db954" }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", minWidth: 28, textAlign: "right" }}>
          {volUnknown ? "—" : `${vol}%`}
        </span>
      </div>
      </EntityGuard>
    </Card>
  );
}
