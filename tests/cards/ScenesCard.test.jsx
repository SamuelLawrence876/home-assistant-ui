/* Quick scenes. A tile is one tap, one scene: the second tap of a double-tap
   (or of an impatient re-tap while the call is slow) is not a new decision.
   Moments used to go through script.toggle with no in-flight guard, so a
   double-tap on Good Morning started the sunrise and cancelled it straight
   away, and two taps on All off under latency cancelled the hard kill. Now a
   tile ignores taps while its call is in flight or its firing sweep shows,
   and a moment is only ever stopped by a tap on the lit "Running · tap to
   stop" tile — script.turn_on / turn_off, never a blind toggle.

   Round 3b: while a tile ignores taps it says "Starting…" / "Stopping…" /
   "Undoing…" rather than the "tap to stop" it would drop, and a fast failure
   keeps the guard up for the rest of the double-tap window. With HA not
   vouching for a tile's state (not connected, signed out, entity missing)
   the tile claims nothing and takes no taps, and the card isn't "Idle". */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const states = {};
// `status` is the connection-level answer ("loading" until HA has answered);
// once "ready", each entity's own status is derived the way useEntity.js does.
const status = { current: "ready" };
const conn = { current: "ready" };
const calls = [];
const outcome = { next: () => Promise.resolve() };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => {
    const e = states[id];
    const s = status.current !== "ready" ? status.current
      : !e ? "not_found"
      : e.state === "unavailable" || e.state === "unknown" ? "unavailable"
      : "ready";
    return { entity: e, status: s };
  },
  useEntities: (ids) => Object.fromEntries(ids.map((id) => [id, states[id]])),
  useConnectionStatus: () => conn.current,
  // Nothing held back here: tests/ha/round4c-loading.test.jsx runs the card
  // over the real socket for that.
  useLoadingIds: () => [],
  useSnapshotReady: () => status.current !== "loading",
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service} ${data.entity_id}`);
    return outcome.next();
  },
}));

const { ScenesCard } = await import("../../src/cards/overview/ScenesCard.jsx");

const tile = (name) => screen.getByRole("button", { name: new RegExp(name) });
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  outcome.next = () => Promise.resolve();
  status.current = "ready";
  conn.current = "ready";
  for (const k of Object.keys(states)) delete states[k];
  // Every dependency up, every script idle, every mode off.
  for (const id of [
    "light.smartbulb_5c_h", "light.smart_humidifier_2403124281557464110148e1e9eff28f",
    "light.smart_humidifier_2403124281557464110148e1e9eff28f_dnd",
    "select.smart_humidifier_2403124281557464110148e1e9eff28f_spray",
    "light.x1c_00m09d522400385_chamber_light", "switch.x1c_00m09d522400385_camera",
    "switch.sambox360_plug", "light.divoom_pixoo_64_light", "fan.core_300s_series",
  ]) states[id] = { entity_id: id, state: "on", attributes: {} };
  for (const s of ["gh_good_morning", "gh_work_done", "gh_all_off"]) states[`script.${s}`] = { state: "off", attributes: {} };
  for (const m of ["focus", "movie", "leaving", "goodnight"]) states[`input_boolean.gh_mode_${m}`] = { state: "off", attributes: {} };
});
afterEach(() => vi.useRealTimers());

describe("ScenesCard — a double-tap runs a scene once", () => {
  it("double-clicking an idle Good Morning starts it once, and never toggles it back off", async () => {
    render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_good_morning"]);
  });

  it("two taps on All off while the first call is still in flight send one call", async () => {
    const d = deferred();
    outcome.next = () => d.promise;
    render(<ScenesCard />);
    fireEvent.click(tile("All off"));
    await settle(1000); // slow link: still waiting
    fireEvent.click(tile("All off"));
    await act(async () => d.resolve());
    expect(calls).toEqual(["script.turn_on script.gh_all_off"]);
  });

  it("a tap during the firing sweep is still ignored, even once HA says the script is running", async () => {
    const { rerender } = render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    states["script.gh_good_morning"] = { state: "on", attributes: {} }; // HA: running
    rerender(<ScenesCard />);
    fireEvent.click(tile("Good Morning")); // the lagging second tap
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_good_morning"]);
  });

  it("double-tapping a mode enters it once rather than entering and undoing it", async () => {
    const { rerender } = render(<ScenesCard />);
    fireEvent.click(tile("Focus"));
    await settle(0);
    states["input_boolean.gh_mode_focus"] = { state: "on", attributes: {} };
    rerender(<ScenesCard />);
    fireEvent.click(tile("Focus"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_focus"]);
  });

  it("guards each tile on its own: another tile still fires meanwhile", async () => {
    outcome.next = () => new Promise(() => {}); // both stay in flight
    render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    fireEvent.click(tile("Movie"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_good_morning", "script.turn_on script.gh_movie"]);
  });
});

describe("ScenesCard — only a deliberate tap stops a running moment", () => {
  it("a tap on a lit, running moment stops it with turn_off", async () => {
    states["script.gh_good_morning"] = { state: "on", attributes: {} };
    render(<ScenesCard />);
    expect(tile("Good Morning")).toHaveTextContent("Running · tap to stop");
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    expect(calls).toEqual(["script.turn_off script.gh_good_morning"]);
  });

  it("once the sweep is over, the next tap is a new decision", async () => {
    const { rerender } = render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    states["script.gh_good_morning"] = { state: "on", attributes: {} };
    rerender(<ScenesCard />);
    await settle(1200);
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_good_morning", "script.turn_off script.gh_good_morning"]);
  });

  it("a moment HA hasn't shown running yet is started again, not cancelled", async () => {
    // The sweep has ended but the script's "on" hasn't arrived: the tile
    // still reads idle, so the tap means "run it" — a toggle would have
    // stopped the run that is in fact under way.
    render(<ScenesCard />);
    fireEvent.click(tile("All off"));
    await settle(1200);
    fireEvent.click(tile("All off"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_all_off", "script.turn_on script.gh_all_off"]);
  });
});

describe("ScenesCard — a failed call", () => {
  it("drops the sweep at once, and frees the tile for a retry once the double-tap window closes", async () => {
    outcome.next = () => Promise.reject(new Error("Tuya cloud timeout"));
    const { container } = render(<ScenesCard />);
    fireEvent.click(tile("All off"));
    await settle(0);
    expect(container.querySelector(".scene.firing")).toBeNull();
    await settle(400);
    outcome.next = () => Promise.resolve();
    fireEvent.click(tile("All off"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_all_off", "script.turn_on script.gh_all_off"]);
  });

  it("a fast failure still swallows the double-tap's second half — one call, one error toast", async () => {
    // Signed out, the call rejects at once with "Not connected", and the
    // second tap used to send it again.
    outcome.next = () => Promise.reject(new Error("Not connected"));
    render(<ScenesCard />);
    fireEvent.click(tile("Focus"));
    await settle(0); // the rejection has landed
    fireEvent.click(tile("Focus")); // the double-tap's second half, ~150ms on
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_focus"]);
  });

  it("says it failed while it is still ignoring taps, then goes back to normal", async () => {
    outcome.next = () => Promise.reject(new Error("Tuya cloud timeout"));
    render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    expect(tile("Good Morning")).toHaveTextContent("Failed");
    expect(tile("Good Morning")).not.toHaveTextContent("Starting");
    await settle(400);
    expect(tile("Good Morning")).toHaveTextContent("5-min sunrise");
  });

  it("one tile's sweep ending doesn't cut another tile's short", async () => {
    const { container } = render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    await settle(600);
    fireEvent.click(tile("Movie"));
    await settle(600); // Good Morning's 1100ms is up; Movie's is not
    expect(container.querySelector(".scene.movie.firing")).not.toBeNull();
  });
});

describe("ScenesCard — a busy tile doesn't invite the tap it will drop", () => {
  it("reads 'Starting…', not 'Running · tap to stop', while HA's 'on' beats the call result back", async () => {
    // Under latency the state push lands first; the tile used to read
    // "Running · tap to stop" for the round trip + 1.1s and ignore that tap.
    const d = deferred();
    outcome.next = () => d.promise;
    const { rerender } = render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    await settle(100);
    states["script.gh_good_morning"] = { state: "on", attributes: {} };
    rerender(<ScenesCard />);
    expect(tile("Good Morning")).toHaveTextContent("Starting…");
    expect(tile("Good Morning")).not.toHaveTextContent(/tap to/);
    await settle(2400);
    await act(async () => d.resolve());
    await settle(1100);
    expect(tile("Good Morning")).toHaveTextContent("Running · tap to stop");
    fireEvent.click(tile("Good Morning"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_good_morning", "script.turn_off script.gh_good_morning"]);
  });

  it("a mode reads 'Starting…' until it will take the undo tap", async () => {
    const { rerender } = render(<ScenesCard />);
    fireEvent.click(tile("Focus"));
    await settle(0);
    states["input_boolean.gh_mode_focus"] = { state: "on", attributes: {} };
    rerender(<ScenesCard />);
    expect(tile("Focus")).toHaveTextContent("Starting…");
    await settle(1100);
    expect(tile("Focus")).toHaveTextContent("On · tap to undo");
  });

  it("names the stop and the undo for what they are", async () => {
    outcome.next = () => new Promise(() => {});
    states["script.gh_good_morning"] = { state: "on", attributes: {} };
    states["input_boolean.gh_mode_movie"] = { state: "on", attributes: {} };
    render(<ScenesCard />);
    fireEvent.click(tile("Good Morning"));
    fireEvent.click(tile("Movie"));
    await settle(0);
    expect(tile("Good Morning")).toHaveTextContent("Stopping…");
    expect(tile("Movie")).toHaveTextContent("Undoing…");
  });
});

describe("ScenesCard — not connected, signed out, or a missing tile entity", () => {
  it("a mode that was on claims nothing and takes no taps once the connection drops", async () => {
    states["input_boolean.gh_mode_focus"] = { state: "on", attributes: {} };
    const { container, rerender } = render(<ScenesCard />);
    expect(tile("Focus")).toHaveTextContent("On · tap to undo");

    status.current = "loading";
    conn.current = "disconnected";
    rerender(<ScenesCard />);
    const focus = tile("Focus");
    expect(focus).not.toHaveTextContent(/On · tap to undo/);
    expect(focus.querySelector(".scene-sub").textContent).toBe("—");
    expect(focus).not.toHaveClass("active");
    expect(focus).not.toHaveAttribute("aria-pressed");
    expect(focus).toHaveAttribute("aria-disabled", "true");
    expect(focus).toHaveAccessibleName("Focus — state unknown");
    expect(container.querySelector(".scene.focus .scene-dot")).toBeNull();
    expect(container.querySelector(".meta").textContent).toBe("Not connected");
    fireEvent.click(focus);
    await settle(0);
    expect(calls).toEqual([]);
  });

  it("keeps a focused tile focusable through the drop (aria-disabled, not disabled)", () => {
    const { rerender } = render(<ScenesCard />);
    tile("Movie").focus();
    status.current = "loading";
    conn.current = "disconnected";
    rerender(<ScenesCard />);
    expect(tile("Movie")).not.toBeDisabled();
    expect(document.activeElement).toBe(tile("Movie"));
  });

  it("signed out: every tile is inert and a double-tap sends nothing", async () => {
    status.current = "loading";
    conn.current = "disconnected";
    const { container } = render(<ScenesCard />);
    for (const b of container.querySelectorAll(".scene")) {
      expect(b).toHaveAttribute("aria-disabled", "true");
      expect(b.querySelector(".scene-sub").textContent).toBe("—");
    }
    fireEvent.click(tile("Focus"));
    fireEvent.click(tile("Focus"));
    await settle(0);
    expect(calls).toEqual([]);
  });

  it("while the first snapshot is in flight the card says '—', not 'Not connected' or 'Idle'", () => {
    status.current = "loading";
    conn.current = "ready";
    const { container } = render(<ScenesCard />);
    expect(container.querySelector(".meta").textContent).toBe("—");
  });

  it("a tile whose mode boolean is missing from HA says so and takes no taps", async () => {
    delete states["input_boolean.gh_mode_leaving"];
    render(<ScenesCard />);
    const leaving = tile("Leaving");
    expect(leaving.querySelector(".scene-sub").textContent).toBe("Unavailable");
    expect(leaving).toHaveAttribute("aria-disabled", "true");
    expect(leaving).toHaveAccessibleName("Leaving — unavailable");
    fireEvent.click(leaving);
    await settle(0);
    expect(calls).toEqual([]);
    // The others are unaffected.
    expect(tile("Movie")).not.toHaveAttribute("aria-disabled");
  });
});

describe("ScenesCard — mock mode", () => {
  it("renders all seven tiles, inert and claiming nothing, with no NaN", () => {
    status.current = "loading";
    conn.current = "disconnected";
    for (const k of Object.keys(states)) delete states[k];
    const { container } = render(<ScenesCard />);
    expect(container.querySelectorAll(".scene")).toHaveLength(7);
    expect(container.querySelectorAll('.scene[aria-disabled="true"]')).toHaveLength(7);
    expect(container.querySelector(".meta")?.textContent).toBe("Not connected");
    expect(container.textContent).not.toMatch(/NaN|undefined|offline|Idle|tap to/);
  });
});
