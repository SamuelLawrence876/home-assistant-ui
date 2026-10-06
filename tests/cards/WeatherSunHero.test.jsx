/* The Overview / Climate weather card.

   Two findings: its sun readout followed the Tweaks Mode instead of the real
   sun (shell-overview-lights#3), and conditions outside the six it knew got a
   sun icon and HA's raw slug for a label (data-layer#5). The card now takes
   App's sunReadout() as `sun`; these tests hand it one directly. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { sunReadout } from "../../src/theme.js";

const fixtures = { entities: {}, forecast: { forecast: [], status: "loading" } };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => fixtures.entities[id] ?? { entity: undefined, status: "loading" },
  combineStatuses: (...s) =>
    s.includes("loading") ? "loading" : s.includes("not_found") ? "not_found" : s.includes("unavailable") ? "unavailable" : "ready",
}));
vi.mock("../../src/ha/useForecast.js", () => ({ useForecast: () => fixtures.forecast }));

import { WeatherSunHero } from "../../src/cards/overview/WeatherSunHero.jsx";

const OCT = { dawn: 6.667, sunrise: 7.2, noon: 12.9, sunset: 18.583, dusk: 19.133 };
const at = (h, m) => new Date(2026, 9, 6, h, m).toISOString();

function weather(state, attrs = {}) {
  fixtures.entities = {
    "weather.forecast_home": {
      entity: { state, attributes: { temperature: 14, humidity: 70, pressure: 1012, wind_speed: 9, ...attrs } },
      status: state === "unavailable" ? "unavailable" : "ready",
    },
    "sensor.sun_next_rising": { entity: { state: at(7, 12) }, status: "ready" },
    "sensor.sun_next_setting": { entity: { state: at(18, 35) }, status: "ready" },
  };
}

const meta = (container) => container.querySelector(".meta")?.textContent;
const sunInfo = (container) => container.querySelector(".sun-info")?.textContent;

beforeEach(() => {
  fixtures.entities = {};
  fixtures.forecast = { forecast: [], status: "loading" };
});

describe("WeatherSunHero sun readout", () => {
  it("shows the real afternoon sun whatever the theme mode is", () => {
    // Mode: Night used to hand this card skyColors(23): a moon at 14:00.
    weather("sunny");
    const { container } = render(<WeatherSunHero sun={sunReadout(14, OCT)} />);
    expect(meta(container)).toBe("Sun · 14:00");
    expect(sunInfo(container)).toMatch(/\d+% through daylight/);
    expect(container.querySelector(".sun-dot")).not.toBeNull();
    expect(container.querySelector(".moon-dot")).toBeNull();
  });

  it("puts the sun down after the sunset it prints", () => {
    weather("clear-night");
    const { container } = render(<WeatherSunHero sun={sunReadout(18 + 50 / 60, OCT)} />);
    expect(meta(container)).toBe("Night · 18:50");
    expect(sunInfo(container)).toContain("Below horizon");
    expect(container.querySelector(".moon-dot")).not.toBeNull();
  });

  it("draws the moon as one crescent, independent of the sky palette", () => {
    // It used to be a disc plus a cutout circle filled with var(--sky-top):
    // under Mode: day that painted a pale blue dot at the noon-sun position.
    weather("clear-night");
    const { container } = render(<WeatherSunHero sun={sunReadout(3, OCT)} />);
    const moon = container.querySelectorAll(".moon-dot");
    expect(moon).toHaveLength(1);
    expect(moon[0].tagName.toLowerCase()).toBe("path");
    expect(moon[0].getAttribute("d")).not.toMatch(/NaN/);
    expect(container.querySelector(".sun-arc svg").innerHTML).not.toContain("--sky-top");
  });

  it("claims neither sun nor moon when sun.sun gave nothing usable", () => {
    weather("cloudy");
    const { container } = render(<WeatherSunHero sun={sunReadout(14, null)} />);
    expect(meta(container)).toBe("14:00");
    expect(sunInfo(container)).not.toMatch(/daylight|horizon/);
    expect(sunInfo(container)).toContain("—");
    expect(container.querySelector(".sun-dot")).toBeNull();
    expect(container.querySelector(".moon-dot")).toBeNull();
    expect(container.textContent).not.toContain("NaN");
  });
});

describe("WeatherSunHero conditions", () => {
  it("names a clear night and draws it without a sun", () => {
    weather("clear-night");
    render(<WeatherSunHero sun={sunReadout(23, OCT)} />);
    expect(screen.getByText("Clear night")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Clear night" })).toBeInTheDocument();
  });

  it("says nothing it does not know when the weather entity is unavailable", () => {
    weather("unavailable", { temperature: undefined, humidity: undefined });
    const { container } = render(<WeatherSunHero sun={sunReadout(14, OCT)} />);
    expect(screen.getByRole("img", { name: "Conditions unknown" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("unavailable°");
    expect(screen.queryByText("unavailable")).toBeNull();
    expect(container.textContent).not.toContain("NaN");
  });

  it("still renders the loading card in mock mode, with no sun prop at all", () => {
    const { container } = render(<WeatherSunHero sun={undefined} />);
    expect(container.querySelector(".entity-loading")).not.toBeNull();
    expect(meta(container)).toBe("Loading…");
  });
});
