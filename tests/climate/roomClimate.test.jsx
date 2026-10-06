/* Room climate (Govee H5075): useStatistics, useClimateDerived, and the two
   cards built on them.

   The defect these pin: with no recorder history, the "Low · 24h" and
   "High · 24h" chips both showed the live reading — a range nobody measured —
   and the chart said "Loading history…" forever because nothing read
   useStatistics' `loading`. And history was only fetched at mount and every
   10 minutes, so a slow first connect or a reconnect left the cards without
   it for up to 10 minutes.

   The real useEntity.js runs against a fake socket, so the status logic
   (loading / unavailable / ready) is the shipped one, not a stand-in. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    conn: new Set(),
    status: "ready",
    statsCalls: 0,
    send: async () => ({}),
    reset() {
      h.states.clear();
      h.subs.clear();
      h.conn.clear();
      h.status = "ready";
      h.statsCalls = 0;
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
  onSnapshotReady: (cb) => { cb(); return () => {}; },
  hasSnapshot: () => true,
  getConnectionStatus: () => fake.status,
  waitForConnection: () => (fake.status === "ready" ? Promise.resolve() : Promise.reject(new Error("timed out"))),
  sendWsMessage: (msg) => {
    fake.statsCalls++;
    return fake.send(msg);
  },
}));

const { useStatistics } = await import("../../src/ha/useEntity.js");
const { RoomClimateCard } = await import("../../src/cards/climate/RoomClimateCard.jsx");
const { RoomClimateStrip } = await import("../../src/cards/overview/RoomClimateStrip.jsx");

const TEMP = "sensor.h5075_4fb6_temperature";
const HUM = "sensor.h5075_4fb6_humidity";
const PM = "sensor.core_300s_series_pm2_5";
const AQ = "sensor.core_300s_series_air_quality";

const sensor = (state) => ({ state, attributes: {}, last_updated: "2026-10-06T09:30:00Z" });
const series = (values, extra = {}) => values.map((mean) => ({ mean, min: mean - 0.5, max: mean + 0.5, ...extra }));
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  fake.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const chipValues = (container) => [...container.querySelectorAll(".chip-stat .v")].map((n) => n.textContent);

describe("useStatistics", () => {
  it("does not fetch while disconnected, then fetches as soon as the socket is ready", async () => {
    fake.status = "connecting";
    const { result } = renderHook(() => useStatistics([TEMP], 24));
    expect(fake.statsCalls).toBe(0);
    expect(result.current.loading).toBe(true);

    fake.send = async () => ({ [TEMP]: series([20, 21]) });
    act(() => fake.setStatus("ready"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fake.statsCalls).toBe(1);
    expect(result.current.data[TEMP].mean).toEqual([20, 21]);
  });

  it("fetches again when the socket comes back after a drop", async () => {
    const { result } = renderHook(() => useStatistics([TEMP], 24));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fake.statsCalls).toBe(1);

    act(() => fake.setStatus("disconnected"));
    act(() => fake.setStatus("ready"));
    await waitFor(() => expect(fake.statsCalls).toBe(2));
  });

  it("does not refetch on an ordinary re-render", async () => {
    const { result, rerender } = renderHook(() => useStatistics([TEMP, HUM], 24));
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    rerender();
    expect(fake.statsCalls).toBe(1);
  });

  it("stops loading when the fetch fails, leaving data null", async () => {
    fake.send = async () => { throw new Error("recorder down"); };
    const { result } = renderHook(() => useStatistics([TEMP], 24));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });
});

describe("RoomClimateCard", () => {
  beforeEach(() => {
    fake.set(TEMP, sensor("21.3"));
    fake.set(HUM, sensor("48.2"));
  });

  it("shows an em-dash for the 24h low and high when the recorder has no history", async () => {
    fake.send = async () => ({});
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("History unavailable");
    const [low, high] = chipValues(container);
    expect(low).toBe("—");
    expect(high).toBe("—");
    expect(container.textContent).not.toContain("21.3°21.3°");
  });

  it("says 'Loading history…' only while the fetch is outstanding", async () => {
    const d = deferred();
    fake.send = () => d.promise;
    const { findByText, queryByText } = render(<RoomClimateCard />);
    await findByText("Loading history…");
    await act(async () => d.resolve({}));
    await findByText("History unavailable");
    expect(queryByText("Loading history…")).toBeNull();
  });

  it("reports the recorder's true min and max once history arrives", async () => {
    fake.send = async () => ({
      [TEMP]: [{ mean: 20, min: 18.4, max: 20.5 }, { mean: 21, min: 20.6, max: 22.9 }],
      [HUM]: series([47, 48]),
    });
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("24-hour trace");
    await waitFor(() => expect(chipValues(container)[0]).toBe("18.4°"));
    expect(chipValues(container)[1]).toBe("22.9°");
  });

  it("rounds the last-known humidity of an offline sensor instead of printing the raw mean", async () => {
    fake.set(TEMP, sensor("unavailable"));
    fake.set(HUM, sensor("unavailable"));
    fake.send = async () => ({
      [TEMP]: series([20.4, 20.9]),
      [HUM]: series([51, 52.18333333333333]),
    });
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("Sensor offline · last known");
    const ring = container.querySelector(".hum-num").textContent;
    expect(ring).toBe("52.2%");
  });

  it("says humidity is unknown — not 0%, not 'Air is dry' — with no reading and no history", async () => {
    fake.set(TEMP, sensor("unavailable"));
    fake.set(HUM, sensor("unavailable"));
    fake.send = async () => ({ [TEMP]: series([20.4, 20.9]) });
    const { container, findByText } = render(<RoomClimateCard />);
    await findByText("Sensor offline · last known");
    expect(container.querySelector(".hum-num").textContent).toBe("—");
    expect(container.querySelector(".hum-band").textContent).toBe("—");
    expect(container.textContent).not.toContain("Air is dry");
  });
});

describe("RoomClimateStrip", () => {
  beforeEach(() => {
    fake.set(TEMP, sensor("21.3"));
    fake.set(HUM, sensor("48.2"));
  });

  const aqValue = (container) => container.querySelector(".rcstrip-aq .rcstrip-pair-lbl .v");

  it("shows an em-dash for the low/high line with no recorder history", async () => {
    const { container } = render(<RoomClimateStrip />);
    await waitFor(() => expect(fake.statsCalls).toBe(1));
    expect(container.querySelector(".rcstrip-verdict .d").textContent).toBe("low — · high —");
  });

  it("never prints NaN or a green 'unavailable' when the purifier's sensors are unavailable", () => {
    fake.set(PM, sensor("unavailable"));
    fake.set(AQ, sensor("unavailable"));
    const { container } = render(<RoomClimateStrip />);
    const num = container.querySelector(".rcstrip-aq-num").textContent;
    expect(num).toBe("—");
    expect(container.textContent).not.toContain("NaN");
    expect(aqValue(container).textContent).toBe("—");
    expect(aqValue(container).style.color).toBe("var(--ink-3)");
  });

  it("does not invent perfect air (0µg) when the PM entity is missing", () => {
    const { container } = render(<RoomClimateStrip />);
    expect(container.querySelector(".rcstrip-aq-num").textContent).toBe("—");
  });

  it("colours the air label from the measured PM band", () => {
    fake.set(PM, sensor("80"));
    fake.set(AQ, sensor("poor"));
    const { container } = render(<RoomClimateStrip />);
    expect(container.querySelector(".rcstrip-aq-num").textContent).toBe("80µg");
    expect(aqValue(container).textContent).toBe("poor");
    expect(aqValue(container).style.color).toBe("var(--bad)");
  });
});
