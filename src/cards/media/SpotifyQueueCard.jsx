import { useState, useEffect } from "react";
import { isSpotifyConfigured, getQueue } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected } from "../../cards/media/spotifyShared.jsx";

export function SpotifyQueueCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [queueData, setQueueData] = useState({ current: null, queue: [] });
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    getQueue().then(setQueueData).catch(() => setQueueData({ current: null, queue: [] })).finally(() => setLoading(false));
  }, [connected]);

  function refresh() {
    setLoading(true);
    getQueue().then(setQueueData).catch(() => {}).finally(() => setLoading(false));
  }

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Queue · Spotify" title="Up next">{_notConnected}</Card>;
  }

  return (
    <Card
      index={index}
      eyebrow="Queue · Spotify"
      title="Up next"
      meta={loading ? "Loading" : queueData.queue.length > 0 ? `${queueData.queue.length} tracks` : null}
      headRight={
        <span onClick={refresh} style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", cursor: "pointer" }}>
          Refresh
        </span>
      }
    >
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {queueData.current && <SpotifyTrackRow item={queueData.current} playing={playing} onPlay={play} label="Now" />}
        {queueData.queue.map((item, i) => (
          <SpotifyTrackRow key={`q${i}-${item.uri}`} item={item} playing={playing} onPlay={play} label={`${i + 1}`} />
        ))}
      </div>
      {!loading && !queueData.current && queueData.queue.length === 0 && _emptyMsg("Nothing in the queue — play something first.")}
    </Card>
  );
}
