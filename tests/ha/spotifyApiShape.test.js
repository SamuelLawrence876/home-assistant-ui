/* What ha/spotify.js asks Spotify for, and how it reads the answer, under the
   February 2026 Development Mode rules (this app is a personal PKCE client, so
   it is in Development Mode):
     - /search caps `limit` at 10 and answers more with 400 "Invalid limit".
       Every search here asked for 15, so every search failed.
     - the playlist `tracks` object is renamed `items`, and is left out for
       playlists the user doesn't own — so `tracks.total || 0` said "0 tracks"
       for every row. An absent count is null now, not 0. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchTracks, getPlaylists } from "../../src/ha/spotify.js";

const seedToken = () => localStorage.setItem("gh_spotify_token", JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  expires_at: Date.now() + 3600_000,
}));

let urls;
function answer(body) {
  urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => body };
  }));
}

beforeEach(() => {
  seedToken();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const limitOf = (url) => Number(new URL(url).searchParams.get("limit"));

describe("searchTracks", () => {
  it("asks for at most 10 results by default", async () => {
    answer({ tracks: { items: [] } });
    await searchTracks("abba");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/v1/search?");
    expect(limitOf(urls[0])).toBeLessThanOrEqual(10);
    expect(limitOf(urls[0])).toBeGreaterThan(0);
  });

  it("clamps a larger limit to Spotify's cap instead of earning a 400", async () => {
    answer({ tracks: { items: [] } });
    await searchTracks("abba", 50);
    expect(limitOf(urls[0])).toBe(10);
  });

  it("still maps the tracks it gets back", async () => {
    answer({ tracks: { items: [{ name: "SOS", uri: "spotify:track:1", artists: [{ name: "ABBA" }], album: { name: "ABBA", images: [] } }] } });
    expect(await searchTracks("abba")).toEqual([
      { name: "SOS", artist: "ABBA", album: "ABBA", image: null, uri: "spotify:track:1" },
    ]);
  });
});

describe("getPlaylists track counts", () => {
  const playlist = (id, extra) => ({ id, name: id, uri: `spotify:playlist:${id}`, images: [], owner: { display_name: "Sam" }, ...extra });

  it("reads the new `items.total`, the old `tracks.total`, and null when neither is sent", async () => {
    answer({
      items: [
        playlist("new-shape", { items: { href: "x", total: 12 } }),
        playlist("old-shape", { tracks: { href: "x", total: 7 } }),
        playlist("not-mine"),
        playlist("empty", { items: { href: "x", total: 0 } }),
        playlist("garbage", { items: { total: "lots" } }),
      ],
    });
    const counts = Object.fromEntries((await getPlaylists(30)).map((p) => [p.id, p.tracks]));
    expect(counts).toEqual({ "new-shape": 12, "old-shape": 7, "not-mine": null, empty: 0, garbage: null });
  });
});
