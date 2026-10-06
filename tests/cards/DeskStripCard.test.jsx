/* The Govee desk strip. Two things are pinned here.

   1. Honesty. Until sensor.desk_strip_state has reported, the card knows
      nothing about the strip — it used to say a confident "Off" beside a live
      switch, with a 100% / 2700K that were just the initial useState values.
   2. The verify step. After a command the card asks HA to re-poll Govee "so
      it can correct itself if the strip didn't take the value". It couldn't:
      the resync effect only re-ran when a reported value *changed*, so a poll
      that came back with the strip's unchanged value — the exact case the
      verify exists for — left the optimistic value on screen for good. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixture = { current: { entity: null, status: "loading" } };
const calls = [];

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixture.current,
  useEntity: () => fixture.current.entity, // what the card read before useEntityStatus
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service} ${JSON.stringify(data)}`);
    return Promise.resolve();
  },
}));

const { DeskStripCard } = await import("../../src/cards/lights/DeskStripCard.jsx");
const { parseGoveeProps } = await import("../../src/cards/lights/goveeUtils.js");

const strip = (props, state = "on") => ({
  entity: { entity_id: "sensor.desk_strip_state", state, attributes: { properties: props } },
  status: "ready",
});
const onAt = (brightness, extra = [{ color: { r: 255, g: 198, b: 130 } }]) =>
  strip([{ online: true }, { powerState: "on" }, { brightness }, ...extra]);
const meta = (container) => container.querySelector(".meta")?.textContent;
const brightnessSlider = () => screen.getByRole("slider", { name: "Desk strip brightness" });

function drag(slider, value) {
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.pointerUp(slider, { target: { value: String(value) } });
}

beforeEach(() => {
  calls.length = 0;
  fixture.current = { entity: null, status: "loading" };
});

describe("DeskStripCard before the sensor has reported", () => {
  it("does not claim Off while still connecting", () => {
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("—");
    expect(screen.queryByText("Off")).toBeNull();
    const sw = screen.getByRole("switch", { name: "Desk strip — not reported yet" });
    expect(sw).toBeDisabled();
    expect(container.querySelector(".entity-loading")).not.toBeNull();
  });

  it("says Unavailable — with every control disabled and nothing sent — when the sensor is down", () => {
    fixture.current = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("Unavailable");
    expect(screen.getByRole("switch", { name: "Desk strip — unavailable" })).toBeDisabled();
    expect(brightnessSlider()).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Desk strip color temperature" })).toBeDisabled();
    for (const sw of screen.getAllByRole("button", { name: /^Set Desk strip to / })) expect(sw).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set Desk strip to Red" }));
    fireEvent.click(screen.getByRole("switch"));
    expect(calls).toEqual([]);
    // No made-up readouts behind the warning badge.
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.queryByText("2700K")).toBeNull();
    expect(screen.getByRole("img", { name: /unavailable/ })).toBeInTheDocument();
  });

  it("says Unavailable when the sensor does not exist", () => {
    fixture.current = { entity: null, status: "not_found" };
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("Unavailable");
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});

describe("DeskStripCard reading the strip", () => {
  it("shows the colour temperature the strip reports, not a default", () => {
    fixture.current = onAt(50, [{ colorTemInKelvin: 6500 }]);
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("On · 50%");
    expect(screen.getByText("6500K")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Desk strip color temperature" }).value).toBe("6500");
  });

  it("shows an em-dash for a temperature the strip has not reported (RGB mode reports 0)", () => {
    fixture.current = onAt(50, [{ color: { r: 255, g: 0, b: 0 } }, { colorTemInKelvin: 0 }]);
    render(<DeskStripCard />);
    expect(screen.queryByText("2700K")).toBeNull();
    expect(screen.queryByText("0K")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("takes power from the strip's own powerState", () => {
    fixture.current = strip([{ powerState: "off" }, { brightness: 40 }], "on");
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("Off");
    expect(screen.getByRole("switch", { name: "Desk strip" }).getAttribute("aria-checked")).toBe("false");
  });

  it("renders a malformed colour payload without crashing or printing NaN", () => {
    // jsdom drops an invalid inline colour on its own, so it can't show the
    // rgb(x, null, 3) reaching CSS — parseGoveeProps' tests below pin that.
    fixture.current = onAt(50, [{ color: { r: "x", g: null, b: 3 } }]);
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("On · 50%");
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe("parseGoveeProps", () => {
  it("reads every field Govee sends", () => {
    expect(
      parseGoveeProps({
        properties: [{ online: true }, { powerState: "on" }, { brightness: 82 }, { color: { r: 1, g: 2, b: 3 } }, { colorTem: 4000 }],
      }),
    ).toEqual({ power: "on", brightness: 82, color: [1, 2, 3], kelvin: 4000 });
  });

  it("drops anything it cannot read instead of defaulting it", () => {
    expect(parseGoveeProps({ properties: [null, { brightness: "lots" }, { color: {} }, { powerState: "maybe" }] })).toEqual({});
    expect(parseGoveeProps({ properties: "nope" })).toEqual({});
    expect(parseGoveeProps(undefined)).toEqual({});
  });
});

describe("DeskStripCard verify step", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("corrects itself when the re-poll says the strip never moved", async () => {
    fixture.current = onAt(80);
    render(<DeskStripCard />);
    drag(brightnessSlider(), 40);
    await settle(100);
    expect(calls).toContain('rest_command.govee_desk_strip_brightness {"value":40}');
    expect(screen.getByText("40%")).toBeInTheDocument(); // optimistic

    // Govee rejected it (a 429 rest_command doesn't raise), so the refresh
    // brings back the same 80 — HA writes no new state at all.
    await settle(3500);
    expect(calls).toContain('homeassistant.update_entity {"entity_id":"sensor.desk_strip_state"}');
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(brightnessSlider().value).toBe("80");
  });

  it("applies a poll that landed during the freeze once the freeze lifts", async () => {
    fixture.current = onAt(80);
    const { rerender } = render(<DeskStripCard />);
    drag(brightnessSlider(), 40);
    await settle(1000);
    fixture.current = onAt(60); // inside the freeze: ignored for now
    rerender(<DeskStripCard />);
    expect(screen.getByText("40%")).toBeInTheDocument();

    await settle(4000);
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("still ignores a stale poll mid-command, before the verify", async () => {
    fixture.current = onAt(80);
    const { rerender } = render(<DeskStripCard />);
    drag(brightnessSlider(), 40);
    await settle(1000);
    fixture.current = onAt(80); // a poll taken before the command landed
    rerender(<DeskStripCard />);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("keeps a value the strip did take", async () => {
    fixture.current = onAt(80);
    const { rerender } = render(<DeskStripCard />);
    drag(brightnessSlider(), 40);
    await settle(1000);
    fixture.current = onAt(40);
    rerender(<DeskStripCard />);
    await settle(4000);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });
});
