import { useState, useRef, useEffect } from "react";
import { isSpotifyConfigured, searchTracks } from "../../ha/spotify.js";
import { Card } from "../../components/Card.jsx";
import { useSpotifyConnect, useSpotifyPlay, SpotifyTrackRow, _emptyMsg, _notConnected } from "../../cards/media/spotifyShared.jsx";

export function SpotifySearchCard({ index = 0 }) {
  const [connected] = useSpotifyConnect();
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // A failed search is not an empty one: "no results" would be a claim about Spotify's catalogue.
  const [failed, setFailed] = useState(false);
  const { playing, error, play } = useSpotifyPlay();
  const timer = useRef(null);
  /* Every keystroke — the one that clears the box included — retires whatever
     search is in flight. Only the latest query may write, or a slow older
     answer lands under newer text (or refills a box that was just emptied). */
  const seq = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); seq.current += 1; }, []);

  function handleSearch(q) {
    setQuery(q);
    clearTimeout(timer.current);
    const mine = ++seq.current;
    if (!q.trim()) { setResults([]); setFailed(false); setLoading(false); return; }
    timer.current = setTimeout(() => {
      setLoading(true);
      searchTracks(q)
        .then((r) => { if (mine === seq.current) { setResults(r); setFailed(false); } })
        .catch(() => { if (mine === seq.current) { setResults([]); setFailed(true); } })
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 400);
  }

  if (!isSpotifyConfigured() || !connected) {
    return <Card index={index} eyebrow="Search · Spotify" title="Search">{_notConnected}</Card>;
  }

  return (
    <Card index={index} eyebrow="Search · Spotify" title="Search" meta={loading ? "Loading" : null}>
      <input
        type="text"
        /* A placeholder is not a name: it is only used as one when
           nothing better exists, and it vanishes the moment you type. */
        aria-label="Search Spotify for songs, artists and albums"
        placeholder="Search songs, artists, albums..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        style={{
          background: "var(--glass-bg-2)", border: "1px solid var(--glass-stroke)", borderRadius: 10,
          padding: "10px 12px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--ink)",
          width: "100%", boxSizing: "border-box", marginBottom: 10,
        }}
      />
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#e55", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
        {results.map((item) => (
          <SpotifyTrackRow key={item.uri} item={item} playing={playing} onPlay={play} />
        ))}
      </div>
      {!loading && query && failed && _emptyMsg("Search failed — Spotify didn't answer.")}
      {!loading && query && !failed && results.length === 0 && _emptyMsg(`No results for "${query}"`)}
      {!query && _emptyMsg("Type to search Spotify")}
    </Card>
  );
}
