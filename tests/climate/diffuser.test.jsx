/* Meross diffuser: the Climate-tab DiffuserCard and the Overview DiffuserMini.

   meross_lan marks every entity of an offline device "unavailable". Both
   cards used to copy that string into `mode`, and `mode !== "off"` read it as
   misting: a green "On · Spraying · unavailable", animated mist, and an LED
   switch that stayed live and stuck at "On" when tapped. These tests pin the
   unknown case, keep the pre-connection mock fallback (mock mode) intact, and
   pin the brightness slider to one service call per gesture, not per step —
   sent on the native change event (useRangeCommit), so an assistive-tech
   adjustment reaches HA too. And a live spray mode the card does not know is
   a third state: not "Off · Standby", and not a confident "Spraying". */
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
    calls.push({ domain, service, data });
    return failCalls ? Promise.reject(new Error("nope")) : Promise.resolve();
  },
}));

const { DiffuserCard } = await import("../../src/cards/climate/DiffuserCard.jsx");
const { DiffuserMini } = await import("../../src/cards/overview/DiffuserMini.jsx");
const { DIFFUSER, SPRAY_OPTIONS, sprayOptions, sprayPhase } = await import("../../src/lib/diffuser.js");

const spray = (state, options = ["off", "eco", "on"]) => ({ entity_id: DIFFUSER.spray, state, attributes: { options } });
const led = (state, attributes = { brightness: 128, rgb_color: [96, 170, 255] }) =>
  ({ entity_id: DIFFUSER.light, state, attributes: state === "on" ? attributes : {} });
const offline = () => {
  fake.set(DIFFUSER.spray, spray("unavailable"));
  fake.set(DIFFUSER.light, led("unavailable"));
};
const flush = () => act(() => Promise.resolve());
const brightSlider = () => screen.getByRole("slider", { name: "Diffuser LED brightness" });
// useRangeCommit sends 300ms after the slider's change event.
const commitWait = () => act(() => { vi.advanceTimersByTime(300); });

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  failCalls = false;
});
afterEach(() => vi.useRealTimers());

describe("DiffuserCard", () => {
  it("says an offline diffuser is unavailable — no 'Misting · unavailable', no mist", () => {
    offline();
    const { container } = render(<DiffuserCard />);
    expect(container.textContent).not.toMatch(/Misting|Spraying|Mist on/);
    expect(container.querySelector(".diff-mist")).toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(container.querySelector(".lede").textContent).toBe("Diffuser is unavailable. LED is unavailable.");
  });

  it("disables every control of an offline diffuser and sends nothing", () => {
    offline();
    render(<DiffuserCard />);
    for (const b of screen.getAllByRole("button", { name: /^(off|eco|on)$/ })) expect(b).toBeDisabled();
    const sw = screen.getByRole("switch", { name: "Diffuser LED light" });
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(brightSlider()).toBeDisabled();
    expect(brightSlider().getAttribute("aria-valuetext")).toBe("unknown");
    expect(document.querySelector(".diff-bright .val").textContent).toBe("—");
    expect(calls).toEqual([]);
  });

  it("treats a missing spray entity as unknown, not as the mock's 'eco'", () => {
    fake.set(DIFFUSER.light, led("off"));
    const { container } = render(<DiffuserCard />);
    expect(container.textContent).not.toContain("eco.");
    expect(container.querySelector(".lede").textContent).toMatch(/^Diffuser is unavailable\./);
  });

  it("still renders the GH_DATA fallback before Home Assistant has answered (mock mode)", () => {
    fake.status = "connecting";
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Spraying on eco. LED set to ocean.");
    expect(container.querySelector(".diff-mist")).not.toBeNull();
    expect(screen.getByRole("button", { name: "eco" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reads a live, misting diffuser as misting", () => {
    fake.set(DIFFUSER.spray, spray("on"));
    fake.set(DIFFUSER.light, led("off"));
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Spraying on on. LED is off.");
    expect(screen.getByText("Misting · on")).toBeTruthy();
  });

  it("an unrecognised live spray mode is reported as-is — not 'Mist is off', no mist drawn", () => {
    fake.set(DIFFUSER.spray, spray("turbo"));
    fake.set(DIFFUSER.light, led("off"));
    const { container } = render(<DiffuserCard />);
    expect(container.querySelector(".lede").textContent).toBe("Mist reports turbo. LED is off.");
    expect(container.querySelector(".meta").textContent).toBe("Mist: turbo");
    expect(container.textContent).not.toMatch(/Mist off|Standby|Mist is off/);
    expect(container.querySelector(".diff-mist")).toBeNull();
  });
});

describe("DiffuserCard — brightness slider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on"));
  });

  it("sends one brightness command per gesture, once it settles — not one per step", () => {
    render(<DiffuserCard />);
    // A held arrow key: a change per step, each inside the debounce.
    for (let v = 10; v <= 90; v++) {
      fireEvent.change(brightSlider(), { target: { value: String(v) } });
      act(() => { vi.advanceTimersByTime(20); });
    }
    expect(calls).toEqual([]);
    commitWait();
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: DIFFUSER.light, brightness_pct: 90 } }]);
  });

  it("commits an assistive-tech adjustment (input + change, no pointer or key)", () => {
    render(<DiffuserCard />);
    fireEvent.input(brightSlider(), { target: { value: "20" } });
    fireEvent.change(brightSlider(), { target: { value: "20" } });
    commitWait();
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: DIFFUSER.light, brightness_pct: 20 } }]);
    expect(document.querySelector(".diff-bright .val").textContent).toBe("20%");
  });

  it("sends nothing for the Tab that focused the slider", () => {
    render(<DiffuserCard />);
    fireEvent.keyUp(brightSlider(), { key: "Tab" });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toEqual([]);
  });

  it("does not switch the LED back on with a brightness that settles after it was turned off", () => {
    // light.turn_on with a brightness turns the light on, so a debounced send
    // that outlives an "off" tap must be dropped, not sent.
    render(<DiffuserCard />);
    fireEvent.change(brightSlider(), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("switch", { name: "Diffuser LED light" }));
    commitWait();
    expect(calls.map((c) => c.service)).toEqual(["turn_off"]);
  });

  it("puts the brightness back to HA's value when the command fails", async () => {
    failCalls = true;
    render(<DiffuserCard />);
    fireEvent.change(brightSlider(), { target: { value: "90" } });
    commitWait();
    await flush();
    expect(brightSlider().value).toBe(String(Math.round(128 / 2.55)));
  });
});

