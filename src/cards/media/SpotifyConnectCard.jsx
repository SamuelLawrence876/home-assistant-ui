import { useEntityStatus } from "../../ha/useEntity.js";
import { isSpotifyConfigured, startSpotifyAuth } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, _linkBtnStyle } from "../../cards/media/spotifyShared.jsx";

/* The Spotify Connect add-on's device name for the Pi. */
const PI_SPEAKER = "Home Assistant";

/* What this card can honestly say about the Pi speaker.

   ENTITY is the HA Spotify integration's *account* player: its state follows
   whichever device the linked account is playing on, and a guest casting to
   the Pi from their own account never shows up in it at all. So the only
   thing it can confirm is "the linked account is using the Pi" (source is the
   Pi). Anything else leaves the speaker's state unknown — never "Available".
   The add-on runs independently of the integration, so an unavailable
   integration doesn't make the speaker unavailable either: also unknown. */
function speakerStatus(status, m) {
  if (status === "loading") return { meta: "—", line: "—" };
  if (status !== "ready") return { meta: "—", line: "Status unknown · Spotify integration unavailable" };
  const a = m.attributes || {};
  const active = m.state === "playing" || m.state === "paused";
  if (a.source === PI_SPEAKER && m.state === "playing") {
    return { meta: "In use", line: `Playing · ${a.media_title || "—"}`, onPi: true, playing: true };
  }
  if (a.source === PI_SPEAKER && m.state === "paused") return { meta: "Paused", line: "Paused", onPi: true };
  if (active && a.source) return { meta: "—", line: `Linked account on ${a.source}` };
  // Playing with no `source`: HA didn't name the device, which could be the
  // Pi. Say so; "not in use" here contradicted the hero on the same tab.
  if (active) return { meta: "—", line: `Linked account ${m.state} · device unknown` };
  return { meta: "—", line: "Not in use by the linked account" };
}

export function SpotifyConnectCard({ index = 0 }) {
  const ENTITY = "media_player.spotify_samuel_lawrence";
  const { entity: m, status } = useEntityStatus(ENTITY);
  const a = m?.attributes || {};
  const sources = Array.isArray(a.source_list) ? a.source_list : [];
  const activeSource = a.source || null;
  const speaker = speakerStatus(status, m);
  const playing = Boolean(speaker.playing);
  const onPi = Boolean(speaker.onPi);
  const [spotifyConnected, setSpotifyConnected] = useSpotifyConnect();
  const configured = isSpotifyConfigured();

  return (
    <Card
      index={index}
      eyebrow="Spotify Connect · Pi speaker"
      title="Guest playback"
      meta={speaker.meta}
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
            background: onPi
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
            {speaker.line}
          </div>
        </div>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: onPi ? "#1db954" : "var(--ink-3)",
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
              <button
                type="button"
                onClick={() => setSpotifyConnected(false)}
                style={_linkBtnStyle}
              >
                Disconnect
              </button>
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
