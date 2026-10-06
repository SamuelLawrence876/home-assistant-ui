/* Search, Playlists and Queue on the Media tab. Two rules:
     1. A failed read is not an empty one. "No results", "No playlists found"
        and "Nothing in the queue" are claims about the account; a 429, a 5xx
        or no network gets its own sentence. A failed Queue *refresh* keeps
        what's on screen and says it may be out of date.
     2. Search answers land in query order: a slow older response can't
        overwrite newer results, and clearing the box retires anything in
        flight. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ search: null, playlists: null, queue: null }));

vi.mock("../../src/ha/spotify.js", () => ({
  isSpotifyConfigured: () => true,
  isSpotifyConnected: () => true,
  clearSpotifyToken: () => {},
  onSpotifyTokenCleared: () => () => {},
  callbackReady: Promise.resolve(false),
  playUri: () => Promise.resolve(),
  searchTracks: (q) => h.search(q),
  getPlaylists: () => h.playlists(),
  getQueue: () => h.queue(),
}));

import { SpotifySearchCard } from "../../src/cards/media/SpotifySearchCard.jsx";
import { SpotifyPlaylistsCard } from "../../src/cards/media/SpotifyPlaylistsCard.jsx";
import { SpotifyQueueCard } from "../../src/cards/media/SpotifyQueueCard.jsx";

const track = (name) => ({ name, artist: "Artist", album: "Album", image: null, uri: `spotify:track:${name}` });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const meta = (container) => container.querySelector(".meta")?.textContent;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  h.search = () => Promise.resolve([]);
  h.playlists = () => Promise.resolve([]);
  h.queue = () => Promise.resolve({ current: null, queue: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SpotifySearchCard — answers land in query order", () => {
  function type(value) {
    fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  }

  it("a slow older search can't overwrite newer results", async () => {
    vi.useFakeTimers();
    const pending = {};
    h.search = (q) => { pending[q] = deferred(); return pending[q].promise; };
    render(<SpotifySearchCard />);

    type("tay");
    act(() => { vi.advanceTimersByTime(400); });
    type("taylor swift");
    act(() => { vi.advanceTimersByTime(400); });

    pending["taylor swift"].resolve([track("Love Story")]);
    await flush();
    pending.tay.resolve([track("Tay Result")]);
    await flush();

    expect(screen.getByText("Love Story")).toBeInTheDocument();
    expect(screen.queryByText("Tay Result")).toBeNull();
  });

  it("clearing the box retires a search already in flight", async () => {
    vi.useFakeTimers();
    let pending;
    h.search = () => { pending = deferred(); return pending.promise; };
    render(<SpotifySearchCard />);

    type("abba");
    act(() => { vi.advanceTimersByTime(400); });
    type("");
    pending.resolve([track("Dancing Queen")]);
    await flush();

    expect(screen.queryByText("Dancing Queen")).toBeNull();
    expect(screen.getByText("Type to search Spotify")).toBeInTheDocument();
  });

  it("a failed search says so instead of 'No results'", async () => {
    vi.useFakeTimers();
    h.search = () => Promise.reject(new Error("Spotify 503"));
    render(<SpotifySearchCard />);
    type("abba");
    act(() => { vi.advanceTimersByTime(400); });
    await flush();
    expect(screen.getByText("Search failed — Spotify didn't answer.")).toBeInTheDocument();
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it("an empty answer still says 'No results'", async () => {
    vi.useFakeTimers();
    render(<SpotifySearchCard />);
    type("zzzz");
    act(() => { vi.advanceTimersByTime(400); });
    await flush();
    expect(screen.getByText('No results for "zzzz"')).toBeInTheDocument();
  });
});

describe("SpotifyPlaylistsCard", () => {
  it("a failed load is not 'No playlists found.' / '0'", async () => {
    h.playlists = () => Promise.reject(new Error("Spotify 429"));
    const { container } = render(<SpotifyPlaylistsCard />);
    await flush();
    expect(screen.getByText("Playlists unavailable — Spotify didn't answer.")).toBeInTheDocument();
    expect(screen.queryByText("No playlists found.")).toBeNull();
    expect(meta(container)).toBe("—");
  });

  it("a real empty account still reads 'No playlists found.' with a 0", async () => {
    const { container } = render(<SpotifyPlaylistsCard />);
    await flush();
    expect(screen.getByText("No playlists found.")).toBeInTheDocument();
    expect(meta(container)).toBe("0");
  });
});

describe("SpotifyQueueCard", () => {
  it("a failed first load is not 'Nothing in the queue'", async () => {
    h.queue = () => Promise.reject(new Error("Spotify 502"));
    const { container } = render(<SpotifyQueueCard />);
    await flush();
    expect(screen.getByText("Queue unavailable — Spotify didn't answer.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing in the queue/)).toBeNull();
    expect(meta(container)).toBe("—");
  });

  it("a failed Refresh keeps the queue on screen and flags it as possibly stale", async () => {
    h.queue = () => Promise.resolve({ current: track("Now Song"), queue: [track("Next 1"), track("Next 2")] });
    const { container } = render(<SpotifyQueueCard />);
    await flush();
    expect(meta(container)).toBe("2 tracks");

    h.queue = () => Promise.reject(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();
    expect(screen.getByText("Next 1")).toBeInTheDocument();
    expect(meta(container)).toBe("2 tracks · may be out of date");

    // The next good read clears the caveat.
    h.queue = () => Promise.resolve({ current: null, queue: [track("Fresh")] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();
    expect(meta(container)).toBe("1 tracks");
  });

  it("two quick Refreshes: the later one wins even if the earlier lands last", async () => {
    const pending = [];
    h.queue = () => { const d = deferred(); pending.push(d); return d.promise; };
    render(<SpotifyQueueCard />);
    pending[0].resolve({ current: null, queue: [] });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    pending[2].resolve({ current: null, queue: [track("Newer")] });
    await flush();
    pending[1].resolve({ current: null, queue: [track("Older")] });
    await flush();
    expect(screen.getByText("Newer")).toBeInTheDocument();
    expect(screen.queryByText("Older")).toBeNull();
  });
});
