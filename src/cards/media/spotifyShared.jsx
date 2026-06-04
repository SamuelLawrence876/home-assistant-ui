import { useState, useEffect } from "react";
import { isSpotifyConnected, callbackReady, playUri } from "../../ha/spotify.js";

export function useSpotifyConnect() {
  const [connected, setConnected] = useState(isSpotifyConnected);
  useEffect(() => { callbackReady.then((ok) => { if (ok) setConnected(true); }); }, []);
  return [connected, setConnected];
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

export function useSpotifyPlay() {
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

export function SpotifyTrackRow({ item, playing, onPlay, subtitle, label, keyPrefix }) {
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

export const _emptyMsg = (text) => (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", padding: "8px 4px" }}>{text}</div>
);

export const _notConnected = (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", padding: "8px 4px" }}>
    Connect to Spotify to use this card.
  </div>
);
