/* The Overview tab's compact Spotify card — same entity and the same failure
   modes as the Media tab's hero, on the default tab. HA silently skips a
   service call to an unavailable entity, so the controls must be disabled
   there, the meta must not say "Idle" for a player it can't see, and the
   volume commits on the native change event (assistive tech fires no pointer
   or key events). */
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

import { MediaCard } from "../../src/cards/media/MediaCard.jsx";

const ready = (state, attributes = {}) => ({ entity: { state, attributes }, status: "ready" });
const unavailable = () => ({ entity: { state: "unavailable", attributes: {} }, status: "unavailable" });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const meta = (container) => container.querySelector(".meta")?.textContent;
const slider = () => screen.getByRole("slider", { name: "Volume" });

beforeEach(() => {
  fixtures.np = undefined;
  calls.length = 0;
  reject = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MediaCard — meta only claims what HA said", () => {
  it("loading reads '—', not 'Idle'", () => {
    const { container } = render(<MediaCard />);
    expect(meta(container)).toBe("—");
  });

  it("unavailable reads 'Unavailable' and the body doesn't say 'Nothing playing'", () => {
    fixtures.np = unavailable();
    const { container } = render(<MediaCard />);
    expect(meta(container)).toBe("Unavailable");
    expect(container.textContent).not.toMatch(/Nothing playing|Idle/);
  });

  it("ready: Idle / Playing / Paused as before", () => {
    fixtures.np = ready("idle");
    const idle = render(<MediaCard />);
    expect(meta(idle.container)).toBe("Idle");
    expect(idle.container.textContent).toContain("Nothing playing");
    idle.unmount();

    fixtures.np = ready("playing", { media_title: "Song", media_artist: "Artist" });
    const playing = render(<MediaCard />);
    expect(meta(playing.container)).toBe("Playing");
    playing.unmount();

    fixtures.np = ready("paused", { media_title: "Song" });
    expect(meta(render(<MediaCard />).container)).toBe("Paused");
  });
});

describe("MediaCard — an unavailable player can't be driven", () => {
  it("disables play and volume; Play doesn't flip to Pause", () => {
    fixtures.np = unavailable();
    render(<MediaCard />);
    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();
    expect(slider()).toBeDisabled();
    fireEvent.click(play);
    expect(calls).toEqual([]);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows volume as unknown, not 0%", () => {
    fixtures.np = unavailable();
    const { container } = render(<MediaCard />);
    expect(container.textContent).not.toContain("0%");
    expect(slider().nextElementSibling.textContent).toBe("—");
    expect(slider()).toHaveAttribute("aria-valuetext", "Unknown");
  });
});

describe("MediaCard — volume", () => {
  it("an assistive-tech adjustment (input + change only) reaches HA", () => {
    vi.useFakeTimers();
    fixtures.np = ready("playing", { volume_level: 0.5, media_duration: 200 });
    render(<MediaCard />);
    fireEvent.input(slider(), { target: { value: "20" } });
    fireEvent.change(slider(), { target: { value: "20" } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(calls.map((c) => `${c.call} ${c.data.volume_level}`)).toEqual(["media_player.volume_set 0.2"]);
  });

  it("a rejected volume_set falls back to HA's level", async () => {
    vi.useFakeTimers();
    reject = true;
    fixtures.np = ready("paused", { volume_level: 0.5 });
    render(<MediaCard />);
    fireEvent.change(slider(), { target: { value: "90" } });
    act(() => { vi.advanceTimersByTime(300); });
    await flush();
    expect(slider().nextElementSibling.textContent).toBe("50%");
  });
});
