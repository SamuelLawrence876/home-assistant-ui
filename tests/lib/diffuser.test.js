/* Diffuser colour helpers — shared by the Climate card and the Overview mini,
   which is the only reason the maths lives in its own file. */
import { describe, it, expect } from "vitest";
import {
  DIFFUSER_COLORS,
  DEFAULT_RGB,
  SPRAY_OPTIONS,
  rgbCss,
  nearestColorName,
} from "../../src/lib/diffuser.js";

describe("rgbCss", () => {
  it("writes a triplet as a CSS colour", () => {
    expect(rgbCss([96, 170, 255])).toBe("rgb(96, 170, 255)");
    expect(rgbCss(DEFAULT_RGB)).toBe("rgb(96, 170, 255)");
  });
});

describe("nearestColorName", () => {
  it("names a swatch exactly when it is handed one", () => {
    for (const c of DIFFUSER_COLORS) expect(nearestColorName(c.rgb)).toBe(c.name);
  });

  it("names the closest swatch for a colour that is not one", () => {
    expect(nearestColorName([100, 175, 250])).toBe("Ocean");
    expect(nearestColorName([254, 213, 172])).toBe("Warm white");
  });

  it("always names something, even for a colour nowhere near the palette", () => {
    const name = nearestColorName([0, 0, 0]);
    expect(DIFFUSER_COLORS.map((c) => c.name)).toContain(name);
  });
});

describe("the palette itself", () => {
  it("has no duplicate names, so the label always identifies one swatch", () => {
    const names = DIFFUSER_COLORS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every channel inside 0-255", () => {
    for (const c of DIFFUSER_COLORS) {
      for (const channel of c.rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it("lists the Meross spray modes in segment order", () => {
    expect(SPRAY_OPTIONS).toEqual(["off", "eco", "on"]);
  });
});
