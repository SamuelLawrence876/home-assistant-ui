/* The Govee desk strip. Two things are pinned here.

   1. Honesty. Until sensor.desk_strip_state has reported, the card knows
      nothing about the strip — it used to say a confident "Off" beside a live
      switch, with a 100% / 2700K that were just the initial useState values.
   2. The verify step. After a command the card asks HA to re-poll Govee "so
      it can correct itself if the strip didn't take the value". It couldn't:
      the resync effect only re-ran when a reported value *changed*, so a poll
      that came back with the strip's unchanged value — the exact case the
      verify exists for — left the optimistic value on screen for good.

   Also: both sliders commit on the native change event (useRangeCommit), so
   an assistive-tech adjustment reaches the strip; and parseGoveeProps drops
   a finite-but-impossible reading ("On · 150%") instead of showing it. */
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

/* Moving a slider, the way every input method ends: the value is set, then
   input + change fire. A pointer release and a keyboard step fire the same
   change; VoiceOver / TalkBack fire nothing else. useRangeCommit sends it
   300ms later, so callers advance fake timers past that. */
function drag(slider, value) {
  fireEvent.input(slider, { target: { value: String(value) } });
  fireEvent.change(slider, { target: { value: String(value) } });
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
    ).toEqual({ online: true, power: "on", brightness: 82, color: [1, 2, 3], kelvin: 4000 });
  });

  it("reads online as Govee sends it, boolean or string, and nothing else", () => {
    const online = (v) => parseGoveeProps({ properties: [{ online: v }] }).online;
    expect(online(false)).toBe(false);
    expect(online("false")).toBe(false);
    expect(online(true)).toBe(true);
    expect(online("true")).toBe(true);
    for (const junk of [0, 1, "no", null, undefined, {}]) expect(online(junk)).toBeUndefined();
  });

  it("drops anything it cannot read instead of defaulting it", () => {
    expect(parseGoveeProps({ properties: [null, { brightness: "lots" }, { color: {} }, { powerState: "maybe" }] })).toEqual({});
    expect(parseGoveeProps({ properties: "nope" })).toEqual({});
    expect(parseGoveeProps(undefined)).toEqual({});
  });

  it("drops finite readings the strip could not be at, rather than show or clamp them", () => {
    expect(
      parseGoveeProps({
        properties: [{ brightness: 150 }, { color: { r: 999, g: -5, b: 1e9 } }, { colorTemInKelvin: 1e9 }],
      }),
    ).toEqual({});
    expect(parseGoveeProps({ properties: [{ brightness: -1 }, { colorTem: 500 }] })).toEqual({});
  });

  it("keeps the edges of each range", () => {
    expect(parseGoveeProps({ properties: [{ brightness: 0 }, { color: { r: 0, g: 255, b: 0 } }, { colorTemInKelvin: 2000 }] }))
      .toEqual({ brightness: 0, color: [0, 255, 0], kelvin: 2000 });
    expect(parseGoveeProps({ properties: [{ brightness: 100 }, { colorTemInKelvin: 9000 }] }))
      .toEqual({ brightness: 100, kelvin: 9000 });
  });
});

describe("DeskStripCard — out-of-range readings and screen-reader values", () => {
  it("an impossible payload reads On with em-dashes, not 'On · 150%' and '1000000000K'", () => {
    fixture.current = strip([
      { powerState: "on" }, { brightness: 150 }, { color: { r: 999, g: -5, b: 1e9 } }, { colorTemInKelvin: 1e9 },
    ]);
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("On");
    expect(container.textContent).not.toMatch(/150|1000000000/);
    expect(brightnessSlider().getAttribute("aria-valuetext")).toBe("unknown");
  });

  it("says 'unknown' to a screen reader where the readout says —, and the % where it shows one", () => {
    fixture.current = onAt(50, [{ color: { r: 255, g: 0, b: 0 } }, { colorTemInKelvin: 0 }]); // RGB mode
    render(<DeskStripCard />);
    expect(brightnessSlider().getAttribute("aria-valuetext")).toBe("50%");
    expect(screen.getByRole("slider", { name: "Desk strip color temperature" }).getAttribute("aria-valuetext")).toBe("unknown");
  });

  it("stops showing the last readings once the sensor drops out", () => {
    fixture.current = onAt(50, [{ colorTemInKelvin: 6500 }]);
    const { container, rerender } = render(<DeskStripCard />);
    expect(screen.getByText("6500K")).toBeInTheDocument();
    fixture.current = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
    rerender(<DeskStripCard />);
    expect(meta(container)).toBe("Unavailable");
    expect(container.textContent).not.toMatch(/50%|6500K/);
  });
});

