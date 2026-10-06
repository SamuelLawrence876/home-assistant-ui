/* The Media tab's now-playing hero. In production the HA Spotify integration
   is in setup_retry, so "unavailable" is the state people actually see — and
   HA silently skips a service call to an unavailable entity (it resolves, no
   error), so an optimistic control there never reverts. These tests pin:
   no Playing/Paused/Idle claim unless the player is ready; controls disabled
   when it isn't; a missing volume is "—", not 0%; the volume commits on the
   native change event (what assistive tech fires); and a rejected volume or
   seek falls back to what HA last said. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixtures = { np: undefined };
const calls = [];
let reject = false;

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixtures.np ?? { entity: null, status: "loading" },
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push({ call: `${domain}.${service}`, data });
    return reject ? Promise.reject(new Error("nope")) : Promise.resolve();
  },
}));

import { NowPlayingHero } from "../../src/cards/media/NowPlayingHero.jsx";

const ready = (state, attributes = {}) => ({ entity: { state, attributes }, status: "ready" });
const unavailable = () => ({ entity: { state: "unavailable", attributes: {} }, status: "unavailable" });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const header = (container) => ({
  eyebrow: container.querySelector(".eyebrow")?.textContent,
  title: container.querySelector("h2")?.textContent,
  meta: container.querySelector(".meta")?.textContent,
});
const slider = () => screen.getByRole("slider", { name: "Volume" });

beforeEach(() => {
  fixtures.np = undefined;
  calls.length = 0;
  reject = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NowPlayingHero — header only claims what HA said", () => {
  it("loading: no listening claim, em-dash meta", () => {
    const { container } = render(<NowPlayingHero />);
    expect(header(container)).toEqual({ eyebrow: "Spotify", title: "Now playing", meta: "—" });
  });

  it("unavailable: says Unavailable, not 'Nothing playing · Idle'", () => {
    fixtures.np = unavailable();
    const { container } = render(<NowPlayingHero />);
    const h = header(container);
    expect(h.meta).toBe("Unavailable");
    expect(h.title).toBe("Now playing");
    expect(container.textContent).not.toMatch(/Nothing playing|Idle|Currently listening|Paused/);
  });

  it("not_found reads the same as unavailable", () => {
    fixtures.np = { entity: null, status: "not_found" };
    const { container } = render(<NowPlayingHero />);
    expect(header(container).meta).toBe("Unavailable");
  });

  it("ready + playing / paused / idle", () => {
    fixtures.np = ready("playing", { source: "Sam's iPhone", media_title: "Song" });
    const { container, unmount } = render(<NowPlayingHero />);
    expect(header(container)).toEqual({
      eyebrow: "Now playing · Sam's iPhone",
      title: "Currently listening",
      meta: "Playing",
    });
    unmount();

    fixtures.np = ready("paused", { media_title: "Song" });
    const paused = render(<NowPlayingHero />);
    expect(header(paused.container).meta).toBe("Paused");
    paused.unmount();

    fixtures.np = ready("idle");
    const idle = render(<NowPlayingHero />);
    expect(header(idle.container)).toMatchObject({ title: "Nothing playing", meta: "Idle" });
  });
});

describe("NowPlayingHero — an unavailable player can't be driven", () => {
  it("disables play, seek and volume, and sends nothing", () => {
    fixtures.np = unavailable();
    render(<NowPlayingHero />);
    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward 15 seconds" })).toBeDisabled();
    expect(slider()).toBeDisabled();
    fireEvent.click(play);
    expect(calls).toEqual([]);
    // The bug: Play flipped to Pause and stayed there.
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows volume as unknown, not a made-up 0%", () => {
    fixtures.np = unavailable();
    const { container } = render(<NowPlayingHero />);
    expect(container.textContent).not.toContain("0%");
    expect(slider()).toHaveAttribute("aria-valuetext", "Unknown");
    expect(slider().nextElementSibling.textContent).toBe("—");
  });

  it("never renders a stray ' · ' for a track it doesn't know", () => {
    fixtures.np = unavailable();
    const { container } = render(<NowPlayingHero />);
    expect(container.textContent).not.toContain(" · ");
  });

  it("clears a known volume when the player drops out", () => {
    fixtures.np = ready("paused", { volume_level: 0.4 });
    const { rerender } = render(<NowPlayingHero />);
    expect(slider().nextElementSibling.textContent).toBe("40%");
    fixtures.np = unavailable();
    rerender(<NowPlayingHero />);
    expect(slider().nextElementSibling.textContent).toBe("—");
    expect(slider()).toBeDisabled();
  });
});

describe("NowPlayingHero — volume commits on the native change event", () => {
  it("an assistive-tech adjustment (input + change, no pointer or key) reaches HA", () => {
    vi.useFakeTimers();
    fixtures.np = ready("playing", { volume_level: 0.3, media_duration: 200 });
    render(<NowPlayingHero />);
    fireEvent.input(slider(), { target: { value: "60" } });
    fireEvent.change(slider(), { target: { value: "60" } });
    expect(slider().nextElementSibling.textContent).toBe("60%");
    act(() => { vi.advanceTimersByTime(300); });
    expect(calls).toEqual([
      { call: "media_player.volume_set", data: { entity_id: "media_player.spotify_samuel_lawrence", volume_level: 0.6 } },
    ]);
  });

  it("a held arrow key's per-step changes become one volume_set", () => {
    vi.useFakeTimers();
    fixtures.np = ready("paused", { volume_level: 0.3 });
    render(<NowPlayingHero />);
    for (let v = 31; v <= 40; v++) {
      fireEvent.change(slider(), { target: { value: String(v) } });
      act(() => { vi.advanceTimersByTime(30); });
    }
    act(() => { vi.advanceTimersByTime(300); });
    expect(calls.map((c) => c.data.volume_level)).toEqual([0.4]);
  });

  it("tabbing past the slider sends nothing", () => {
    vi.useFakeTimers();
    fixtures.np = ready("paused", { volume_level: 0.3 });
    render(<NowPlayingHero />);
    fireEvent.keyUp(slider(), { key: "Tab" });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toEqual([]);
  });

  it("a change still pending when the card unmounts is sent, not dropped", () => {
    vi.useFakeTimers();
    fixtures.np = ready("paused", { volume_level: 0.3 });
    const { unmount } = render(<NowPlayingHero />);
    fireEvent.change(slider(), { target: { value: "70" } });
    unmount();
    expect(calls.map((c) => c.data.volume_level)).toEqual([0.7]);
  });
});

describe("NowPlayingHero — a rejected call falls back to HA's value", () => {
  it("volume: the slider returns to HA's level, not the value HA refused", async () => {
    vi.useFakeTimers();
    reject = true;
    fixtures.np = ready("paused", { volume_level: 0.3 });
    render(<NowPlayingHero />);
    fireEvent.change(slider(), { target: { value: "80" } });
    act(() => { vi.advanceTimersByTime(300); });
    await flush();
    expect(slider().nextElementSibling.textContent).toBe("30%");
  });

  it("seek: the timeline returns to HA's position", async () => {
    reject = true;
    fixtures.np = ready("paused", { media_position: 100, media_duration: 200 });
    const { container } = render(<NowPlayingHero />);
    const times = () => container.querySelector(".nowplaying-controls").previousElementSibling.textContent;
    expect(times()).toContain("1:40");
    fireEvent.click(screen.getByRole("button", { name: "Forward 15 seconds" }));
    expect(calls[0].call).toBe("media_player.media_seek");
    await flush();
    expect(times()).toContain("1:40");
    expect(times()).not.toContain("1:55");
  });
});
