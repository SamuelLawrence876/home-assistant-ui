/* Quick scenes. A tile is one tap, one scene: the second tap of a double-tap
   (or of an impatient re-tap while the call is slow) is not a new decision.
   Moments used to go through script.toggle with no in-flight guard, so a
   double-tap on Good Morning started the sunrise and cancelled it straight
   away, and two taps on All off under latency cancelled the hard kill. Now a
   tile ignores taps while its call is in flight or its firing sweep shows,
   and a moment is only ever stopped by a tap on the lit "Running · tap to
   stop" tile — script.turn_on / turn_off, never a blind toggle. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const states = {};
const status = { current: "ready" };
const calls = [];
const outcome = { next: () => Promise.resolve() };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => ({ entity: states[id], status: status.current }),
  useEntities: (ids) => Object.fromEntries(ids.map((id) => [id, states[id]])),
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
  it("drops the sweep and the guard at once, so a retry goes through", async () => {
    outcome.next = () => Promise.reject(new Error("Tuya cloud timeout"));
    const { container } = render(<ScenesCard />);
    fireEvent.click(tile("All off"));
    await settle(0);
    expect(container.querySelector(".scene.firing")).toBeNull();
    outcome.next = () => Promise.resolve();
    fireEvent.click(tile("All off"));
    await settle(0);
    expect(calls).toEqual(["script.turn_on script.gh_all_off", "script.turn_on script.gh_all_off"]);
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

describe("ScenesCard — mock mode", () => {
  it("renders every tile with its own subtitle while HA is still connecting", () => {
    status.current = "loading";
    for (const k of Object.keys(states)) delete states[k];
    const { container } = render(<ScenesCard />);
    expect(container.querySelectorAll(".scene")).toHaveLength(7);
    expect(container.querySelector(".meta")?.textContent).toBe("Idle");
    expect(container.textContent).not.toMatch(/NaN|undefined|offline/);
  });
});
