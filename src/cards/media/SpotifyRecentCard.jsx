import { useState, useEffect } from "react";
import { isSpotifyConfigured, getRecentlyPlayed } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected } from "../../cards/media/spotifyShared.jsx";

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
