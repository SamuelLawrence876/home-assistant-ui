/* Govee H713B heater card.

   The heater is driven by two fire-and-forget cloud scripts; the only
   read-back is sensor.govee_heater_power ('on' | 'off' | 'error'), with
   sensor.govee_heater_link for reachability and a 2 h auto-off timer. The
   card used to keep power in local state that started at false, so every
   mount said "Off" and the dial said "Unplugged" whatever the heater was
   doing. These tests pin: power comes only from the sensor; anything else
   is unknown, never "Off"; a press is shown as waiting, not as the new
   state, and the wait ends when the sensor reports or the window expires;
   and there is no target-temperature control, because nothing delivers it. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    status: "ready",
    reset() {
      h.states.clear();
      h.subs.clear();
      h.status = "ready";
    },
    set(id, state) {
      h.states.set(id, state);
      (h.subs.get(id) || new Set()).forEach((cb) => cb(state));
    },
  };
  return h;
});
const calls = [];
let failCalls = false;

vi.mock("../../src/ha/socket.js", () => ({
  getEntity: (id) => fake.states.get(id),
  getAllStates: () => [...fake.states.values()],
  subscribe: (id, cb) => {
    if (!fake.subs.has(id)) fake.subs.set(id, new Set());
    fake.subs.get(id).add(cb);
    if (fake.states.has(id)) cb(fake.states.get(id));
    return () => fake.subs.get(id)?.delete(cb);
  },
  onConnectionChange: (cb) => { cb(fake.status); return () => {}; },
  onStatesChanged: () => () => {},
  onSnapshotReady: (cb) => { cb(); return () => {}; },
  hasSnapshot: () => fake.status === "ready",
  getConnectionStatus: () => fake.status,
  waitForConnection: () => Promise.reject(new Error("not used")),
  sendWsMessage: () => Promise.reject(new Error("not used")),
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service}${data?.entity_id ? ` ${data.entity_id}` : ""}`);
    return failCalls ? Promise.reject(new Error("nope")) : Promise.resolve();
  },
}));

const { HeaterCard } = await import("../../src/cards/climate/HeaterCard.jsx");

const POWER = "sensor.govee_heater_power";
const LINK = "sensor.govee_heater_link";
const TIMER = "timer.govee_heater_max_runtime";
let stamp = 0;
const reading = (state, attributes = {}) => ({ state, attributes, last_updated: `2026-10-06T09:00:${String(stamp++ % 60).padStart(2, "0")}Z` });

const meta = (container) => container.querySelector(".card .meta").textContent;
const dial = (container) => container.querySelector(".heater-dial-inner .val").textContent;
const act_ = (container) => container.querySelector(".heater-dial-inner .act").textContent;
const flush = () => act(() => Promise.resolve());

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  failCalls = false;
  fake.set("sensor.h5075_4fb6_temperature", reading("19.4"));
  fake.set("sensor.h5075_4fb6_humidity", reading("48"));
});
afterEach(() => vi.useRealTimers());

describe("HeaterCard power state", () => {
  it("binds power to sensor.govee_heater_power", () => {
    fake.set(POWER, reading("on"));
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("On");
    expect(dial(container)).toBe("On");
  });

  it("says power is unknown — never 'Off' or 'Unplugged' — when the sensor does not exist yet", () => {
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("Power unknown");
    expect(dial(container)).toBe("—");
    expect(container.textContent).not.toMatch(/Unplugged|\bOff\b/);
    expect(screen.getByRole("img", { name: `${POWER} not found` })).toBeTruthy();
  });

  it("treats Govee's 'error' as unknown and says why", () => {
    fake.set(POWER, reading("error"));
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("Power unknown");
    expect(dial(container)).toBe("—");
    expect(container.textContent).toContain("Govee answered without a power state");
  });

  it("treats an unavailable sensor as unknown", () => {
    fake.set(POWER, reading("unavailable"));
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("Power unknown");
    expect(dial(container)).toBe("—");
  });

  it("says the heater is offline when the link sensor does, and does not repeat a stale 'Off'", () => {
    fake.set(POWER, reading("off"));
    fake.set(LINK, reading("offline"));
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("Offline");
    expect(dial(container)).toBe("—");
    expect(act_(container)).toBe("Offline");
  });

  it("shows an em-dash, not a power claim, before Home Assistant has answered", () => {
    fake.status = "connecting";
    const { container } = render(<HeaterCard />);
    expect(meta(container)).toBe("—");
  });

  it("shows an armed auto-off timer", () => {
    fake.set(POWER, reading("on"));
    fake.set(TIMER, reading("active", { finishes_at: "not a date" }));
    const { container } = render(<HeaterCard />);
    expect(act_(container)).toBe("Auto-off armed");
  });
});

describe("HeaterCard presses", () => {
  it("calls the turn-on script and shows the press as waiting, not as 'On'", () => {
    fake.set(POWER, reading("off"));
    const { container } = render(<HeaterCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(calls).toEqual(["script.turn_on_govee_heater"]);
    expect(meta(container)).toBe("Turning on…");
    expect(dial(container)).toBe("Off"); // the sensor's word, until it reports
  });

  it("ends the wait as soon as the sensor reports, whatever it says", () => {
    fake.set(POWER, reading("off"));
    const { container } = render(<HeaterCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    act(() => fake.set(POWER, reading("on")));
    expect(meta(container)).toBe("On");

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(calls).toEqual(["script.turn_on_govee_heater", "script.turn_off_govee_heater"]);
    act(() => fake.set(POWER, reading("error")));
    expect(meta(container)).toBe("Power unknown");
  });

  it("stops waiting after the press window if the sensor never reports", () => {
    vi.useFakeTimers();
    fake.set(POWER, reading("off"));
    const { container } = render(<HeaterCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(meta(container)).toBe("Turning on…");
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(meta(container)).toBe("Off");
  });

  it("stops waiting when the script call fails", async () => {
    fake.set(POWER, reading("off"));
    failCalls = true;
    const { container } = render(<HeaterCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await flush();
    expect(meta(container)).toBe("Off");
  });

  it("offers both commands even when power is unknown", () => {
    render(<HeaterCard />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(calls).toEqual(["script.turn_on_govee_heater", "script.turn_off_govee_heater"]);
  });

  it("has no target-temperature control, because nothing sends it to the heater", () => {
    fake.set(POWER, reading("on"));
    fake.set("input_number.govee_heater_temperature", reading("22"));
    render(<HeaterCard />);
    expect(screen.queryByRole("button", { name: /heater target/i })).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Turn on", "Turn off"]);
  });
});
