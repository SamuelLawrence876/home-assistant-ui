import { useState, useEffect } from "react";
import { isSpotifyConfigured, getPlaylists } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected } from "../../cards/media/spotifyShared.jsx";

export function SpotifyPlaylistsCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  // Couldn't read them is not the same sentence as "No playlists found." / "0".
  const [failed, setFailed] = useState(false);
  const { playing, error, play } = useSpotifyPlay();

  useEffect(() => {
    if (!connected) return undefined;
    // A reconnect may be a different account — don't show the last one's list meanwhile.
    let stale = false;
    setPlaylists([]);
    setFailed(false);
    setLoading(true);
    getPlaylists(30)
      .then((p) => { if (!stale) setPlaylists(p); })
      .catch(() => { if (!stale) setFailed(true); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [connected]);

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Playlists · Spotify" title="Playlists">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Playlists · Spotify" title="Playlists" meta={loading ? "Loading" : failed ? "—" : `${playlists.length}`}>
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {playlists.map((item) => (
          // A count Spotify didn't send is unknown, not zero (spotify.js#playlistCount).
          <SpotifyTrackRow key={item.uri} item={item} playing={playing} onPlay={play} subtitle={`${item.tracks ?? "—"} tracks · ${item.owner}`} />
        ))}
      </div>
      {!loading && playlists.length === 0 &&
        _emptyMsg(failed ? "Playlists unavailable — Spotify didn't answer." : "No playlists found.")}
    </Card>
  );
}
