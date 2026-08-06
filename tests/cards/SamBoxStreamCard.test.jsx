/* The System-tab game-stream card. Two things earn tests here:

   1. The honesty gating: the health sensor's offline fallback reports zeros
      (so a dead Pi never inflates the unavailable-entities count), which
      means every number MUST render as an em dash unless pi === "online" —
      a fabricated 0 reading as "clean session" is exactly the failure the
      honesty rule exists to stop.
   2. The "PC is off" message: it replaced the reverted wake-on-LAN switch at
      Samuel's explicit request, and it must appear only when a session is
      wanted AND the PC is confirmed off — not while the PC state is still
      loading (pending ≠ off, same distinction roles.js makes). */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fixtures = {
  entities: {},
  toggles: {},
};

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => fixtures.entities[id] ?? { entity: null, status: "loading" },
}));
vi.mock("../../src/hooks/useOptimistic.js", () => ({
  useOptimisticToggle: (id) =>
    fixtures.toggles[id] ?? { entity: null, status: "loading", on: false, setOn: () => {}, toggle: () => {} },
}));

import { SamBoxStreamCard, deriveStream } from "../../src/cards/system/SamBoxStreamCard.jsx";

const healthEntity = (pi, extra = {}) => ({
  entity: {
    state: extra.dropped ?? "0",
    attributes: { pi, streaming: false, net_drop_pct: 0.0, jitter_drop_pct: 0.07, mode: "1080", ...extra.attrs },
  },
  status: "ready",
});

describe("deriveStream", () => {
  it("says idle when nothing is happening", () => {
    expect(
      deriveStream({ healthStatus: "ready", piOnline: true, streaming: false, mode: "1080p", sessionOn: false, pcStatus: "ready", pcOn: true }),
    ).toEqual({ meta: "idle", pcWarning: false });
  });

  it("names the streaming quality while live", () => {
    expect(
      deriveStream({ healthStatus: "ready", piOnline: true, streaming: true, mode: "720p", sessionOn: true, pcStatus: "ready", pcOn: true }),
    ).toEqual({ meta: "streaming · 720p", pcWarning: false });
  });

  it("flags a session with no PC as the error Samuel asked for", () => {
    const d = deriveStream({ healthStatus: "ready", piOnline: true, streaming: false, mode: null, sessionOn: true, pcStatus: "ready", pcOn: false });
    expect(d.pcWarning).toBe(true);
    expect(d.meta).toBe("PC is off");
  });

  it("does NOT claim the PC is off while its state is still loading", () => {
    const d = deriveStream({ healthStatus: "ready", piOnline: true, streaming: false, mode: null, sessionOn: true, pcStatus: "loading", pcOn: false });
    expect(d.pcWarning).toBe(false);
    expect(d.meta).toBe("starting…");
  });

  it("reports the SamBox itself offline over any other claim", () => {
    expect(
      deriveStream({ healthStatus: "ready", piOnline: false, streaming: false, mode: null, sessionOn: false, pcStatus: "ready", pcOn: true }).meta,
    ).toBe("SamBox offline");
  });
});

describe("SamBoxStreamCard rendering", () => {
  it("em-dashes every number when the Pi is offline — fallback zeros are fabricated, not measured", () => {
    fixtures.entities = {
      "sensor.sambox_dropped_frames": healthEntity("offline"),
      "binary_sensor.sam_pc": { entity: { state: "on", attributes: {} }, status: "ready" },
    };
    fixtures.toggles = {};
    render(<SamBoxStreamCard />);
    // Dropped / net loss / jitter must all be dashes; "0 f" or "0%" must not appear.
    expect(screen.queryByText("0 f")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("0.07%")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("shows measured numbers when the Pi answered", () => {
    fixtures.entities = {
      "sensor.sambox_dropped_frames": healthEntity("online", { dropped: "47" }),
      "binary_sensor.sam_pc": { entity: { state: "on", attributes: {} }, status: "ready" },
    };
    fixtures.toggles = {};
    render(<SamBoxStreamCard />);
    expect(screen.getByText("47 f")).toBeTruthy();
    expect(screen.getByText("0.07%")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("surfaces the PC-off warning when a session is wanted with no PC", () => {
    fixtures.entities = {
      "sensor.sambox_dropped_frames": healthEntity("online"),
      "binary_sensor.sam_pc": { entity: { state: "off", attributes: {} }, status: "ready" },
    };
    fixtures.toggles = {
      "switch.sambox": { entity: { state: "on" }, status: "ready", on: true, setOn: () => {}, toggle: () => {} },
    };
    render(<SamBoxStreamCard />);
    expect(screen.getByRole("status").textContent).toMatch(/PC is off/);
  });

  it("disables both toggles until their switches have reported", () => {
    fixtures.entities = {
      "sensor.sambox_dropped_frames": healthEntity("online"),
      "binary_sensor.sam_pc": { entity: { state: "on", attributes: {} }, status: "ready" },
    };
    fixtures.toggles = {};
    render(<SamBoxStreamCard />);
    expect(screen.getByRole("switch", { name: "Game session" }).disabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Smooth mode (720p)" }).disabled).toBe(true);
  });
});
