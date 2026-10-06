/* Diffuser round-3b regressions (2026-10-06 fresh-eyes review, against a fake HA).

   B3/B8 — during an outage or signed out, both diffuser cards said the LED
           (and, on Climate, the whole diffuser) had "not reported yet" — false
           once it has reported, which it had seconds before the drop. The
           words now come from the connection: "not connected" while the
           socket is down / signed out / connecting, "state unknown" while the
           first snapshot is in flight. On phone the Overview strip hid the
           LED's state word entirely, so a disabled, unlit switch read "off".
   B7    — an off LED (HA: brightness and rgb_color null) read "65%" with the
           Ocean swatch pressed: the deleted GH_DATA mock's values, surviving
           as the starting brightness and DEFAULT_RGB. Brightness and the
           pressed swatch are now shown only for a lit LED, from HA's values.

   The real useEntity.js runs against a fake socket whose connection status
   and first-snapshot flag can change mid-test. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fake = vi.hoisted(() => {
  const h = {
    states: new Map(),
    subs: new Map(),
    conn: new Set(),
    snap: new Set(),
    status: "ready",
    snapshot: true,
    reset() {
      h.states.clear();
      h.subs.clear();
      h.conn.clear();
      h.snap.clear();
      h.status = "ready";
      h.snapshot = true;
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
  onSnapshotReady: (cb) => {
    if (fake.snapshot) cb();
    else fake.snap.add(cb);
    return () => fake.snap.delete(cb);
  },
  hasSnapshot: () => fake.snapshot,
  getConnectionStatus: () => fake.status,
  waitForConnection: () => Promise.reject(new Error("not used")),
  sendWsMessage: () => Promise.reject(new Error("not used")),
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push({ domain, service, data });
    return Promise.resolve();
  },
}));

const { DiffuserCard } = await import("../../src/cards/climate/DiffuserCard.jsx");
const { DiffuserMini } = await import("../../src/cards/overview/DiffuserMini.jsx");
const { DIFFUSER, pendingWhy } = await import("../../src/lib/diffuser.js");

const spray = (state) => ({ entity_id: DIFFUSER.spray, state, attributes: { options: ["off", "eco", "on"] } });
const led = (state, attributes) => ({ entity_id: DIFFUSER.light, state, attributes });
// What HA really sends for an off LED: the keys are there, the values null.
const LED_OFF = led("off", { brightness: null, rgb_color: null, color_mode: null });
const AMBER = [255, 176, 92];

const slider = () => screen.getByRole("slider", { name: "Diffuser LED brightness" });
const pressedSwatches = () => screen.getAllByRole("button", { name: /^LED colour/ })
  .filter((b) => b.getAttribute("aria-pressed") === "true")
  .map((b) => b.getAttribute("aria-label"));
const val = () => document.querySelector(".diff-bright .val").textContent;

beforeEach(() => {
  fake.reset();
  calls.length = 0;
});

describe("pendingWhy", () => {
  it("says 'not connected' for every not-ready connection and 'state unknown' while the snapshot is in flight", () => {
    for (const c of ["disconnected", "connecting", "authenticating"]) expect(pendingWhy(c)).toBe("not connected");
    expect(pendingWhy("ready")).toBe("state unknown");
  });
});

describe("B3 — DiffuserMini during an outage", () => {
  it("names the LED switch 'not connected' after a drop, never 'not reported yet'", () => {
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on", { brightness: 128, rgb_color: AMBER }));
    const { container } = render(<DiffuserMini />);
    act(() => fake.setStatus("disconnected"));
    expect(screen.getByRole("switch", { name: "Diffuser LED — not connected" })).toBeDisabled();
    expect(container.innerHTML).not.toContain("not reported yet");
  });

  it("says 'state unknown' while connected but the first snapshot hasn't landed", () => {
    fake.snapshot = false;
    render(<DiffuserMini />);
    expect(screen.getByRole("switch", { name: "Diffuser LED — state unknown" })).toBeDisabled();
  });

  it("marks the unknown LED word so phone keeps it on screen", () => {
    fake.status = "disconnected";
    const { container, unmount } = render(<DiffuserMini />);
    const w = container.querySelector(".dmini-led .w");
    expect(w).toHaveClass("unknown");
    expect(w.textContent).toBe("—");
    unmount();

    fake.status = "ready";
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("unavailable", {}));
    const again = render(<DiffuserMini />);
    expect(again.container.querySelector(".dmini-led .w")).toHaveClass("unknown");
    expect(again.container.querySelector(".dmini-led .w").textContent).toBe("Unavailable");
  });

  it("a known On/Off word is still the one phone hides", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, LED_OFF);
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".dmini-led .w")).not.toHaveClass("unknown");
  });

  it("diffuser.css shows .w.unknown on phone, after the rule that hides .w", () => {
    const css = readFileSync(resolve(__dirname, "../../src/styles/diffuser.css"), "utf8");
    const hide = css.indexOf("body.viewport-phone .dmini-led .w { display: none; }");
    const show = css.search(/body\.viewport-phone \.dmini-led \.w\.unknown \{ display: inline; \}/);
    expect(hide).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(hide);
  });
});

describe("B8 — DiffuserCard during an outage or signed out", () => {
  it("after a drop: 'state unknown — not connected', not 'has not reported yet'", () => {
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on", { brightness: 128, rgb_color: AMBER }));
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Spraying on eco. LED set to amber.");
    act(() => fake.setStatus("disconnected"));
    expect(container.querySelector(".lede").textContent).toBe("Diffuser state unknown — not connected to Home Assistant.");
    expect(screen.getByRole("switch", { name: "Diffuser LED light — not connected" })).toBeDisabled();
    expect(container.innerHTML).not.toContain("not reported yet");
  });

  it("signed out (never connected): the same true wording", () => {
    fake.status = "disconnected";
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Diffuser state unknown — not connected to Home Assistant.");
  });

  it("connected, first snapshot in flight: 'state unknown' and no claim about the connection", () => {
    fake.snapshot = false;
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Diffuser state unknown.");
    expect(screen.getByRole("switch", { name: "Diffuser LED light — state unknown" })).toBeDisabled();
  });
});

describe("B7 — an off LED shows no brightness or colour, and never the old mock's 65% / Ocean", () => {
  it("off with HA's null brightness and colour: '—', 'unknown', thumb at the bottom, nothing pressed", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, LED_OFF);
    const { container } = render(<DiffuserCard />);
    expect(val()).toBe("—");
    expect(slider()).toHaveAttribute("aria-valuetext", "unknown");
    expect(slider().value).toBe("1");
    expect(slider().style.getPropertyValue("--bp")).toBe("0%");
    expect(pressedSwatches()).toEqual([]);
    expect(container.textContent).not.toMatch(/65%|ocean/i);
    expect(container.querySelector(".lede").textContent).toBe("Mist is off. LED is off.");
  });

  it("follows HA on → off → on: real values when lit, none when off", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("on", { brightness: 128, rgb_color: AMBER }));
    render(<DiffuserCard />);
    expect(val()).toBe("50%");
    expect(pressedSwatches()).toEqual(["LED colour Amber"]);

    act(() => fake.set(DIFFUSER.light, LED_OFF));
    expect(val()).toBe("—");
    expect(pressedSwatches()).toEqual([]);

    act(() => fake.set(DIFFUSER.light, led("on", { brightness: 255, rgb_color: AMBER })));
    expect(val()).toBe("100%");
    expect(pressedSwatches()).toEqual(["LED colour Amber"]);
  });

  it("a lit LED with no reported brightness or colour (effect mode) claims neither", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("on", { brightness: null, rgb_color: null, effect: "rainbow" }));
    const { container } = render(<DiffuserCard />);
    expect(val()).toBe("—");
    expect(pressedSwatches()).toEqual([]);
    expect(container.querySelector(".lede").textContent).toBe("Mist is off. LED is on.");
    expect(container.textContent).not.toMatch(/ocean/i);
  });

  it("an unavailable LED doesn't leave the thumb at a remembered or default brightness", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("unavailable", {}));
    render(<DiffuserCard />);
    expect(val()).toBe("—");
    expect(slider().value).toBe("1");
  });

  it("the Overview strip doesn't name the old mock's colour for an LED HA gives no colour", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("on", { brightness: 128, rgb_color: null }));
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".sub").textContent).toBe("Standby · LED on");
  });

  it("…including an LED switched on from the strip before HA has echoed a colour", async () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, LED_OFF);
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".sub").textContent).toBe("Standby · LED off");
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Diffuser LED" })); });
    expect(calls.map((c) => c.service)).toEqual(["turn_on"]);
    expect(container.querySelector(".sub").textContent).toBe("Standby · LED on");
  });
});

// Mock mode is the screenshot harness: nothing here may throw or print NaN.
describe("mock mode", () => {
  it("renders both cards with no NaN, no 65% and no mock colour", () => {
    fake.status = "disconnected";
    const { container } = render(<><DiffuserCard /><DiffuserMini /></>);
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.textContent).not.toMatch(/65%|ocean/i);
    expect(slider().value).toBe("1");
  });
});