describe("DeskStripCard — sliders commit from assistive tech", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("an AT brightness adjustment (input + change, no pointer or key) reaches the strip", async () => {
    fixture.current = onAt(80);
    render(<DeskStripCard />);
    drag(brightnessSlider(), 20);
    await settle(400);
    expect(calls).toEqual(['rest_command.govee_desk_strip_brightness {"value":20}']);
  });

  it("an AT colour-temperature adjustment reaches the strip", async () => {
    fixture.current = onAt(80, [{ colorTemInKelvin: 4000 }]);
    render(<DeskStripCard />);
    drag(screen.getByRole("slider", { name: "Desk strip color temperature" }), 6000);
    await settle(400);
    expect(calls).toEqual(['rest_command.govee_desk_strip_color_temp {"value":6000}']);
  });

  it("tabbing onto a slider sends nothing", async () => {
    fixture.current = onAt(80);
    render(<DeskStripCard />);
    fireEvent.keyUp(brightnessSlider(), { key: "Tab" });
    await settle(1000);
    expect(calls).toEqual([]);
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
    await settle(400);
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

/* The sensor reporting is not the strip reporting. When the Govee cloud says
   the strip itself is offline (unplugged, off Wi-Fi), its powerState is just
   the last thing it said and a command goes nowhere — it used to read
   "On · 80%" beside a live switch, sliders and swatches. */
describe("DeskStripCard — Govee says the strip is offline", () => {
  const offlineStrip = (online = false) =>
    strip([{ online }, { powerState: "on" }, { brightness: 80 }, { color: { r: 255, g: 0, b: 0 } }]);
  const swatches = () => screen.getAllByRole("button", { name: /^Set Desk strip to / });

  it("reads Offline with every control disabled, no stale state, and nothing sent", () => {
    fixture.current = offlineStrip();
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("Offline");
    const sw = screen.getByRole("switch", { name: "Desk strip — offline" });
    expect(sw).toBeDisabled();
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(brightnessSlider()).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Desk strip color temperature" })).toBeDisabled();
    for (const b of swatches()) {
      expect(b).toBeDisabled();
      expect(b.getAttribute("aria-pressed")).toBe("false"); // not the last-reported Red
    }
    expect(container.textContent).not.toMatch(/80%|On ·/);
    fireEvent.click(sw);
    fireEvent.click(screen.getByRole("button", { name: "Set Desk strip to Blue" }));
    expect(calls).toEqual([]);
  });

  it("takes Govee's string \"false\" the same way", () => {
    fixture.current = offlineStrip("false");
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("Offline");
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("re-reads the strip when it comes back online", () => {
    fixture.current = onAt(50);
    const { container, rerender } = render(<DeskStripCard />);
    fixture.current = offlineStrip();
    rerender(<DeskStripCard />);
    expect(meta(container)).toBe("Offline");
    fixture.current = onAt(80);
    rerender(<DeskStripCard />);
    expect(meta(container)).toBe("On · 80%");
    expect(screen.getByRole("switch", { name: "Desk strip" })).not.toBeDisabled();
  });

  it("a payload without `online` is read as before", () => {
    fixture.current = strip([{ powerState: "on" }, { brightness: 40 }]);
    const { container } = render(<DeskStripCard />);
    expect(meta(container)).toBe("On · 40%");
    expect(screen.getByRole("switch", { name: "Desk strip" })).not.toBeDisabled();
  });
});

describe("DeskStripCard — no swatch pressed for a colour nobody reported", () => {
  const pressed = () => screen.getAllByRole("button", { name: /^Set Desk strip to / })
    .filter((b) => b.getAttribute("aria-pressed") === "true");

  it("an unavailable sensor presses nothing (Amber 2700K used to be the default)", () => {
    fixture.current = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
    render(<DeskStripCard />);
    expect(pressed()).toEqual([]);
  });

  it("a strip that reported power and brightness but no colour presses nothing", () => {
    fixture.current = strip([{ powerState: "on" }, { brightness: 40 }]);
    render(<DeskStripCard />);
    expect(pressed()).toEqual([]);
  });

  it("a reported colour still presses its swatch", () => {
    fixture.current = onAt(40); // 255,198,130 = Amber 2700K
    render(<DeskStripCard />);
    expect(pressed().map((b) => b.getAttribute("aria-label"))).toEqual(["Set Desk strip to Amber 2700K"]);
  });
});
