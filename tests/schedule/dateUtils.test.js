/* Dates on their way into Home Assistant.

   These strings are written straight into `calendar.create_event`, so a
   malformed one is not a cosmetic problem — HA either rejects it or files the
   event at the wrong instant. Deliberately timezone-agnostic: the assertions
   are about shape and round-tripping, so they hold wherever the suite runs. */
import { describe, it, expect } from "vitest";
import { toLocalISOWithOffset, ymd, parseTodayPin } from "../../src/cards/schedule/dateUtils.js";

const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/;

describe("toLocalISOWithOffset", () => {
  it("writes an ISO timestamp that carries its own UTC offset", () => {
    expect(toLocalISOWithOffset(new Date(2026, 5, 21, 14, 30))).toMatch(WITH_OFFSET);
    expect(toLocalISOWithOffset(new Date(2026, 0, 5, 9, 5))).toMatch(WITH_OFFSET);
  });

  it("keeps the local wall-clock date and time it was given", () => {
    const s = toLocalISOWithOffset(new Date(2026, 0, 5, 9, 5));
    expect(s.startsWith("2026-01-05T09:05:00")).toBe(true);
  });

  it("names the same instant it was given, so nothing shifts by an hour", () => {
    for (const d of [new Date(2026, 0, 5, 9, 5), new Date(2026, 6, 5, 23, 59), new Date(2026, 11, 31, 0, 0)]) {
      expect(new Date(toLocalISOWithOffset(d)).getTime()).toBe(d.getTime());
    }
  });

  it("pads single-digit months, days, hours and minutes", () => {
    expect(toLocalISOWithOffset(new Date(2026, 2, 9, 7, 8)).slice(0, 16)).toBe("2026-03-09T07:08");
  });

  it.skip("BUG: refuses an unparseable date instead of writing NaN into the payload", () => {
    // new Date("nonsense") produces "NaN-NaN-NaNTNaN:NaN:00+NaN:NaN", which is
    // what would be posted to calendar.create_event. Not reachable from the
    // dialog today (its inputs are a date picker and two time pickers), but
    // there is no guard in the helper itself.
    // Expected: null, and the caller renders an error rather than submitting.
    expect(toLocalISOWithOffset(new Date("nonsense"))).toBe(null);
  });
});

/* The screenshot gates pin ?today= through this. A wrong parse doesn't just
   move a highlight — it either un-pins the baseline (silent date drift, the
   exact rot this exists to stop) or feeds the week grid an Invalid Date. */
describe("parseTodayPin", () => {
  it("accepts a well-formed date and lands mid-day on that local day", () => {
    const d = parseTodayPin("?tab=schedule&today=2026-06-17");
    expect(ymd(d)).toBe("2026-06-17");
    expect(d.getHours()).toBe(12);
  });

  it("returns null when the param is absent", () => {
    expect(parseTodayPin("")).toBe(null);
    expect(parseTodayPin("?tab=schedule&mode=day")).toBe(null);
  });

  it("rejects anything unparseable rather than patching it", () => {
    for (const bad of ["?today=", "?today=nonsense", "?today=17-06-2026", "?today=2026-6-7", "?today=2026-06-17T12:00"]) {
      expect(parseTodayPin(bad)).toBe(null);
    }
  });

  it("rejects a shape-valid but impossible date — NaN must never reach the grid", () => {
    expect(parseTodayPin("?today=2026-13-45")).toBe(null);
  });
});

describe("ymd", () => {
  it("writes a bare calendar date", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the local date, not the UTC one", () => {
    // 23:30 local on the 5th is still the 5th, even where that is already
    // the 6th in UTC.
    const d = new Date(2026, 0, 5, 23, 30);
    expect(ymd(d)).toBe("2026-01-05");
  });

  it("pads to a fixed width so the strings sort", () => {
    const dates = [new Date(2026, 8, 9), new Date(2026, 9, 1), new Date(2026, 0, 20)];
    const sorted = dates.map(ymd).sort();
    expect(sorted).toEqual(["2026-01-20", "2026-09-09", "2026-10-01"]);
  });
});
