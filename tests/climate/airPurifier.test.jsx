/* Levoit Core 300S purifier card.

   Pins three things: "medium" sends a percentage HA's vesync fan actually
   maps to speed 2 (67 used to land on HIGH); a failed mode change puts the
   highlighted preset back; and the copy says only what an entity reported —
   the old card printed "Display is on. Last filter check 12 days ago." as
   fixed text, and "Currently running auto" while the purifier was off. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    reset() {
      h.states.clear();
      h.subs.clear();
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
  onConnectionChange: (cb) => { cb("ready"); return () => {}; },
  onStatesChanged: () => () => {},
  onSnapshotReady: (cb) => { cb(); return () => {}; },
  hasSnapshot: () => true,
  getConnectionStatus: () => "ready",
  waitForConnection: () => Promise.reject(new Error("not used")),
  sendWsMessage: () => Promise.reject(new Error("not used")),
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push({ domain, service, data });
    return failCalls ? Promise.reject(new Error("nope")) : Promise.resolve();
  },
}));

const { AirPurifierCard } = await import("../../src/cards/climate/AirPurifierCard.jsx");

const FAN = "fan.core_300s_series";
const fan = (state, attributes) => ({ entity_id: FAN, state, attributes });
const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);
const dek = (container) => container.querySelector(".purifier-info .dek").textContent;
const flush = () => act(() => Promise.resolve());

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  failCalls = false;
});

describe("AirPurifierCard speed mapping", () => {
  it("sends 33 / 66 / 100 — the three bands HA's vesync fan maps to speeds 1 / 2 / 3", () => {
    fake.set(FAN, fan("on", { preset_mode: "auto" }));
    render(<AirPurifierCard />);
    for (const p of ["low", "medium", "high"]) fireEvent.click(screen.getByRole("button", { name: p }));
    expect(calls.map((c) => c.data.percentage)).toEqual([33, 66, 100]);
  });

  it("reads HA's reported percentages back as the same preset", () => {
    for (const [pct, name] of [[33, "low"], [66, "medium"], [100, "high"]]) {
      fake.reset();
      fake.set(FAN, fan("on", { preset_mode: null, percentage: pct }));
      const { unmount } = render(<AirPurifierCard />);
      expect(pressed()).toEqual([name]);
      unmount();
    }
  });

  it("uses set_preset_mode for sleep and auto", () => {
    fake.set(FAN, fan("on", { preset_mode: null, percentage: 33 }));
    render(<AirPurifierCard />);
    fireEvent.click(screen.getByRole("button", { name: "sleep" }));
    expect(calls).toEqual([{ domain: "fan", service: "set_preset_mode", data: { entity_id: FAN, preset_mode: "sleep" } }]);
  });
});

describe("AirPurifierCard failure + copy", () => {
  it("puts the preset and the power switch back when a mode change fails", async () => {
    fake.set(FAN, fan("off", { preset_mode: "auto" }));
    failCalls = true;
    render(<AirPurifierCard />);
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    expect(pressed()).toEqual(["high"]);
    await flush();
    expect(pressed()).toEqual(["auto"]);
    expect(screen.getByRole("switch", { name: "Air purifier" })).toHaveAttribute("aria-checked", "false");
  });

  it("says the purifier is off rather than 'Currently running auto'", () => {
    fake.set(FAN, fan("off", { preset_mode: "auto" }));
    const { container } = render(<AirPurifierCard />);
    expect(dek(container)).toBe("Purifier is off.");
  });

  it("drops the hardcoded display and filter-check sentences", () => {
    fake.set(FAN, fan("on", { preset_mode: "auto" }));
    const { container } = render(<AirPurifierCard />);
    expect(dek(container)).toBe("Currently running auto.");
    expect(container.textContent).not.toContain("12 days ago");
  });

  it("reports the display only from the display switch", () => {
    fake.set(FAN, fan("on", { preset_mode: "auto" }));
    fake.set("switch.core_300s_series_display", { state: "off", attributes: {} });
    const { container } = render(<AirPurifierCard />);
    expect(dek(container)).toBe("Currently running auto. Display is off.");
  });

  it("does not print 'Air is unavailable' when the air-quality sensor drops out", () => {
    fake.set(FAN, fan("on", { preset_mode: "auto" }));
    fake.set("sensor.core_300s_series_air_quality", { state: "unavailable", attributes: {} });
    fake.set("sensor.core_300s_series_pm2_5", { state: "unavailable", attributes: {} });
    const { container } = render(<AirPurifierCard />);
    expect(container.querySelector(".purifier-info .h").textContent).toMatch(/^Air is —\./);
    expect(container.querySelector(".purifier-num .big").textContent).toBe("—");
    expect(container.querySelector(".purifier-num .sub").textContent).toBe("µg/m³ · —");
  });
});
