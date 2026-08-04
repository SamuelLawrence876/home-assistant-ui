/* URL parameters are hostile input.

   The real bug: `?lean=<nonsense>` was written to localStorage *before* it was
   validated, then crashed the app on the way to the theme. Reloading replayed
   the poisoned value out of storage, so the dashboard stayed white until
   someone cleared site data by hand. `?clock=` had the same shape and produced
   `oklch(NaN NaN NaN)`.

   These tests cover the whole path a URL value takes: read it, coerce it,
   only then persist it — and check that nothing unvalidated can reach either
   localStorage or a CSS colour. */
import { describe, it, expect } from "vitest";
import { readURLParam } from "../../src/lib/url.js";
import {
  coerceLean,
  coerceMode,
  coerceClock,
  coerceBootStyle,
  loadStoredTweaks,
  persistTweaks,
  applyTheme,
  skyColors,
  TWEAK_DEFAULTS,
  LEANS,
} from "../../src/theme.js";

const setQuery = (qs) => window.history.replaceState(null, "", `/${qs}`);

describe("readURLParam", () => {
  it("returns the default when the parameter is absent", () => {
    setQuery("");
    expect(readURLParam("lean", "frosted")).toBe("frosted");
  });

  it("returns the value when the parameter is present", () => {
    setQuery("?lean=atrium");
    expect(readURLParam("lean", "frosted")).toBe("atrium");
  });

  it("treats an empty parameter as absent rather than as an empty setting", () => {
    setQuery("?lean=");
    expect(readURLParam("lean", "frosted")).toBe("frosted");
  });

  it("reads a parameter without disturbing the others", () => {
    setQuery("?tab=media&lean=atrium&clock=13:30");
    expect(readURLParam("tab", "overview")).toBe("media");
    expect(readURLParam("lean", "frosted")).toBe("atrium");
    expect(readURLParam("missing", null)).toBe(null);
  });

  it("does not write anything to storage just by reading a parameter", () => {
    setQuery("?lean=nonsense");
    readURLParam("lean", null);
    expect(localStorage.length).toBe(0);
  });
});

describe("a nonsense theme parameter is rejected before it is persisted", () => {
  it("turns an unknown lean into the default", () => {
    setQuery("?lean=chartreuse");
    expect(coerceLean(readURLParam("lean", null))).toBe(TWEAK_DEFAULTS.lean);
  });

  it("does not accept inherited object keys as leans", () => {
    // A plain-object lookup answers for every Object.prototype key, so
    // ?lean=constructor would otherwise hand the theme a function to read
    // `.day` off and take the whole app down from inside an effect.
    for (const key of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(coerceLean(key)).toBe(TWEAK_DEFAULTS.lean);
    }
  });

  it("keeps a real lean untouched", () => {
    for (const name of Object.keys(LEANS)) expect(coerceLean(name)).toBe(name);
  });

  it("turns an unknown mode and boot style into their defaults", () => {
    expect(coerceMode("sepia")).toBe(TWEAK_DEFAULTS.mode);
    expect(coerceMode(undefined)).toBe(TWEAK_DEFAULTS.mode);
    expect(coerceBootStyle("explode")).toBe(TWEAK_DEFAULTS.bootStyle);
    expect(coerceBootStyle(null)).toBe(TWEAK_DEFAULTS.bootStyle);
  });

  it("always turns a clock value into a real hour of the day", () => {
    // The only property that matters: whatever comes in, what comes out is a
    // finite number in [0, 24) — because this ends up inside oklch().
    for (const hostile of ["banana", "-1", "99", "NaN", "Infinity", {}, [], null, undefined, "1e999"]) {
      const out = coerceClock(hostile);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThan(24);
    }
  });

  it("keeps a sensible clock value", () => {
    expect(coerceClock(13.5)).toBe(13.5);
    expect(coerceClock("6.25")).toBe(6.25);
    expect(coerceClock(0)).toBe(0);
  });

  it("writes only coerced values to storage, so a reload cannot replay the poison", () => {
    setQuery("?lean=constructor&mode=sepia");
    const tweaks = {
      lean: coerceLean(readURLParam("lean", null)),
      mode: coerceMode(readURLParam("mode", null)),
      clockOverride: false,
      clock: coerceClock(readURLParam("clock", null)),
      bootStyle: coerceBootStyle(null),
    };
    persistTweaks(tweaks);

    const stored = loadStoredTweaks();
    expect(stored.lean).toBe(TWEAK_DEFAULTS.lean);
    expect(stored.mode).toBe(TWEAK_DEFAULTS.mode);
    expect(Object.keys(LEANS)).toContain(stored.lean);
  });
});

describe("loadStoredTweaks survives whatever is already in storage", () => {
  it("returns nothing when storage is empty", () => {
    expect(loadStoredTweaks()).toEqual({});
  });

  it("returns nothing rather than throwing on a truncated or corrupt write", () => {
    localStorage.setItem("glasshouse-tweaks", '{"lean":"fros');
    expect(loadStoredTweaks()).toEqual({});
  });

  it("ignores a stored value that is not a settings object", () => {
    for (const junk of ["[1,2,3]", '"frosted"', "42", "null", "true"]) {
      localStorage.setItem("glasshouse-tweaks", junk);
      expect(loadStoredTweaks()).toEqual({});
    }
  });

  it("recovers a dashboard that was already bricked by a poisoned stored lean", () => {
    // Storage written by an older build that persisted before validating.
    localStorage.setItem("glasshouse-tweaks", JSON.stringify({ lean: "constructor", mode: "night" }));
    const stored = loadStoredTweaks();
    expect(() => applyTheme(coerceLean(stored.lean), coerceMode(stored.mode), skyColors(12, null))).not.toThrow();
    expect(document.body.classList.contains(`lean-${TWEAK_DEFAULTS.lean}`)).toBe(true);
  });
});

describe("nothing unvalidated reaches a CSS colour function", () => {
  it("never puts NaN in the sky variables, whatever the clock says", () => {
    for (const hour of [NaN, undefined, null, "banana", Infinity, -Infinity, -5, 99]) {
      const sky = skyColors(hour, null);
      applyTheme("frosted", "day", sky);
      const root = document.documentElement.style;
      for (const name of ["--sky-top", "--sky-bot", "--sun-x", "--sun-y", "--sun-bloom", "--stars"]) {
        const value = root.getPropertyValue(name);
        expect(value).not.toBe("");
        expect(value).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it("applies a real lean even when handed a bogus one, instead of throwing out of the effect", () => {
    const sky = skyColors(12, null);
    for (const bogus of ["constructor", "__proto__", undefined, null, 42]) {
      expect(() => applyTheme(bogus, "day", sky)).not.toThrow();
      expect(document.body.className).toMatch(/lean-(conservatory|frosted|atrium)/);
    }
  });
});
