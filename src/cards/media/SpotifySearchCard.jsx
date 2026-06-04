import { useState, useRef } from "react";
import { isSpotifyConfigured, searchTracks } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected } from "../../cards/media/spotifyShared.jsx";

export function SpotifySearchCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const { playing, error, play } = useSpotifyPlay();
  const timer = useRef(null);

  function handleSearch(q) {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(() => {
      setLoading(true);
      searchTracks(q).then(setResults).catch(() => setResults([])).finally(() => setLoading(false));
    }, 400);
  }

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Search · Spotify" title="Search">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Search · Spotify" title="Search" meta={loading ? "Loading" : null}>
      <input
        type="text"
        placeholder="Search songs, artists, albums..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        style={{
          background: "var(--glass-bg-2)", border: "1px solid var(--glass-stroke)", borderRadius: 10,
          padding: "10px 12px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--ink)",
          outline: "none", width: "100%", boxSizing: "border-box", marginBottom: 10,
        }}
      />
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {results.map((item) => (
          <SpotifyTrackRow key={item.uri} item={item} playing={playing} onPlay={play} />
        ))}
      </div>
      {!loading && query && results.length === 0 && _emptyMsg(`No results for "${query}"`)}
      {!query && _emptyMsg("Type to search Spotify")}
    </Card>
  );
}
