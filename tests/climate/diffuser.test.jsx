/* Meross diffuser: the Climate-tab DiffuserCard and the Overview DiffuserMini.

   meross_lan marks every entity of an offline device "unavailable". Both
   cards used to copy that string into `mode`, and `mode !== "off"` read it as
   misting: a green "On · Spraying · unavailable", animated mist, and an LED
   switch that stayed live and stuck at "On" when tapped. These tests pin the
   unknown case, keep the pre-connection mock fallback (mock mode) intact, and
   pin the brightness slider to one service call per gesture, not per step. */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
const { DIFFUSER } = await import("../../src/lib/diffuser.js");

const spray = (state) => ({ entity_id: DIFFUSER.spray, state, attributes: { options: ["off", "eco", "on"] } });
const led = (state, attributes = { brightness: 128, rgb_color: [96, 170, 255] }) =>
  ({ entity_id: DIFFUSER.light, state, attributes: state === "on" ? attributes : {} });
const offline = () => {
  fake.set(DIFFUSER.spray, spray("unavailable"));
  fake.set(DIFFUSER.light, led("unavailable"));
};
const flush = () => act(() => Promise.resolve());

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  failCalls = false;
});

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
    expect(screen.getByRole("slider", { name: "Diffuser LED brightness" })).toBeDisabled();
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

  it("sends one brightness command per drag, on release — not one per step", () => {
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on"));
    render(<DiffuserCard />);
    const slider = screen.getByRole("slider", { name: "Diffuser LED brightness" });
    for (let v = 10; v <= 90; v++) fireEvent.change(slider, { target: { value: String(v) } });
    expect(calls).toEqual([]);
    fireEvent.pointerUp(slider, { target: { value: "90" } });
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: DIFFUSER.light, brightness_pct: 90 } }]);
  });

  it("commits from the keyboard only on a value key, not on the Tab that focused it", () => {
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on"));
    render(<DiffuserCard />);
    const slider = screen.getByRole("slider", { name: "Diffuser LED brightness" });
    fireEvent.keyUp(slider, { key: "Tab" });
    expect(calls).toEqual([]);
    fireEvent.change(slider, { target: { value: "51" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(calls).toHaveLength(1);
    expect(calls[0].data.brightness_pct).toBe(51);
  });

  it("puts the brightness back to HA's value when the command fails", async () => {
    fake.set(DIFFUSER.spray, spray("eco"));
    fake.set(DIFFUSER.light, led("on", { brightness: 128, rgb_color: [96, 170, 255] }));
    failCalls = true;
    render(<DiffuserCard />);
    const slider = screen.getByRole("slider", { name: "Diffuser LED brightness" });
    fireEvent.change(slider, { target: { value: "90" } });
    fireEvent.pointerUp(slider);
    await flush();
    expect(slider.value).toBe(String(Math.round(128 / 2.55)));
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
});
