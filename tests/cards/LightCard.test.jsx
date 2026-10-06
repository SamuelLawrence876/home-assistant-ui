/* The Lights tab's bulb card. Every control is optimistic — the card moves
   the moment you touch it — so what it does when Home Assistant says no is
   the whole question. A failed call has to put back what HA says *now*: the
   resync effect only fires when a value changes, so a call that failed and
   left HA where it was used to leave the optimistic colour or brightness on
   screen indefinitely. And a light the card can't reach must not offer
   controls that move without sending anything. */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
const reject = () => Promise.reject(new Error("Tuya cloud timeout"));
const flush = () => act(async () => {});
const meta = (container) => container.querySelector(".meta")?.textContent;

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
    fixture.current = light("on"); // 128 → 50%
    outcome.next = reject;
    const { container } = render(<LightCard entityId={ID} />);
    const slider = screen.getByRole("slider", { name: "Living room brightness" });
    fireEvent.change(slider, { target: { value: "51" } }); // 20%
    fireEvent.pointerUp(slider, { target: { value: "51" } });
    await flush();

    expect(calls.at(-1).data).toEqual({ entity_id: ID, brightness: 51 });
    expect(slider.value).toBe("128");
    expect(meta(container)).toBe("On · 50%");
  });

  it("a failed colour-temperature change goes back to HA's temperature", async () => {
    fixture.current = light("on");
    outcome.next = reject;
    render(<LightCard entityId={ID} />);
    const slider = screen.getByRole("slider", { name: "Living room color temperature" });
    fireEvent.change(slider, { target: { value: "5500" } });
    fireEvent.pointerUp(slider, { target: { value: "5500" } });
    await flush();

    expect(slider.value).toBe("3000");
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
    fixture.current = light("on");
    render(<LightCard entityId={ID} />);
    const slider = screen.getByRole("slider", { name: "Living room brightness" });
    fireEvent.change(slider, { target: { value: "51" } });
    fireEvent.pointerUp(slider, { target: { value: "51" } });
    await flush();
    expect(slider.value).toBe("51");
  });
});

describe("LightCard — an unreachable light offers no live controls", () => {
  const unavailable = () => ({ entity: { entity_id: ID, state: "unavailable", attributes: {} }, status: "unavailable" });

  it("disables both sliders and every swatch, not just the switch", () => {
    // The mock behind an unavailable living-room light reads "on", which used
    // to leave both sliders enabled — they moved, and nothing was sent.
    fixture.current = unavailable();
    render(<LightCard entityId={ID} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Living room brightness" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Living room color temperature" })).toBeDisabled();
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
    expect(screen.getByRole("slider", { name: "Living room brightness" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Set Living room to Red" })).not.toBeDisabled();
  });

  it("still renders the loading skeleton in mock mode", () => {
    const { container } = render(<LightCard entityId={ID} />);
    expect(container.querySelector(".entity-loading")).not.toBeNull();
  });
});
