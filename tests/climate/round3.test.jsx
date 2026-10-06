/* Climate round-3 regressions (2026-10-06 fresh-eyes sweep, against a fake HA).

   M1  — the diffuser cards showed the GH_DATA mock ("On · Spraying · eco ·
         ocean", animated mist, 77% / 27.7°C) as fact on a dashboard that had
         never reached HA, and kept the last-known mode with live buttons
         through an outage while every other card went to its guard.
   M9  — a humidity dropout alone threw away a live temperature: the room card
         showed the last hourly mean under "Sensor offline · last known".
   M10 — a purifier whose fan entity was removed from HA still said
         "Currently running auto" with a green switch and five live buttons.

   The real useEntity.js runs against a fake socket whose connection status
   can change mid-test, so loading / not_found / unavailable are the shipped
   logic, not a stand-in. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    conn: new Set(),
    status: "ready",
    send: async () => ({}),
    reset() {
      h.states.clear();
      h.subs.clear();
      h.conn.clear();
      h.status = "ready";
      h.send = async () => ({});
    },
    set(id, state) {
      if (state == null) h.states.delete(id);
      else h.states.set(id, state);
      (h.subs.get(id) || new Set()).forEach((cb) => cb(h.states.get(id)));
    },
    setStatus(s) {
      h.status = s;
      h.conn.forEach((cb) => cb(s));
    },
  };
  return h;
});
const calls = [];

vi.mock("../../src/ha/socket.js", () => ({
  getEntity: (id) => fake.states.get(id),
  getAllStates: () => [...fake.states.values()],
  subscribe: (id, cb) => {
    if (!fake.subs.has(id)) fake.subs.set(id, new Set());
    fake.subs.get(id).add(cb);
    if (fake.states.has(id)) cb(fake.states.get(id));
    return () => fake.subs.get(id)?.delete(cb);
  },
  onConnectionChange: (cb) => {
    fake.conn.add(cb);
    cb(fake.status);
    return () => fake.conn.delete(cb);
  },
  onStatesChanged: () => () => {},
  onSnapshotReady: (cb) => { if (fake.status === "ready") cb(); return () => {}; },
  hasSnapshot: () => fake.status === "ready",
  getConnectionStatus: () => fake.status,
  waitForConnection: () => (fake.status === "ready" ? Promise.resolve() : Promise.reject(new Error("timed out"))),
  sendWsMessage: (msg) => fake.send(msg),
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push({ domain, service, data });
    return Promise.reject(new Error("Not connected"));
  },
}));

const { DiffuserCard } = await import("../../src/cards/climate/DiffuserCard.jsx");
const { DiffuserMini } = await import("../../src/cards/overview/DiffuserMini.jsx");
const { DIFFUSER } = await import("../../src/lib/diffuser.js");
const { RoomClimateCard } = await import("../../src/cards/climate/RoomClimateCard.jsx");
const { RoomClimateStrip } = await import("../../src/cards/overview/RoomClimateStrip.jsx");
const { AirPurifierCard } = await import("../../src/cards/climate/AirPurifierCard.jsx");

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const mistButtons = () => screen.getAllByRole("button", { name: /^(off|eco|on)$/ });
const liveDiffuser = () => {
  fake.set(DIFFUSER.spray, { entity_id: DIFFUSER.spray, state: "eco", attributes: { options: ["off", "eco", "on"] } });
  fake.set(DIFFUSER.light, { entity_id: DIFFUSER.light, state: "on", attributes: { brightness: 128, rgb_color: [96, 170, 255] } });
  fake.set(DIFFUSER.humidity, { entity_id: DIFFUSER.humidity, state: "61", attributes: {} });
  fake.set(DIFFUSER.temperature, { entity_id: DIFFUSER.temperature, state: "21.4", attributes: {} });
};

describe("M1 — DiffuserMini never shows the mock, or a stale state, as fact", () => {
  it("reads '—' with every control disabled when HA has never answered (signed out / first connect)", () => {
    fake.status = "disconnected";
    const { container } = render(<DiffuserMini />);
    const head = container.querySelector(".gs-status");
    expect(head.textContent).toBe("—");
    expect(head.style.getPropertyValue("--gs-color")).toBe("var(--ink-4)");
    expect(container.querySelector(".sub").textContent).toBe("—");
    expect(container.textContent).not.toMatch(/Spraying|ocean|\bOn\b/);
    for (const b of mistButtons()) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("aria-pressed", "false");
    }
    const sw = screen.getByRole("switch", { name: "Diffuser LED — not connected" });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(mistButtons()[0]);
    fireEvent.click(sw);
    expect(calls).toEqual([]);
  });

  it("drops the last-known 'On · Spraying' and disables its controls when the connection drops", () => {
    liveDiffuser();
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".gs-status").textContent).toBe("On");
    expect(container.querySelector(".sub").textContent).toBe("Spraying · eco · ocean");

    act(() => fake.setStatus("disconnected"));
    expect(container.querySelector(".gs-status").textContent).toBe("—");
    expect(container.querySelector(".sub").textContent).toBe("—");
    for (const b of mistButtons()) expect(b).toBeDisabled();
    expect(screen.getByRole("switch", { name: /^Diffuser LED/ })).toBeDisabled();

    act(() => fake.setStatus("ready"));
    expect(container.querySelector(".sub").textContent).toBe("Spraying · eco · ocean");
    expect(screen.getByRole("button", { name: "eco" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("M1 — DiffuserCard never shows the mock, or a stale state, as fact", () => {
  it("shows no mist, no mode, no readings and no live control before HA answers", () => {
    fake.status = "connecting";
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".diff-mist")).toBeNull();
    expect(container.querySelector(".meta").textContent).toBe("—");
    expect(container.querySelector(".lede").textContent).toBe("Diffuser state unknown — not connected to Home Assistant.");
    expect(container.textContent).not.toMatch(/Spraying|Misting|77|27\.7|ocean/);
    expect([...container.querySelectorAll(".diff-stat .v")].map((n) => n.textContent)).toEqual(["—%", "—°C"]);
    for (const b of mistButtons()) expect(b).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Diffuser LED light — not connected" })).toBeDisabled();
    for (const s of screen.getAllByRole("button", { name: /^LED colour/ })) {
      expect(s).toBeDisabled();
      expect(s).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("drops the last-known readings and mode when the connection drops, and re-reads them on return", () => {
    liveDiffuser();
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Spraying on eco. LED set to ocean.");

    act(() => fake.setStatus("disconnected"));
    expect(container.querySelector(".diff-mist")).toBeNull();
    expect(container.querySelector(".lede").textContent).toBe("Diffuser state unknown — not connected to Home Assistant.");
    expect([...container.querySelectorAll(".diff-stat .v")].map((n) => n.textContent)).toEqual(["—%", "—°C"]);
    for (const b of mistButtons()) expect(b).toBeDisabled();

    act(() => fake.setStatus("ready"));
    expect(container.querySelector(".lede").textContent).toBe("Spraying on eco. LED set to ocean.");
    expect([...container.querySelectorAll(".diff-stat .v")].map((n) => n.textContent)).toEqual(["61%", "21.4°C"]);
  });
});

const TEMP = "sensor.h5075_4fb6_temperature";
const HUM = "sensor.h5075_4fb6_humidity";
const sensor = (state) => ({ state, attributes: {}, last_updated: "2026-10-06T09:30:00Z" });
const series = (values) => values.map((mean) => ({ mean, min: mean - 0.5, max: mean + 0.5 }));

describe("M9 — each room reading is gated on its own sensor", () => {
  beforeEach(() => {
    fake.send = async () => ({ [TEMP]: series([20.4, 20.9]), [HUM]: series([51, 52]) });
  });

  it("keeps a live temperature when only the humidity sensor drops", async () => {
    fake.set(TEMP, sensor("23.4"));
    fake.set(HUM, sensor("unavailable"));
    const { container } = render(<RoomClimateCard />);
    // History has landed once the humidity ring shows its last-known mean.
    await waitFor(() => expect(container.querySelector(".hum-num")?.textContent).toBe("52%"));
    expect(container.querySelector(".readout.temp").textContent).toBe("23.4°c");
    expect(container.querySelector(".roomclim-verdict .h").textContent).toBe("Room is warm");
    expect(container.querySelector(".meta").textContent).toBe("Humidity offline · last known");
    expect(container.querySelector(".card-badge").textContent).toBe("stale");
    expect(container.textContent).not.toContain("20.9°c");
  });

  it("does the same on the Overview strip", async () => {
    fake.set(TEMP, sensor("23.4"));
    fake.set(HUM, sensor("unavailable"));
    const { container } = render(<RoomClimateStrip />);
    await waitFor(() => expect(container.querySelector(".rcstrip-hum text")?.textContent).toBe("52"));
    expect(container.querySelector(".readout.temp").textContent).toBe("23.4°c");
    expect(container.querySelector(".rcstrip-verdict .h").textContent).toBe("Room is warm");
    expect(container.querySelector(".meta").textContent).toBe("Humidity offline · last known");
  });

  it("keeps a live humidity, and names the temperature sensor, when only the temperature drops", async () => {
    fake.set(TEMP, sensor("unavailable"));
    fake.set(HUM, sensor("48"));
    const { container } = render(<RoomClimateCard />);
    await waitFor(() => expect(container.querySelector(".readout.temp")?.textContent).toBe("20.9°c"));
    expect(container.querySelector(".hum-num").textContent).toBe("48%");
    expect(container.querySelector(".meta").textContent).toBe("Temperature offline · last known");
  });

  it("renders a live temperature, and humidity as an em dash, when the humidity entity is missing", async () => {
    fake.set(TEMP, sensor("21.3"));
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("24-hour trace");
    expect(container.querySelector(".entity-warning")).toBeNull();
    expect(container.querySelector(".readout.temp").textContent).toBe("21.3°c");
    expect(container.querySelector(".hum-num").textContent).toBe("—");
    expect(container.querySelector(".card-badge")).toBeNull();
  });
});

const FAN = "fan.core_300s_series";
const presets = () => screen.getAllByRole("button", { name: /^(sleep|auto|low|medium|high)$/ });

describe("M10 — a purifier with no fan entity claims nothing and offers nothing", () => {
  it("drops 'Currently running auto', the green switch and the live presets when the fan entity is removed", () => {
    fake.set(FAN, { entity_id: FAN, state: "on", attributes: { preset_mode: "auto" } });
    const { container } = render(<AirPurifierCard />);
    expect(container.querySelector(".purifier-info .dek").textContent).toBe("Currently running auto.");

    act(() => fake.set(FAN, null));
    expect(container.querySelector(".purifier-info .dek").textContent).toBe("Purifier is unavailable.");
    expect(container.querySelector(".meta").textContent).toBe("Unavailable");
    const sw = screen.getByRole("switch", { name: "Air purifier — unavailable" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toBeDisabled();
    for (const b of presets()) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByRole("button", { name: "medium" }));
    fireEvent.click(sw);
    expect(calls).toEqual([]);
  });

  it("keeps the switch off and disabled while HA hasn't answered", () => {
    fake.set(FAN, { entity_id: FAN, state: "on", attributes: { preset_mode: "auto" } });
    render(<AirPurifierCard />);
    expect(screen.getByRole("switch", { name: "Air purifier" })).toHaveAttribute("aria-checked", "true");
    act(() => fake.setStatus("disconnected"));
    const sw = screen.getByRole("switch", { name: "Air purifier — state unknown" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toBeDisabled();
  });
});

// Mock mode is the screenshot harness: nothing here may throw or print NaN.
describe("mock mode (no Home Assistant at all)", () => {
  it("renders all five cards without NaN", async () => {
    fake.status = "disconnected";
    const { container } = render(<>
      <DiffuserCard /><DiffuserMini /><RoomClimateCard /><RoomClimateStrip /><AirPurifierCard />
    </>);
    await waitFor(() => expect(container.querySelectorAll(".card").length).toBe(5));
    expect(container.innerHTML).not.toContain("NaN");
  });
});
