import { useState, useEffect, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { useRangeCommit } from "../../hooks/useRangeCommit.js";

/* HA strips attributes from an unavailable player, so a missing volume_level
   is unknown, not 0% — null renders as an em-dash. */
const volPct = (v) => (Number.isFinite(v) ? Math.round(v * 100) : null);

/* Where HA says the track is now. media_position is stamped at
   media_position_updated_at, and HA's Spotify integration only polls, so
   while playing the stamp can be well behind. Read in a failure handler,
   never during render. */
function haPosition(ent) {
  const p = Number(ent?.attributes?.media_position);
  if (!Number.isFinite(p)) return 0;
  if (ent.state !== "playing") return p;
  const at = Date.parse(ent.attributes.media_position_updated_at);
  return Number.isFinite(at) ? p + Math.max(0, (Date.now() - at) / 1000) : p;
}

export function NowPlayingHero({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m, status: npStatus } = useEntityStatus(ENTITY);
  /* Only a "ready" player is worth a control or a claim. HA silently skips a
     service call to an unavailable entity — it resolves, no error — so an
     optimistic Play would flip to Pause and stay there with nothing to revert
     it. Not ready: controls are disabled and the header says what we know. */
  const live = npStatus === "ready";
  const a = m?.attributes || {};
  const duration = Number(a.media_duration) > 0 ? Number(a.media_duration) : 0;
  const hasDuration = duration > 0;
  const [pos, setPos] = useState(a.media_position || 0);
  const [playing, setPlaying] = useState(m?.state === "playing");
  const [vol, setVol] = useState(() => volPct(a.volume_level));
  const idle = live && m.state !== "playing" && m.state !== "paused";
  useEffect(() => {
    setPlaying(m?.state === "playing");
    if (m?.attributes?.media_position != null) setPos(m.attributes.media_position);
    setVol(volPct(m?.attributes?.volume_level));
  }, [m?.state, m?.attributes?.media_position, m?.attributes?.volume_level]);
  // Revert from HA's truth at failure time, not the boolean captured at click
  // time — the resync effect only fires on a changed state, so a stale revert sticks.
  const mRef = useRef(m);
  mRef.current = m;

  function playPause() {
    if (!live) return;
    const next = !playing;
    setPlaying(next);
    callService("media_player", next ? "media_play" : "media_pause", { entity_id: ENTITY })
      .catch(() => setPlaying(mRef.current?.state === "playing"));
  }
  function seek(toSec) {
    if (!live || !hasDuration) return;
    setPos(toSec);
    callService("media_player", "media_seek", { entity_id: ENTITY, seek_position: toSec })
      .catch(() => setPos(Math.min(haPosition(mRef.current), duration)));
  }
  function commitVolume(v) {
    if (!live) return;
    setVol(v);
    callService("media_player", "volume_set", { entity_id: ENTITY, volume_level: v / 100 })
      .catch(() => setVol(volPct(mRef.current?.attributes?.volume_level)));
  }
  const volRef = useRangeCommit(commitVolume);
  const volUnknown = vol == null;
  useEffect(() => {
    if (!playing || !hasDuration) return;
    // Clamp, don't wrap: modulo restarts the bar (and the countdown) from zero
    // for the same track while we wait for HA to push the next one.
    const id = setInterval(() => setPos((p) => Math.min(p + 1, duration)), 1000);
    return () => clearInterval(id);
  }, [playing, duration, hasDuration]);
  const pct = hasDuration ? (pos / duration) * 100 : 0;
  const t = (s) => {
    const n = Math.max(0, Math.floor(Number(s) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  };

  /* "loading" also covers a dropped socket and mock mode, so it gets the
     em-dash, not "connecting…". Not ready, the title names the card instead
     of claiming a listening state; the eyebrow drops its "Now playing" so the
     two don't read the same words twice. */
  const unknownMeta = npStatus === "loading" ? "—" : "Unavailable";
  const artistLine = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");

  return (
    <Card
      index={index}
      className="weather-hero"
      eyebrow={live ? `Now playing · ${a.source || "Spotify"}` : "Spotify"}
      title={!live ? "Now playing" : idle ? "Nothing playing" : "Currently listening"}
      meta={!live ? unknownMeta : idle ? "Idle" : playing ? "Playing" : "Paused"}
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
              live && a.entity_picture && !idle
                ? `url(${import.meta.env.VITE_HA_URL}${a.entity_picture})`
                : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: !live || idle ? 0.4 : 1,
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
            {a.media_title || "—"}
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
            {artistLine || "—"}
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
            <button
              className="btn icon"
              aria-label="Back 15 seconds"
              disabled={!live || !hasDuration}
              onClick={() => seek(Math.max(0, pos - 15))}
            >
              ⏮
            </button>
            <button
              className="btn icon primary"
              onClick={playPause}
              aria-label={playing ? "Pause" : "Play"}
              disabled={!live}
              style={{ width: 48, height: 48 }}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button
              className="btn icon"
              aria-label="Forward 15 seconds"
              disabled={!live || !hasDuration}
              onClick={() => seek(Math.min(duration - 1, pos + 15))}
            >
              ⏭
            </button>
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
                ref={volRef}
                type="range"
                min="0"
                max="100"
                value={vol ?? 0}
                aria-label="Volume"
                aria-valuetext={volUnknown ? "Unknown" : `${vol}%`}
                disabled={!live || volUnknown}
                onChange={(e) => setVol(Number(e.target.value))}
                className="gh-slider"
                style={{ flex: 1, maxWidth: 200, accentColor: "var(--accent)" }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", minWidth: 30, textAlign: "right" }}>
                {volUnknown ? "—" : `${vol}%`}
              </span>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
