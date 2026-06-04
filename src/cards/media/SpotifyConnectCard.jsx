import { useEntityStatus } from "../../ha/useEntity.js";
import { isSpotifyConfigured, startSpotifyAuth, clearSpotifyToken } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect } from "../../cards/media/spotifyShared.jsx";

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
