/* The Overview/Media power strip. One tap = mains power AND the game
   session — Samuel asked for them on the same button (2026-08-08) after
   living with power on Overview and the session two tabs away. These tests
   pin the pairing in both directions, and that a plug failure still reverts
   the optimistic toggle while a session failure deliberately does not
   (the toggle's state is the plug; the error log already has the failure).
   They also pin the order (plug, then session) and the power-only mode for
   when switch.sambox is unavailable. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixtures = { entities: {} };
const calls = [];
let failEntities = new Set();
// Entity ids whose next call hangs until the test settles it, so "what went
// out before the plug call came back?" is observable.
const held = {};

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => fixtures.entities[id] ?? { entity: null, status: "loading" },
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service} ${data.entity_id}`);
    if (held[data.entity_id] === null) {
      return new Promise((resolve, reject) => { held[data.entity_id] = { resolve, reject }; });
    }
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
  for (const k of Object.keys(held)) delete held[k];
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

/* Plug first, session second. Fired together, a failed plug call left a game
   session running (TV awake, kiosk waiting on an unpowered PC) behind a switch
   reading off, whose next tap only tried to power on again. */
describe("SamBoxStrip ordering", () => {
  it("starts the session only once the plug call has succeeded", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off") };
    held["switch.sambox360_plug"] = null;
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(calls).toEqual(["switch.turn_on switch.sambox360_plug"]);

    await act(async () => held["switch.sambox360_plug"].resolve());
    expect(calls).toEqual(["switch.turn_on switch.sambox360_plug", "switch.turn_on switch.sambox"]);
  });

  it("a failed plug turn-on never starts a session it can't power", async () => {
    fixtures.entities = {
      "switch.sambox360_plug": plugEntity("off"),
      "switch.sambox": { entity: { state: "off", attributes: {} }, status: "ready" },
    };
    failEntities = new Set(["switch.sambox360_plug"]);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(calls).toEqual(["switch.turn_on switch.sambox360_plug"]);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("tapping off while the plug call is still in flight cancels the queued session start", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off") };
    held["switch.sambox360_plug"] = null;
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch")); // on (turning)
    const plugOn = held["switch.sambox360_plug"];
    now.mockReturnValue(1_000_000 + 1500); // a deliberate second tap, not a double-tap
    fireEvent.click(screen.getByRole("switch")); // off, before the plug answered
    expect(calls).toContain("switch.turn_off switch.sambox360_plug");

    await act(async () => plugOn.resolve()); // the first tap's plug call lands late
    expect(calls).not.toContain("switch.turn_on switch.sambox");
  });
});

describe("SamBoxStrip double-tap", () => {
  it("a double-tap on a running PC turns it off once — it does not power-cycle it", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on") };
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch")); // off
    now.mockReturnValue(2_000_000 + 150);
    fireEvent.click(screen.getByRole("switch")); // the second half of a double-tap
    await flush();
    expect(calls).toContain("switch.turn_off switch.sambox360_plug");
    expect(calls).not.toContain("switch.turn_on switch.sambox360_plug");
  });

  it("a slow triple-tap, or two taps a second apart, still doesn't power-cycle it", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on") };
    const now = vi.spyOn(Date, "now").mockReturnValue(3_000_000);
    render(<SamBoxStrip />);
    for (const t of [500, 1000, 2000, 4000]) {
      now.mockReturnValue(3_000_000 + t); // each tap is past the 800 ms guard of… none, or of the last
      fireEvent.click(screen.getByRole("switch"));
    }
    await flush();
    expect(calls.filter((c) => c === "switch.turn_off switch.sambox360_plug")).toHaveLength(1);
    expect(calls).not.toContain("switch.turn_on switch.sambox360_plug");
  });

  it("powers back on when asked again after a pause", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on") };
    const now = vi.spyOn(Date, "now").mockReturnValue(4_000_000);
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch")); // off
    now.mockReturnValue(4_000_000 + 6000);
    fireEvent.click(screen.getByRole("switch")); // a deliberate "on", well after
    await flush();
    expect(calls).toContain("switch.turn_on switch.sambox360_plug");
  });
});

/* switch.sambox reads "unavailable" — not a fake "off" — whenever the SamBox Pi
   can't be reached, and HA silently skips calls to an unavailable entity. The
   plug half must keep working; the switch must stop promising a game. */
describe("SamBoxStrip with the game session unavailable", () => {
  const sessionDown = (status = "unavailable") => ({
    entity: status === "not_found" ? null : { state: "unavailable", attributes: {} },
    status,
  });

  it("a tap on powers the PC and sends no session call", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off"), "switch.sambox": sessionDown() };
    render(<SamBoxStrip />);
    const sw = screen.getByRole("switch");
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    await flush();
    expect(calls).toEqual(["switch.turn_on switch.sambox360_plug"]);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("a tap off cuts the plug and sends no session call", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on"), "switch.sambox": sessionDown() };
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch"));
    await flush();
    expect(calls).toEqual(["switch.turn_off switch.sambox360_plug"]);
  });

  it("names the switch as power-only and says why, instead of promising a session", () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off"), "switch.sambox": sessionDown() };
    render(<SamBoxStrip />);
    expect(screen.getByRole("switch", { name: "SamBox360 power — game session unavailable" })).toBeTruthy();
    expect(screen.getByText("Power only · session unavailable")).toBeTruthy();
  });

  it("lets the power-only line wrap, so a phone doesn't ellipsise the reason away", () => {
    // .sambox-out is nowrap + ellipsis; at 390px it cut this line to
    // "Power only · game …" and the reason lived only in a touch-unreachable title.
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off"), "switch.sambox": sessionDown() };
    render(<SamBoxStrip />);
    expect(screen.getByText("Power only · session unavailable").style.whiteSpace).toBe("normal");
  });

  it("treats a missing session switch the same way", async () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("off"), "switch.sambox": sessionDown("not_found") };
    render(<SamBoxStrip />);
    fireEvent.click(screen.getByRole("switch", { name: /game session unavailable/ }));
    await flush();
    expect(calls).toEqual(["switch.turn_on switch.sambox360_plug"]);
  });

  it("reports the plug's own state and never claims a session state", () => {
    fixtures.entities = { "switch.sambox360_plug": plugEntity("on"), "switch.sambox": sessionDown() };
    render(<SamBoxStrip />);
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.queryByText("Game on")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("goes back to the normal paired label once the session switch reports again", () => {
    fixtures.entities = {
      "switch.sambox360_plug": plugEntity("off"),
      "switch.sambox": { entity: { state: "off", attributes: {} }, status: "ready" },
    };
    render(<SamBoxStrip />);
    expect(screen.getByRole("switch", { name: "SamBox360 power and game session" })).toBeTruthy();
    expect(screen.queryByText(/Power only/)).toBeNull();
  });
});
