/* ha/spotify.js owns the token, so it is the one place that can tell the UI
   the token is gone. clearSpotifyToken() — called by Disconnect, by
   socket.js signOut(), by a rejected refresh and by a second 401 — notifies
   every subscriber, and a subscriber that throws can't stop the clear
   (signOut depends on it completing). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearSpotifyToken, onSpotifyTokenCleared, searchTracks } from "../../src/ha/spotify.js";

const TOKEN_KEY = "gh_spotify_token";
const seedToken = () => localStorage.setItem(TOKEN_KEY, JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  expires_at: Date.now() + 3600_000,
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("onSpotifyTokenCleared", () => {
  it("fires on clearSpotifyToken, and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = onSpotifyTokenCleared(fn);
    seedToken();
    clearSpotifyToken();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    off();
    clearSpotifyToken();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener doesn't stop the clear or the other listeners", () => {
    const after = vi.fn();
    const offBad = onSpotifyTokenCleared(() => { throw new Error("boom"); });
    const offGood = onSpotifyTokenCleared(after);
    seedToken();
    expect(() => clearSpotifyToken()).not.toThrow();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(after).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it("fires when an API call's 401 is followed by a rejected refresh", async () => {
    const fn = vi.fn();
    const off = onSpotifyTokenCleared(fn);
    seedToken();
    vi.stubGlobal("fetch", vi.fn(async (url) => (
      String(url).startsWith("https://accounts.spotify.com/")
        ? { ok: false, status: 400, text: async () => "" }
        : { ok: false, status: 401, json: async () => ({}) }
    )));
    await expect(searchTracks("abba")).rejects.toThrow();
    expect(fn).toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    off();
  });

  it("does not fire for a 5xx — the session is still good", async () => {
    const fn = vi.fn();
    const off = onSpotifyTokenCleared(fn);
    seedToken();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(searchTracks("abba")).rejects.toThrow("Spotify 503");
    expect(fn).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).not.toBeNull();
    off();
  });
});
