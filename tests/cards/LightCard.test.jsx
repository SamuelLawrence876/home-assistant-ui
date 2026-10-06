/* The Lights tab's bulb card. Every control is optimistic — the card moves
   the moment you touch it — so what it does when Home Assistant says no is
   the whole question. A failed call has to put back what HA says *now*: the
   resync effect only fires when a value changes, so a call that failed and
   left HA where it was used to leave the optimistic colour or brightness on
   screen indefinitely. And a light the card can't reach must not offer
   controls that move without sending anything — nor wear the mock's state:
   an unavailable bathroom bulb used to read "On · 78%" with a lit orb while
   HA had it off. Sliders commit on the native change event (useRangeCommit),
   so an assistive-tech adjustment reaches HA too. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixture = { current: { entity: null, status: "loading" } };
const calls = [];
const outcome = { next: () => Promise.resolve() };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixture.current,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push({ domain, service, data });
    return outcome.next();
  },
}));

const { LightCard } = await import("../../src/cards/lights/LightCard.jsx");

const ID = "light.living_room";
const light = (state, attrs = {}) => ({
  entity: {
    entity_id: ID,
    state,
    attributes: {
      friendly_name: "Living room",
      supported_color_modes: ["color_temp", "rgb"],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
      ...(state === "on"
        ? { brightness: 128, color_temp_kelvin: 3000, rgb_color: [255, 200, 150] }
        : { brightness: null, color_temp_kelvin: null, rgb_color: null }),
      ...attrs,
    },
  },
  status: "ready",
});
const unavailable = () => ({ entity: { entity_id: ID, state: "unavailable", attributes: {} }, status: "unavailable" });
const reject = () => Promise.reject(new Error("Tuya cloud timeout"));
const flush = () => act(async () => {});
const meta = (container) => container.querySelector(".meta")?.textContent;
const brightness = () => screen.getByRole("slider", { name: "Living room brightness" });
const colorTemp = () => screen.getByRole("slider", { name: "Living room color temperature" });
const readouts = (container) =>
  [...container.querySelectorAll("span[style*='font-mono']")].map((n) => n.textContent);
const pressed = () =>
  screen.queryAllByRole("button", { name: /^Set Living room to / }).filter((b) => b.getAttribute("aria-pressed") === "true");

/* What VoiceOver / TalkBack do to a range input: set the value, fire input +
   change, no pointer or key event. A pointer release and a keyboard step fire
   the same change, so this is the one path every way of moving it shares.
   Needs fake timers — useRangeCommit debounces the send. */
function adjust(slider, value) {
  fireEvent.input(slider, { target: { value: String(value) } });
  fireEvent.change(slider, { target: { value: String(value) } });
  act(() => { vi.advanceTimersByTime(300); });
}

function deferred() {
  let resolve, rejectFn;
  const promise = new Promise((res, rej) => { resolve = res; rejectFn = rej; });
  return { promise, resolve, reject: rejectFn };
}

beforeEach(() => {
  calls.length = 0;
  outcome.next = () => Promise.resolve();
  fixture.current = { entity: null, status: "loading" };
});
afterEach(() => vi.useRealTimers());

describe("LightCard — a failed call puts back what HA says", () => {
  it("tapping a colour on an off light, then failing, leaves it reading Off with no swatch pressed", async () => {
    fixture.current = light("off");
    outcome.next = reject;
    const { container } = render(<LightCard entityId={ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Set Living room to Red" }));
    await flush();

    expect(calls).toHaveLength(1);
    expect(meta(container)).toBe("Off");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "Set Living room to Red" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a failed brightness change goes back to HA's brightness", async () => {
    vi.useFakeTimers();
    fixture.current = light("on"); // 128 → 50%
    outcome.next = reject;
    const { container } = render(<LightCard entityId={ID} />);
    adjust(brightness(), 51); // 20%
    await flush();

    expect(calls.at(-1).data).toEqual({ entity_id: ID, brightness: 51 });
    expect(brightness().value).toBe("128");
    expect(meta(container)).toBe("On · 50%");
  });

  it("a failed colour-temperature change goes back to HA's temperature", async () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    outcome.next = reject;
    render(<LightCard entityId={ID} />);
    adjust(colorTemp(), 5500);
    await flush();

    expect(colorTemp().value).toBe("3000");
    expect(screen.getByText("3000K")).toBeInTheDocument();
  });

  it("a failed toggle reverts to HA's state at failure time, not the one at click time", async () => {
    // Off when tapped; an automation turns it on while our call is in flight;
    // then our call fails. Reverting to the click-time "off" would stick,
    // because HA's state string doesn't change again.
    fixture.current = light("off");
    const d = deferred();
    outcome.next = () => d.promise;
    const { rerender } = render(<LightCard entityId={ID} />);
    fireEvent.click(screen.getByRole("switch"));
    fixture.current = light("on");
    rerender(<LightCard entityId={ID} />);
    await act(async () => d.reject(new Error("nope")));

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("a successful call keeps the optimistic value", async () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    adjust(brightness(), 51);
    await flush();
    expect(brightness().value).toBe("51");
  });
});

describe("LightCard — sliders commit from assistive tech, not just pointer and keys", () => {
  it("an AT brightness adjustment reaches HA", () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    adjust(brightness(), 153);
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: ID, brightness: 153 } }]);
  });

  it("an AT colour-temperature adjustment reaches HA", () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    adjust(colorTemp(), 5000);
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: ID, color_temp_kelvin: 5000 } }]);
    expect(screen.getByText("5000K")).toBeInTheDocument();
  });

  it("tabbing onto a slider sends nothing", () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    fireEvent.keyUp(brightness(), { key: "Tab" });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toEqual([]);
  });

  it("does not send a brightness for a light switched off before the debounce ran", () => {
    vi.useFakeTimers();
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    fireEvent.change(brightness(), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("switch")); // turn_off, inside the 300ms
    act(() => { vi.advanceTimersByTime(300); });
    expect(calls.map((c) => c.service)).toEqual(["turn_off"]);
  });

  it("announces brightness as the % the readout shows, not HA's 0–255", () => {
    fixture.current = light("on"); // 128
    render(<LightCard entityId={ID} />);
    expect(brightness().getAttribute("aria-valuetext")).toBe("50%");
    expect(colorTemp().getAttribute("aria-valuetext")).toBe("3000K");
  });
});

