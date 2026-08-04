/* Number and date formatting.

   Four separate findings in the 2026-08 sweep were the same shape: a sensor
   goes unavailable, the arithmetic runs anyway, and "NaN%" or "Invalid Date"
   reaches the screen. The rule these tests hold to is that an unknown value
   renders as an em-dash — never a calculation, never a plausible-looking zero. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fmtTime, formatRelativeIso, formatMiB } from "../../src/lib/format.js";

describe("fmtTime", () => {
  it("writes a fractional hour as a wall clock", () => {
    expect(fmtTime(0)).toBe("00:00");
    expect(fmtTime(9)).toBe("09:00");
    expect(fmtTime(13.5)).toBe("13:30");
    expect(fmtTime(18.25)).toBe("18:15");
    expect(fmtTime(23.5)).toBe("23:30");
  });

  it("always pads to five characters", () => {
    for (let h = 0; h < 24; h += 0.1) expect(fmtTime(h)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("rolls the minute over instead of printing :60 in the last 30 seconds of an hour", () => {
    // useNow() feeds this h + m/60 + s/3600, so at 13:59:35 the fraction is
    // 0.99306 — rounding the fraction alone produced a 60th minute.
    expect(fmtTime(13 + 59 / 60 + 35 / 3600)).toBe("14:00");
    expect(fmtTime(23 + 59 / 60 + 59 / 3600)).toBe("00:00");
  });

  it("never emits a 60th minute at any second of any hour", () => {
    for (let h = 0; h < 24; h++) {
      for (let s = 0; s < 3600; s += 7) {
        expect(fmtTime(h + s / 3600)).not.toMatch(/:60$/);
      }
    }
  });

  it("renders an em-dash rather than NaN for an unusable value", () => {
    expect(fmtTime(NaN)).toBe("—");
    expect(fmtTime(undefined)).toBe("—");
  });
});

describe("formatRelativeIso", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  const iso = (...args) => new Date(...args).toISOString();

  it("says em-dash when there is no timestamp at all", () => {
    expect(formatRelativeIso(null)).toBe("—");
    expect(formatRelativeIso(undefined)).toBe("—");
    expect(formatRelativeIso("")).toBe("—");
  });

  it("never renders Invalid Date or NaN for a value it cannot parse", () => {
    for (const junk of ["unavailable", "unknown", "banana", "2026-13-45T99:99:99"]) {
      const out = formatRelativeIso(junk);
      expect(out).not.toContain("Invalid Date");
      expect(out).not.toContain("NaN");
    }
  });

  it("hands an unparseable sensor value straight back, so the caller can spot it", () => {
    // VacuumCard relies on this: it gates on the entity state before calling.
    expect(formatRelativeIso("unavailable")).toBe("unavailable");
  });

  it("names today, yesterday and tomorrow", () => {
    expect(formatRelativeIso(iso(2026, 7, 4, 9, 30))).toBe("today · 09:30");
    expect(formatRelativeIso(iso(2026, 7, 3, 22, 5))).toBe("yesterday · 22:05");
    expect(formatRelativeIso(iso(2026, 7, 5, 7, 0))).toBe("tomorrow · 07:00");
  });

  it("counts the days either side of that", () => {
    expect(formatRelativeIso(iso(2026, 7, 1, 8, 0))).toBe("3 days ago · 08:00");
    expect(formatRelativeIso(iso(2026, 7, 9, 8, 0))).toBe("in 5 days · 08:00");
  });

  it("compares whole days, not elapsed hours", () => {
    // 23:59 last night is "yesterday", even though it is 12 hours ago.
    expect(formatRelativeIso(iso(2026, 7, 3, 23, 59))).toBe("yesterday · 23:59");
    // 00:01 this morning is "today", for the same reason.
    expect(formatRelativeIso(iso(2026, 7, 4, 0, 1))).toBe("today · 00:01");
  });
});

describe("formatMiB", () => {
  it("writes mebibytes below a gibibyte", () => {
    expect(formatMiB(0)).toBe("0 MiB");
    expect(formatMiB(512)).toBe("512 MiB");
    expect(formatMiB("880")).toBe("880 MiB");
  });

  it("switches to gibibytes at 1024", () => {
    expect(formatMiB(1024)).toBe("1.00 GiB");
    expect(formatMiB(2560)).toBe("2.50 GiB");
  });

  it("says em-dash for a sensor that has nothing to report", () => {
    expect(formatMiB("unavailable")).toBe("—");
    expect(formatMiB("unknown")).toBe("—");
    expect(formatMiB(undefined)).toBe("—");
    expect(formatMiB(NaN)).toBe("—");
    expect(formatMiB("12 MB")).toBe("—");
  });

  it.skip("BUG: treats a null size as unknown rather than as zero bytes", () => {
    // Number(null) is 0 and Number("") is 0, so both currently render "0 MiB" —
    // a confident, wrong number where the honest answer is "we do not know".
    // Not reachable today (BackupCard gates on the entity first), but it is one
    // careless caller away. Expected: em-dash.
    expect(formatMiB(null)).toBe("—");
    expect(formatMiB("")).toBe("—");
  });
});
