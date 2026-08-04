import { useState, useEffect, useSyncExternalStore } from "react";
import { isSpotifyConnected, clearSpotifyToken, callbackReady, playUri } from "../../ha/spotify.js";

/* ----------------------------------------------------------------
   Spotify auth — one module-level store, not per-component state.

   The token lives in localStorage and ha/spotify.js drops it from several
   places (Disconnect, a failed refresh, a 401 mid-session). A useState copy
   per card means only the card that noticed re-gates; Search / Playlists /
   Queue / Recent carry on rendering against a token that is already gone.
   Every consumer subscribes here instead, and the snapshot is re-read from
   the token itself rather than mirrored, so it can't drift from the truth.

   This properly belongs beside the token in ha/spotify.js; it sits here
   because cards/ owns this file.
   ----------------------------------------------------------------*/
const authListeners = new Set();
let authSnapshot = isSpotifyConnected();

function subscribeSpotifyAuth(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/* Re-read the token and wake every subscriber if it changed. Safe to call
   speculatively — after any Spotify call that may have hit a 401, say. */
export function syncSpotifyAuth() {
  const next = isSpotifyConnected();
  if (next === authSnapshot) return;
  authSnapshot = next;
  authListeners.forEach((fn) => fn());
}

export function setSpotifyConnected(next) {
  if (!next) clearSpotifyToken(); // idempotent: spotify.js may have cleared it already
  syncSpotifyAuth();
}

// Another tab connecting or disconnecting writes the same key.
window.addEventListener("storage", syncSpotifyAuth);

export function useSpotifyConnect() {
  const connected = useSyncExternalStore(subscribeSpotifyAuth, () => authSnapshot);
  useEffect(() => { callbackReady.then((ok) => { if (ok) setSpotifyConnected(true); }); }, []);
  return [connected, setSpotifyConnected];
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

/* Text-only card action ("Disconnect", "Refresh"). A real <button> so it takes
   a tab stop and fires on Enter/Space; the inline reset keeps it looking like
   the mono caption it replaced, without needing a new rule in styles/. */
export const _linkBtnStyle = {
  background: "none",
  border: "none",
  // A 9px caption is a 12px line box on its own — pad it out to the 24px minimum
  // target, then pull the padding back out of the layout so the label still sits
  // flush with the card edge it is aligned to.
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "0 8px",
  margin: "0 -8px",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  cursor: "pointer",
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
  async function play(uri) {
    setPlaying(uri);
    setError(null);
    try { await playUri(uri); }
    catch (e) {
      // A 401 or a failed refresh inside spotify.js has already binned the
      // token — re-read it so every card re-gates, not just this one.
      syncSpotifyAuth();
      if (e.message?.includes("expired")) setError("Session expired");
      else setError("Open Spotify on a device first");
    }
    setTimeout(() => setPlaying(null), 2000);
  }
  return { playing, error, play };
}

export function SpotifyTrackRow({ item, playing, onPlay, subtitle, label }) {
  const uri = item.uri;
  const isPlaying = playing === uri;
  const img = item.image || null;
  const sub = subtitle || `${item.artist} · ${item.album}`;
  return (
    <button
      type="button"
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
      {/* Decorative: the button already reads out the track, and a bare
          "▶" is announced as "black right-pointing triangle". */}
      <span aria-hidden="true" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", flexShrink: 0 }}>
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
