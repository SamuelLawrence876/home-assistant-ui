/* Desk strip — round-3b review findings (2026-10-06).

   B4  Switching the strip to an RGB colour left the old colour temperature on
       screen: Red pressed, a red orb, and "4000K" beside them, indefinitely.
       RGB mode reports colorTemInKelvin 0, which parseGoveeProps rightly drops,
       and the card read the missing value as "keep the last one".
   B5  "Offline" (Govee can't reach the strip) got no warning badge, though an
       unavailable sensor gets one; and a focused control disabled by the
       drop handed keyboard focus to <body>. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixture = { current: { entity: null, status: "loading" } };
const calls = [];

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixture.current,
  useEntity: () => fixture.current.entity,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (domain, service, data) => {
    calls.push(`${domain}.${service} ${JSON.stringify(data)}`);
    return Promise.resolve();
  },
}));

const { DeskStripCard } = await import("../../src/cards/lights/DeskStripCard.jsx");

const strip = (props, state = "on") => ({
  entity: { entity_id: "sensor.desk_strip_state", state, attributes: { properties: props } },
  status: "ready",
});
const report = (...extra) => strip([{ online: true }, { powerState: "on" }, { brightness: 80 }, ...extra]);
const kelvinMode = (k) => report({ colorTemInKelvin: k });
const rgbMode = (r, g, b) => report({ color: { r, g, b } }, { colorTemInKelvin: 0 });
const offline = () => strip([{ online: false }, { powerState: "on" }, { brightness: 80 }, { color: { r: 255, g: 0, b: 0 } }]);
const unavailable = () => ({ entity: { state: "unavailable", attributes: {} }, status: "unavailable" });

const kelvinSlider = () => screen.getByRole("slider", { name: "Desk strip color temperature" });
const pressed = () => screen.getAllByRole("button", { name: /^Set Desk strip to / })
  .filter((b) => b.getAttribute("aria-pressed") === "true")
  .map((b) => b.getAttribute("aria-label"));
const heading = () => screen.getByRole("heading", { name: "Desk strip" });

beforeEach(() => {
  calls.length = 0;
  fixture.current = { entity: null, status: "loading" };
});

describe("B4 — an RGB colour carries no colour temperature", () => {
  it("a report that switches to RGB mode clears the temperature it had", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<DeskStripCard />);
    expect(screen.getByText("4000K")).toBeInTheDocument();

    fixture.current = rgbMode(255, 0, 0);
    rerender(<DeskStripCard />);
    expect(screen.queryByText("4000K")).toBeNull();
    expect(kelvinSlider().getAttribute("aria-valuetext")).toBe("unknown");
    expect(pressed()).toEqual(["Set Desk strip to Red"]);
  });

  it("the same on the reviewer's second route: 4000K with no colour, then Blue in RGB mode", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<DeskStripCard />);
    fixture.current = report({ color: { r: 0, g: 50, b: 255 } }, { colorTemInKelvin: 0 });
    rerender(<DeskStripCard />);
    expect(screen.queryByText("4000K")).toBeNull();
    expect(pressed()).toEqual(["Set Desk strip to Blue"]);
  });

  it("tapping an RGB swatch clears the temperature straight away, not just after the next poll", () => {
    fixture.current = kelvinMode(4000);
    render(<DeskStripCard />);
    expect(screen.getByText("4000K")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set Desk strip to Red" }));
    expect(screen.queryByText("4000K")).toBeNull();
    expect(kelvinSlider().getAttribute("aria-valuetext")).toBe("unknown");
    expect(pressed()).toEqual(["Set Desk strip to Red"]);
  });

  it("a reading the latest report leaves out is unknown, not the last one", () => {
    fixture.current = kelvinMode(4000);
    const { rerender, container } = render(<DeskStripCard />);
    fixture.current = strip([{ online: true }, { powerState: "on" }]);
    rerender(<DeskStripCard />);
    expect(container.querySelector(".meta").textContent).toBe("On");
    expect(container.textContent).not.toMatch(/80%|4000K/);
    expect(pressed()).toEqual([]);
  });

  describe("with the command queue and verify step running", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const settle = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    it("the reviewer's flow: Neutral 4000K, then Red, then Govee's RGB report", async () => {
      fixture.current = rgbMode(110, 180, 255);
      const { rerender } = render(<DeskStripCard />);
      fireEvent.click(screen.getByRole("button", { name: "Set Desk strip to Neutral 4000K" }));
      await settle(5000);
      fixture.current = kelvinMode(4000);
      rerender(<DeskStripCard />);
      await settle(5000);
      expect(screen.getByText("4000K")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Set Desk strip to Red" }));
      await settle(5000);
      fixture.current = rgbMode(255, 0, 0);
      rerender(<DeskStripCard />);
      await settle(5000);
      expect(screen.queryByText("4000K")).toBeNull();
      expect(kelvinSlider().getAttribute("aria-valuetext")).toBe("unknown");
      expect(pressed()).toEqual(["Set Desk strip to Red"]);
    });
  });
});

describe("B5 — an offline strip is flagged like an unavailable one", () => {
  it("shows the warning badge, in words that are true", () => {
    fixture.current = offline();
    render(<DeskStripCard />);
    expect(screen.getByRole("img", { name: "Desk strip offline" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /unavailable/ })).toBeNull();
  });

  it("an online strip has no badge", () => {
    fixture.current = kelvinMode(4000);
    render(<DeskStripCard />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("an unavailable sensor keeps EntityGuard's badge, and only one", () => {
    fixture.current = unavailable();
    const { container } = render(<DeskStripCard />);
    expect(container.querySelectorAll(".entity-warning-badge")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /unavailable/ })).toBeInTheDocument();
  });
});

describe("B5 — keyboard focus survives a control being disabled under it", () => {
  const isLost = () => document.activeElement === document.body || Boolean(document.activeElement?.disabled);

  it("the focused switch goes disabled when the strip drops offline: focus moves to the card heading", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<DeskStripCard />);
    const sw = screen.getByRole("switch", { name: "Desk strip" });
    act(() => sw.focus());
    expect(document.activeElement).toBe(sw);

    fixture.current = offline();
    rerender(<DeskStripCard />);
    expect(sw).toBeDisabled();
    expect(isLost()).toBe(false);
    expect(document.activeElement).toBe(heading());
  });

  it("a focused swatch when the sensor goes unavailable: the heading again", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<DeskStripCard />);
    act(() => screen.getByRole("button", { name: "Set Desk strip to Blue" }).focus());
    fixture.current = unavailable();
    rerender(<DeskStripCard />);
    expect(document.activeElement).toBe(heading());
  });

  it("a focused slider when the strip is switched off elsewhere: the switch, which is still live", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<DeskStripCard />);
    act(() => kelvinSlider().focus());
    fixture.current = strip([{ online: true }, { powerState: "off" }, { brightness: 80 }, { colorTemInKelvin: 4000 }]);
    rerender(<DeskStripCard />);
    expect(kelvinSlider()).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Desk strip" }));
  });

  it("focus the user has already moved elsewhere is left where it is", () => {
    fixture.current = kelvinMode(4000);
    const { rerender } = render(<><button type="button">elsewhere</button><DeskStripCard /></>);
    act(() => screen.getByRole("switch", { name: "Desk strip" }).focus());
    const away = screen.getByRole("button", { name: "elsewhere" });
    act(() => away.focus());
    fixture.current = offline();
    rerender(<><button type="button">elsewhere</button><DeskStripCard /></>);
    expect(document.activeElement).toBe(away);
  });

  it("nothing is sent and nothing focused when the card mounts already offline", () => {
    fixture.current = offline();
    render(<DeskStripCard />);
    expect(document.activeElement).toBe(document.body);
    expect(calls).toEqual([]);
  });
});
