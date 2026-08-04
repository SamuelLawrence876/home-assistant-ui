/* The sky palette and the sun window it is drawn from.

   Both are one step away from a CSS colour function, so the property under
   test throughout is: an input we do not understand produces the authored
   fallback, never NaN. */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  skyColors,
  sunPhase,
  isDay,
  sunTimesFromEntity,
  resolveSunTimes,
  nowFractionalHour,
  SUN_FALLBACK,
} from "../../src/theme.js";

const OKLCH = /^oklch\(-?\d+(\.\d+)? -?\d+(\.\d+)? -?\d+\)$/;

/* A believable sun.sun. The dates do not matter — only the local time of day
   is read out of them — but they are written in local time so the assertions
   below hold in whatever timezone the suite runs in. */
function sunEntity(overrides = {}) {
  const at = (h, m) => {
    const d = new Date(2026, 5, 21, h, m, 0);
    return d.toISOString();
  };
  return {
    state: "above_horizon",
    attributes: {
      next_rising: at(5, 0),
      next_setting: at(21, 0),
      next_dawn: at(4, 30),
      next_dusk: at(21, 30),
      next_noon: at(13, 0),
      ...overrides,
    },
  };
}

describe("skyColors", () => {
  it("produces a well-formed oklch colour for every hour of the day", () => {
    for (let h = 0; h <= 24; h += 0.25) {
      const sky = skyColors(h, null);
      expect(sky.top).toMatch(OKLCH);
      expect(sky.bot).toMatch(OKLCH);
      expect(Number.isFinite(sky.warmth)).toBe(true);
      expect(Number.isFinite(sky.phase)).toBe(true);
    }
  });

  it("falls back to midday rather than emitting NaN when the hour is not a number", () => {
    for (const bad of [NaN, undefined, null, "banana", {}, Infinity]) {
      const sky = skyColors(bad, null);
      expect(sky.top).toMatch(OKLCH);
      expect(sky.bot).toMatch(OKLCH);
      expect(sky.top).not.toContain("NaN");
      expect(sky.isDay).toBe(true);
    }
  });

  it("clamps an out-of-range hour instead of extrapolating off the end of the palette", () => {
    expect(skyColors(-10, null).top).toMatch(OKLCH);
    expect(skyColors(99, null).top).toMatch(OKLCH);
    expect(skyColors(99, null).top).toBe(skyColors(24, null).top);
  });

  it("calls the middle of the day day and the middle of the night night", () => {
    expect(skyColors(13, null).isDay).toBe(true);
    expect(skyColors(3, null).isDay).toBe(false);
    expect(skyColors(23, null).isDay).toBe(false);
  });

  it("darkens earlier when the real sun sets earlier", () => {
    // A December window: sunset before 16:00. The old hardcoded midsummer
    // palette kept the sky bright until half eight.
    const december = { dawn: 7.5, sunrise: 8.1, noon: 12, sunset: 15.9, dusk: 16.5 };
    expect(skyColors(17, december).isDay).toBe(false);
    expect(skyColors(17, null).isDay).toBe(true); // same clock, midsummer window
  });
});

describe("sunTimesFromEntity", () => {
  it("reads a normal sun.sun into local hours", () => {
    const t = sunTimesFromEntity(sunEntity());
    expect(t.sunrise).toBeCloseTo(5, 5);
    expect(t.sunset).toBeCloseTo(21, 5);
    expect(t.dawn).toBeCloseTo(4.5, 5);
    expect(t.dusk).toBeCloseTo(21.5, 5);
  });

  it("says it does not know when the entity is missing or unavailable", () => {
    expect(sunTimesFromEntity(null)).toBe(null);
    expect(sunTimesFromEntity(undefined)).toBe(null);
    expect(sunTimesFromEntity({ state: "unavailable", attributes: {} })).toBe(null);
    expect(sunTimesFromEntity({ state: "unknown", attributes: {} })).toBe(null);
    expect(sunTimesFromEntity({ state: undefined })).toBe(null);
  });

  it("says it does not know when the timestamps are missing or unparseable", () => {
    expect(sunTimesFromEntity({ state: "above_horizon", attributes: {} })).toBe(null);
    expect(sunTimesFromEntity(sunEntity({ next_rising: "not a date" }))).toBe(null);
    expect(sunTimesFromEntity(sunEntity({ next_setting: null }))).toBe(null);
  });

  it("derives dawn and dusk when Home Assistant does not publish them", () => {
    const t = sunTimesFromEntity(sunEntity({ next_dawn: undefined, next_dusk: undefined }));
    expect(t.dawn).toBeLessThan(t.sunrise);
    expect(t.dusk).toBeGreaterThan(t.sunset);
  });

  it("rejects a window this model cannot draw rather than patching it up", () => {
    // Near-polar day: dawn and dusk collapse onto each other.
    const polar = sunTimesFromEntity(
      sunEntity({
        next_rising: new Date(2026, 5, 21, 0, 5).toISOString(),
        next_setting: new Date(2026, 5, 21, 0, 20).toISOString(),
        next_dawn: new Date(2026, 5, 21, 0, 1).toISOString(),
        next_dusk: new Date(2026, 5, 21, 0, 25).toISOString(),
      }),
    );
    expect(polar).toBe(null);
  });
});

describe("resolveSunTimes", () => {
  it("hands back the authored day when given nothing usable", () => {
    expect(resolveSunTimes(null)).toBe(SUN_FALLBACK);
    expect(resolveSunTimes(undefined)).toBe(SUN_FALLBACK);
    expect(resolveSunTimes({ dawn: NaN, dusk: 20 })).toBe(SUN_FALLBACK);
    expect(resolveSunTimes({ dawn: 20, dusk: 4, sunrise: 6, sunset: 18 })).toBe(SUN_FALLBACK);
  });

  it("hands back a usable window untouched", () => {
    const good = { dawn: 6, sunrise: 6.5, noon: 13, sunset: 20, dusk: 20.5 };
    expect(resolveSunTimes(good)).toBe(good);
  });
});

describe("sunPhase / isDay", () => {
  it("puts the sun on its arc between dawn and dusk", () => {
    expect(sunPhase(6, 6, 20)).toBeCloseTo(0, 5);
    expect(sunPhase(13, 6, 20)).toBeCloseTo(0.5, 5);
    expect(sunPhase(20, 6, 20)).toBeCloseTo(1, 5);
    expect(isDay(sunPhase(13, 6, 20))).toBe(true);
  });

  it("puts the sun below the horizon before dawn and after dusk", () => {
    expect(isDay(sunPhase(3, 6, 20))).toBe(false);
    expect(isDay(sunPhase(22, 6, 20))).toBe(false);
  });
});

describe("nowFractionalHour", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts a numeric override without looking at the clock", () => {
    expect(nowFractionalHour(6.25)).toBe(6.25);
  });

  it("reads ?clock=HH:MM for the screenshot harness", () => {
    window.history.replaceState(null, "", "/?clock=13:30");
    expect(nowFractionalHour()).toBeCloseTo(13.5, 5);
  });

  it("ignores a nonsense ?clock= rather than producing NaN", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 9, 30, 0));
    for (const junk of ["banana", "25:00", "-3:00", "99", "12:xx", ""]) {
      window.history.replaceState(null, "", `/?clock=${encodeURIComponent(junk)}`);
      const h = nowFractionalHour();
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeCloseTo(9.5, 5);
    }
  });
});