describe("LightCard — an unreachable light offers no live controls", () => {
  it("disables both sliders and every swatch, not just the switch", () => {
    // The mock behind an unavailable living-room light reads "on", which used
    // to leave both sliders enabled — they moved, and nothing was sent.
    fixture.current = unavailable();
    render(<LightCard entityId={ID} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(brightness()).toBeDisabled();
    expect(colorTemp()).toBeDisabled();
    for (const sw of screen.getAllByRole("button", { name: /^Set Living room to / })) expect(sw).toBeDisabled();
  });

  it("sends nothing when a swatch is tapped", () => {
    fixture.current = unavailable();
    render(<LightCard entityId={ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Set Living room to Red" }));
    expect(calls).toEqual([]);
  });

  it("keeps the controls enabled for a light that is ready and on", () => {
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    expect(brightness()).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Set Living room to Red" })).not.toBeDisabled();
  });

  it("still renders the loading skeleton in mock mode", () => {
    const { container } = render(<LightCard entityId={ID} />);
    expect(container.querySelector(".entity-loading")).not.toBeNull();
  });
});

describe("LightCard — the mock is layout, never state", () => {
  it("unavailable: says Unavailable, not the mock's 'On · 71%', with nothing lit or pressed", () => {
    fixture.current = unavailable(); // the living-room mock is on at 180 / 2700K
    const { container } = render(<LightCard entityId={ID} />);
    expect(meta(container)).toBe("Unavailable");
    const sw = screen.getByRole("switch", { name: "Living room — unavailable" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    // Header readout included: no %, no K, from the mock or anywhere else.
    expect(readouts(container)).toEqual(["—", "—"]);
    expect(container.textContent).not.toMatch(/\d+%|\d+K/);
    expect(pressed()).toEqual([]);
    expect(brightness().getAttribute("aria-valuetext")).toBe("unknown");
    expect(colorTemp().getAttribute("aria-valuetext")).toBe("unknown");
    // The badge still says why.
    expect(screen.getByRole("img", { name: `${ID} unavailable` })).toBeInTheDocument();
  });

  it("missing from HA: the same — the mock keeps the card's shape only", () => {
    fixture.current = { entity: null, status: "not_found" };
    const { container } = render(<LightCard entityId="light.bathroom" />); // mock: on, 78%
    expect(meta(container)).toBe("Unavailable");
    expect(screen.getByRole("switch", { name: "Bathroom — unavailable" }).getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).not.toMatch(/78%|4000K/);
    expect(screen.queryAllByRole("button", { name: /^Set Bathroom to / })
      .filter((b) => b.getAttribute("aria-pressed") === "true")).toEqual([]);
  });

  it("loading (HA down, or mock mode): an em-dash in the header and a switch that isn't on", () => {
    const { container } = render(<LightCard entityId="light.bathroom" />);
    expect(meta(container)).toBe("—");
    const sw = screen.getByRole("switch", { name: "Bathroom — not reported yet" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw).toBeDisabled();
  });

  it("an unavailable light that comes back re-reads HA, even if nothing else changed", () => {
    fixture.current = light("on");
    const { container, rerender } = render(<LightCard entityId={ID} />);
    expect(meta(container)).toBe("On · 50%");
    fixture.current = unavailable();
    rerender(<LightCard entityId={ID} />);
    expect(meta(container)).toBe("Unavailable");
    fixture.current = light("off");
    rerender(<LightCard entityId={ID} />);
    expect(meta(container)).toBe("Off");
    expect(screen.getByRole("switch", { name: "Living room" }).getAttribute("aria-checked")).toBe("false");
  });

  it("an off bulb HA reports no brightness or colour for shows em-dashes, not defaults", () => {
    fixture.current = light("off");
    const { container } = render(<LightCard entityId={ID} />);
    expect(meta(container)).toBe("Off");
    expect(readouts(container)).toEqual(["—", "—"]);
    expect(pressed()).toEqual([]); // used to press "Amber 2700K", the default colour
  });
});
