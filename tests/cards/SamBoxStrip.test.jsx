/* The Overview/Media power strip. One tap = mains power AND the game
   session — Samuel asked for them on the same button (2026-08-08) after
   living with power on Overview and the session two tabs away. These tests
   pin the pairing in both directions, and that a plug failure still reverts
   the optimistic toggle while a session failure deliberately does not
   (the toggle's state is the plug; the error log already has the failure). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixtures = { entities: {} };
const calls = [];
let failEntities = new Set();

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => fixtures.entities[id] ?? { entity: null, status: "loading" },
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service} ${data.entity_id}`);
    return failEntities.has(data.entity_id) ? Promise.reject(new Error("nope")) : Promise.resolve();
  },
}));

import { SamBoxStrip } from "../../src/cards/overview/SamBoxStrip.jsx";

const plugEntity = (state) => ({ entity: { state, attributes: {} }, status: "ready" });
const flush = () => act(() => Promise.resolve());

beforeEach(() => {
  fixtures.entities = {};
  calls.length = 0;
  failEntities = new Set();
});

describe("SamBoxStrip combined power + session", () => {
  it("one tap on turns on the plug AND starts the game session", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off") };
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(calls).toContain("switch.turn_on switch.sambox360_plug");
    expect(calls).toContain("switch.turn_on switch.sambox");
  });

  it("one tap off ends the session AND cuts the plug", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on") };
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(calls).toContain("switch.turn_off switch.sambox");
    expect(calls).toContain("switch.turn_off switch.sambox360_plug");
  });

  it("a failed session start does not revert the toggle — the plug still turned on", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off") };
    failEntities = new Set(["switch.sambox"]);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("a failed plug turn-on reverts the toggle to the last known state", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off") };
    failEntities = new Set(["switch.sambox360_plug"]);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("stays disabled with no service calls while the plug has not reported", () => {
    render(<SamBoxStrip />);
    const sw = screen.getByRole("switch");
    expect(sw.disabled).toBe(true);
    fireEvent.click(sw);
    expect(calls).toEqual([]);
  });

  it("labels a live session honestly: session on but not yet streaming reads 'Game on'", () => {
    fixtures.entities = {
      "switch.sambox360_plug": plugEntity("on"),
      "switch.sambox": { entity: { state: "on", attributes: {} }, status: "ready" },
      "sensor.sambox_dropped_frames": {
        entity: { state: "0", attributes: { pi: "online", streaming: false } },
        status: "ready",
      },
    };
    render(<SamBoxStrip />);
    expect(screen.getByText("Game on")).toBeTruthy();
  });

  it("never claims 'Streaming' off the health sensor's offline fallback", () => {
    fixtures.entities = {
      "switch.sambox360_plug": plugEntity("on"),
      "switch.sambox": { entity: { state: "on", attributes: {} }, status: "ready" },
      "sensor.sambox_dropped_frames": {
        // The offline fallback fabricates its values — pi:"offline" means
        // nothing it says was measured.
        entity: { state: "0", attributes: { pi: "offline", streaming: true } },
        status: "ready",
      },
    };
    render(<SamBoxStrip />);
    expect(screen.queryByText("Streaming")).toBeNull();
    expect(screen.getByText("Game on")).toBeTruthy();
  });
});
