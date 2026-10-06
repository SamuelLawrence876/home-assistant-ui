/* End to end through the real ha/spotify.js: when a Playlists / Queue /
   Search call loses the token (a 401 whose refresh is rejected), every
   Spotify card re-gates to the connect prompt — not just a card whose own
   code remembered to re-check. Before, only play() re-read the token, so
   the list cards kept rendering as connected against a token that was gone.
   Only isSpotifyConfigured is overridden (no client id in the test env). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../src/ha/spotify.js", async (importOriginal) => ({
  ...(await importOriginal()),
  isSpotifyConfigured: () => true,
}));

import { syncSpotifyAuth } from "../../src/cards/media/spotifyShared.jsx";
import { SpotifyPlaylistsCard } from "../../src/cards/media/SpotifyPlaylistsCard.jsx";
import { SpotifyQueueCard } from "../../src/cards/media/SpotifyQueueCard.jsx";
import { SpotifySearchCard } from "../../src/cards/media/SpotifySearchCard.jsx";

const TOKEN_KEY = "gh_spotify_token";
const PROMPT = "Connect to Spotify to use this card.";

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
  }));
  syncSpotifyAuth();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Spotify cards re-gate together when the token is dropped", () => {
  it("a 401 + rejected refresh inside a list call re-gates all three cards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (
      String(url).startsWith("https://accounts.spotify.com/")
        ? { ok: false, status: 400, text: async () => "" }
        : { ok: false, status: 401, json: async () => ({}) }
    )));
    render(
      <>
        <SpotifyPlaylistsCard />
        <SpotifyQueueCard />
        <SpotifySearchCard />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText(PROMPT)).toHaveLength(3));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("a 503 keeps the session: the cards stay connected and say Spotify didn't answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    render(<SpotifyPlaylistsCard />);
    await waitFor(() =>
      expect(screen.getByText("Playlists unavailable — Spotify didn't answer.")).toBeInTheDocument());
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).not.toBeNull();
  });
});