describe("DiffuserMini", () => {
  it("says an offline diffuser is unavailable instead of a green 'On · Spraying · unavailable'", () => {
    offline();
    const { container } = render(<DiffuserMini />);
    const head = container.querySelector(".gs-status");
    expect(head.textContent).toBe("Unavailable");
    expect(head.style.getPropertyValue("--gs-color")).toBe("var(--ink-4)");
    expect(container.querySelector(".sub").textContent).toBe("Unavailable");
  });

  it("disables the mist segments and the LED switch while the diffuser is unavailable", () => {
    offline();
    render(<DiffuserMini />);
    for (const b of screen.getAllByRole("button", { name: /^(off|eco|on)$/ })) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByRole("switch", { name: "Diffuser LED" })).toBeDisabled();
  });

  it("keeps the mock fallback before Home Assistant has answered (mock mode)", () => {
    fake.status = "connecting";
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".gs-status").textContent).toBe("On");
    expect(container.querySelector(".sub").textContent).toBe("Spraying · eco · ocean");
  });

  it("names which half is unknown when only one is", () => {
    fake.set(DIFFUSER.spray, spray("off"));
    fake.set(DIFFUSER.light, led("unavailable"));
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".gs-status").textContent).toBe("Off");
    expect(container.querySelector(".sub").textContent).toBe("Standby · LED unavailable");
  });

  it("does not call an unrecognised spray mode Off", () => {
    // Used to read "Off" / "Standby · ocean" with no segment pressed.
    fake.set(DIFFUSER.spray, spray("turbo"));
    fake.set(DIFFUSER.light, led("on"));
    const { container } = render(<DiffuserMini />);
    const head = container.querySelector(".gs-status");
    expect(head.textContent).toBe("—");
    expect(head.style.getPropertyValue("--gs-color")).toBe("var(--ink-4)");
    expect(container.querySelector(".sub").textContent).toBe("Mist: turbo · ocean");
    for (const b of screen.getAllByRole("button", { name: /^(off|eco|on)$/ })) {
      expect(b).toHaveAttribute("aria-pressed", "false");
      expect(b).not.toBeDisabled(); // the device is there; picking a known mode is fine
    }
  });

  it("reads a mode the select itself offers as spraying, with a segment for it", () => {
    fake.set(DIFFUSER.spray, spray("turbo", ["off", "eco", "on", "turbo"]));
    fake.set(DIFFUSER.light, led("off"));
    const { container } = render(<DiffuserMini />);
    expect(container.querySelector(".gs-status").textContent).toBe("On");
    expect(container.querySelector(".sub").textContent).toBe("Spraying · turbo · LED off");
    expect(screen.getByRole("button", { name: "turbo" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("sprayOptions / sprayPhase", () => {
  it("takes the select's own options, and falls back when HA stripped or mangled them", () => {
    expect(sprayOptions(spray("on", ["off", "on", "turbo"]))).toEqual(["off", "on", "turbo"]);
    expect(sprayOptions({ state: "unavailable", attributes: {} })).toBe(SPRAY_OPTIONS);
    expect(sprayOptions(spray("on", []))).toBe(SPRAY_OPTIONS);
    expect(sprayOptions(spray("on", ["off", 3]))).toBe(SPRAY_OPTIONS);
    expect(sprayOptions(undefined)).toBe(SPRAY_OPTIONS);
  });

  it("is three-way: off, a mode the select offers, or unrecognised", () => {
    expect(sprayPhase("off")).toBe("off");
    expect(sprayPhase("eco")).toBe("spraying");
    expect(sprayPhase("turbo")).toBe("unrecognised");
    expect(sprayPhase("turbo", ["off", "turbo"])).toBe("spraying");
  });
});
