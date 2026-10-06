/* sunReadout — the weather card's factual sun, kept apart from the palette.

   The bug it fixes: the card read skyColors().phase, which follows the
   Tweaks Mode (Night pins the sky to 23:00) and runs dawn → dusk. So Night
   mode drew a moon at 2pm, Day mode drew the sun at 11pm, and the sun stayed
   on the arc after the sunset printed beside it. */
import { describe, it, expect } from "vitest";
import { sunReadout, skyColors, SUN_FALLBACK } from "../../src/theme.js";

// London, 6 October: the window the finding was reproduced with.
const OCT = { dawn: 6.667, sunrise: 7.2, noon: 12.9, sunset: 18.583, dusk: 19.133 };

describe("sunReadout", () => {
  it("is measured sunrise → sunset, the endpoints the arc is labelled with", () => {
    expect(sunReadout(OCT.sunrise, OCT).phase).toBeCloseTo(0, 5);
    expect(sunReadout(OCT.sunset, OCT).phase).toBeCloseTo(1, 5);
    expect(sunReadout((OCT.sunrise + OCT.sunset) / 2, OCT).phase).toBeCloseTo(0.5, 5);
  });

  it("puts the sun below the horizon after the sunset it prints, even in twilight", () => {
    // 18:50 — after sunset (18:35), before dusk (19:08). skyColors still
    // calls this daylight, because twilight is part of the painted sky.
    const r = sunReadout(18 + 50 / 60, OCT);
    expect(r.isUp).toBe(false);
    expect(skyColors(18 + 50 / 60, OCT).phase).toBeLessThanOrEqual(1);
  });

  it("takes the clock it is given — the real one, never the Mode pin", () => {
    // What App passes is `now`; Mode: Night would have handed skyColors 23.
    expect(sunReadout(14, OCT)).toMatchObject({ hour: 14, isUp: true });
    expect(sunReadout(23, OCT)).toMatchObject({ hour: 23, isUp: false });
  });

  it("says it does not know rather than falling back to the authored midsummer", () => {
    for (const bad of [null, undefined, {}, { dawn: NaN }, { dawn: 20, dusk: 4, sunrise: 6, sunset: 18 }]) {
      expect(sunReadout(14, bad)).toEqual({ hour: 14, phase: null, isUp: null });
    }
    // SUN_FALLBACK itself is a valid window, so it is only used if passed.
    expect(sunReadout(14, SUN_FALLBACK).isUp).toBe(true);
  });

  it("never returns NaN for a clock it cannot use", () => {
    for (const bad of [NaN, undefined, null, "14", -1, 25, Infinity]) {
      expect(sunReadout(bad, OCT)).toEqual({ hour: null, phase: null, isUp: null });
    }
  });
});
