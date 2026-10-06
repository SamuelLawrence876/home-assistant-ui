/* WeatherIcon used to draw six of Home Assistant's fifteen conditions and a
   full sun for everything else — a clear night, a downpour, a thunderstorm
   and an unavailable entity all showed a sun. */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WeatherIcon, weatherLabel, WEATHER_LABELS } from "../../src/components/WeatherIcon.jsx";

const HA_CONDITIONS = [
  "clear-night", "cloudy", "exceptional", "fog", "hail", "lightning", "lightning-rainy",
  "partlycloudy", "pouring", "rainy", "snowy", "snowy-rainy", "sunny", "windy", "windy-variant",
];

function draw(condition) {
  const { container } = render(<WeatherIcon condition={condition} />);
  const svg = container.querySelector("svg");
  // The sun is the only large disc (r 16-22); hail and the "!" dot are tiny.
  const suns = [...svg.querySelectorAll("circle")].filter((c) => Number(c.getAttribute("r")) >= 10);
  return { svg, suns: suns.length, shapes: svg.querySelectorAll("circle, ellipse, path, rect").length };
}

describe("WeatherIcon", () => {
  it("knows every Home Assistant weather condition", () => {
    expect(Object.keys(WEATHER_LABELS).sort()).toEqual([...HA_CONDITIONS].sort());
  });

  it("draws a sun only where there is one", () => {
    for (const c of HA_CONDITIONS) {
      const { suns } = draw(c);
      expect([c, suns > 0]).toEqual([c, c === "sunny" || c === "partlycloudy"]);
    }
  });

  it("draws a moon, not a sun, on a clear night", () => {
    const { svg, suns } = draw("clear-night");
    expect(suns).toBe(0);
    expect(svg.querySelector("path")).not.toBeNull();
    expect(svg.getAttribute("aria-label")).toBe("Clear night");
  });

  it("draws a neutral dash for anything it does not know", () => {
    for (const c of ["unavailable", "unknown", undefined, null, "", "constructor", "tornado"]) {
      const { svg, suns, shapes } = draw(c);
      expect(suns).toBe(0);
      expect(shapes).toBe(0);
      expect(svg.querySelectorAll("line")).toHaveLength(1);
      expect(svg.getAttribute("aria-label")).toBe("Conditions unknown");
    }
  });

  it("is named in words, not HA's slug", () => {
    expect(draw("partlycloudy").svg.getAttribute("aria-label")).toBe("Partly cloudy");
    expect(draw("lightning-rainy").svg.getAttribute("aria-label")).toBe("Thunderstorm");
  });
});

describe("weatherLabel", () => {
  it("returns null for anything that is not a condition, prototype keys included", () => {
    for (const v of ["unavailable", "toString", "__proto__", "hasOwnProperty", 3, null, undefined]) {
      expect(weatherLabel(v)).toBe(null);
    }
    expect(weatherLabel("pouring")).toBe("Heavy rain");
  });
});
