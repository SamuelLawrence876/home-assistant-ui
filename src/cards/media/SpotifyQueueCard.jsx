import { useState, useEffect, useRef } from "react";
import { isSpotifyConfigured, getQueue } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected, _linkBtnStyle } from "../../cards/media/spotifyShared.jsx";

const EMPTY_QUEUE = { current: null, queue: [] };

/* A failed read is never shown as an empty queue. A failed Refresh keeps the
   tracks already on screen — they were true a moment ago — and says so in the
   meta line instead, the same way the calendar cards do. */
function queueMeta({ loading, failed, empty, count }) {
  if (loading) return "Loading";
  if (failed) {
    if (empty) return "—";
    return count > 0 ? `${count} tracks · may be out of date` : "may be out of date";
  }
  return count > 0 ? `${count} tracks` : null;
}

export function SpotifyQueueCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [queueData, setQueueData] = useState(EMPTY_QUEUE);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { playing, error, play } = useSpotifyPlay();
  // Only the latest read may write: two quick Refreshes can land out of order.
  const seq = useRef(0);

  function load() {
    const mine = ++seq.current;
    setLoading(true);
    getQueue()
      .then((d) => { if (mine === seq.current) { setQueueData(d); setFailed(false); } })
      .catch(() => { if (mine === seq.current) setFailed(true); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }

  useEffect(() => {
    if (!connected) return undefined;
    // A reconnect may be a different account — start from nothing, not the last one's queue.
    setQueueData(EMPTY_QUEUE);
    setFailed(false);
    load();
    return () => { seq.current += 1; };
  }, [connected]);

  const empty = !queueData.current && queueData.queue.length === 0;

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Queue · Spotify" title="Up next">{_notConnected}</Card>;
  }

  return (
    <Card
      index={index}
      eyebrow="Queue · Spotify"
      title="Up next"
      meta={queueMeta({ loading, failed, empty, count: queueData.queue.length })}
      headRight={
        <button type="button" onClick={load} style={_linkBtnStyle}>
          Refresh
        </button>
      }
    >
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {queueData.current && <SpotifyTrackRow item={queueData.current} playing={playing} onPlay={play} label="Now" />}
        {queueData.queue.map((item, i) => (
          <SpotifyTrackRow key={`q${i}-${item.uri}`} item={item} playing={playing} onPlay={play} label={`${i + 1}`} />
        ))}
      </div>
      {!loading && empty &&
        _emptyMsg(failed ? "Queue unavailable — Spotify didn't answer." : "Nothing in the queue — play something first.")}
    </Card>
  );
}
