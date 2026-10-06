/* Room climate chart — round-3b review finding B6 (2026-10-06).

   Each series used to be sliced by its own stale flag. With only the
   temperature sensor offline, temperature was the last 24 recorder hours
   (23 when the recorder had 23) while humidity was 23 recorder hours plus
   its live reading — one point longer. The chart scales x by temperature's
   length, so the extra humidity point landed past the NOW line, in the
   right-hand gutter.

   The pin: both series share one time axis, slot for slot, in every stale
   combination, and nothing is drawn right of NOW.

   The real useEntity.js runs against a fake socket, so the status logic is
   the shipped one, not a stand-in. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    send: async () => ({}),
    reset() {
      h.states.clear();
      h.subs.clear();
      h.send = async () => ({});
    },
    set(id, state) {
      if (state == null) h.states.delete(id);
      else h.states.set(id, state);
      (h.subs.get(id) || new Set()).forEach((cb) => cb(h.states.get(id)));
    },
  };
  return h;
});

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
  waitForConnection: () => Promise.resolve(),
  sendWsMessage: (msg) => fake.send(msg),
}));

const { useClimateDerived } = await import("../../src/hooks/useClimateDerived.js");
const { RoomClimateCard } = await import("../../src/cards/climate/RoomClimateCard.jsx");

const TEMP = "sensor.h5075_4fb6_temperature";
const HUM = "sensor.h5075_4fb6_humidity";
const sensor = (state) => ({ state, attributes: {}, last_updated: "2026-10-06T09:30:00Z" });
const series = (values) => values.map((mean) => ({ mean, min: mean - 0.5, max: mean + 0.5 }));
// The recorder returns completed hours only, so 23 is the common case.
const hours = (n, base) => Array.from({ length: n }, (_, i) => Math.round((base + Math.sin(i / 3)) * 10) / 10);

beforeEach(() => {
  fake.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function derived({ temp, hum, tempHours = 23, humHours = 23 }) {
  fake.send = async () => ({ [TEMP]: series(hours(tempHours, 21)), [HUM]: series(hours(humHours, 50)) });
  if (temp !== undefined) fake.set(TEMP, sensor(temp));
  if (hum !== undefined) fake.set(HUM, sensor(hum));
  const { result } = renderHook(() => useClimateDerived());
  await waitFor(() => expect(result.current.historyLoading).toBe(false));
  return result.current;
}

describe("B6 — the two climate series share one time axis", () => {
  const combos = [
    ["both live", "21.3", "48"],
    ["temperature offline", "unavailable", "48"],
    ["humidity offline", "21.3", "unavailable"],
    ["both offline", "unavailable", "unavailable"],
    ["humidity entity missing", "21.3", undefined],
  ];

  for (const [name, temp, hum] of combos) {
    it(`same length in every slot: ${name}`, async () => {
      const d = await derived({ temp, hum });
      expect(d.tempHist.length).toBeGreaterThanOrEqual(2);
      expect(d.humHist.length).toBe(d.tempHist.length);
    });
  }

  it("temperature offline: humidity's newest recorder hour sits in the last slot, no live point past it", async () => {
    const d = await derived({ temp: "unavailable", hum: "48" });
    const humRec = hours(23, 50);
    expect(d.tempHist).toEqual(hours(23, 21));
    expect(d.humHist).toEqual(humRec);
    expect(d.humHist).not.toContain(48);
  });

  it("humidity offline: the now slot is empty for humidity, not its last mean repeated as current", async () => {
    const d = await derived({ temp: "21.3", hum: "unavailable" });
    expect(d.tempHist.at(-1)).toBe(21.3);
    expect(d.humHist.at(-1)).toBeNull();
    expect(d.humHist.slice(0, -1)).toEqual(hours(23, 50));
  });

  it("a shorter humidity history is aligned newest-to-newest, padded at the old end", async () => {
    const d = await derived({ temp: "21.3", hum: "48", humHours: 5 });
    expect(d.humHist.length).toBe(d.tempHist.length);
    expect(d.humHist.slice(0, 18)).toEqual(Array(18).fill(null));
    expect(d.humHist.slice(18)).toEqual([...hours(5, 50), 48]);
  });

  it("a longer humidity history is clipped to temperature's frame, not drawn past NOW", async () => {
    const d = await derived({ temp: "unavailable", hum: "48", tempHours: 10, humHours: 23 });
    expect(d.tempHist.length).toBe(10);
    expect(d.humHist).toEqual(hours(23, 50).slice(-10));
  });
});

// The end point of an SVG path: the last x,y pair in its `d`.
const lastX = (d) => {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  return nums[nums.length - 2];
};

describe("B6 — the drawn chart", () => {
  it("temperature offline: the dashed humidity trace stops at the NOW line", async () => {
    fake.send = async () => ({ [TEMP]: series(hours(23, 21)), [HUM]: series(hours(23, 50)) });
    fake.set(TEMP, sensor("unavailable"));
    fake.set(HUM, sensor("48"));
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("Temperature offline · last known");
    await waitFor(() => expect(container.querySelector(".chart-svg")).not.toBeNull());
    const hum = container.querySelector('.chart-svg path[stroke-dasharray="4 4"]').getAttribute("d");
    const nowX = Number(container.querySelector('.chart-svg line[stroke="var(--ink)"]').getAttribute("x1"));
    expect(lastX(hum)).toBeLessThanOrEqual(nowX + 0.05);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("humidity offline: the trace ends a slot short of NOW and no gap is drawn at 0%", async () => {
    fake.send = async () => ({ [TEMP]: series(hours(23, 21)), [HUM]: series(hours(23, 50)) });
    fake.set(TEMP, sensor("21.3"));
    fake.set(HUM, sensor("unavailable"));
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("Humidity offline · last known");
    await waitFor(() => expect(container.querySelector(".chart-svg")).not.toBeNull());
    const hum = container.querySelector('.chart-svg path[stroke-dasharray="4 4"]').getAttribute("d");
    const nowX = Number(container.querySelector('.chart-svg line[stroke="var(--ink)"]').getAttribute("x1"));
    expect(lastX(hum)).toBeLessThan(nowX);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("no humidity history and no reading draws no humidity trace, and no NaN", async () => {
    fake.send = async () => ({ [TEMP]: series(hours(23, 21)) });
    fake.set(TEMP, sensor("21.3"));
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("24-hour trace");
    await waitFor(() => expect(container.querySelector(".chart-svg")).not.toBeNull());
    expect(container.querySelector('.chart-svg path[stroke-dasharray="4 4"]').getAttribute("d")).toBe("");
    expect(container.innerHTML).not.toContain("NaN");
  });
});
