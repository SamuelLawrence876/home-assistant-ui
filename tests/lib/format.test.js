/* Number and date formatting.

   Four separate findings in the 2026-08 sweep were the same shape: a sensor
   goes unavailable, the arithmetic runs anyway, and "NaN%" or "Invalid Date"
   reaches the screen. The rule these tests hold to is that an unknown value
   renders as an em-dash — never a calculation, never a plausible-looking zero. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fmtTime, formatRelativeIso, formatMiB, numOr, pmBand, durationToMinutes } from "../../src/lib/format.js";

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

  it("treats a null size as unknown rather than as zero bytes (roadmap I16)", () => {
    // Number(null) is 0 and Number("") is 0, so both used to render "0 MiB" —
    // a confident, wrong number where the honest answer is "we do not know".
    expect(formatMiB(null)).toBe("—");
    expect(formatMiB("")).toBe("—");
    expect(formatMiB("   ")).toBe("—");
  });

  it("still reads a real zero as zero", () => {
    expect(formatMiB("0")).toBe("0 MiB");
  });
});

describe("numOr", () => {
  it("reads numbers and numeric strings", () => {
    expect(numOr(5, null)).toBe(5);
    expect(numOr("21.3", null)).toBe(21.3);
    expect(numOr("0", null)).toBe(0);
    expect(numOr(0, 7)).toBe(0);
  });

  it("falls back for every way a sensor says nothing", () => {
    for (const v of [null, undefined, "", "  ", "unavailable", "unknown", "NaN", NaN, Infinity, "12 MB", true, false]) {
      expect(numOr(v, null)).toBeNull();
    }
    expect(numOr("unavailable", 20)).toBe(20);
  });
});

/* Round 4: VacuumCard printed Roborock's cleaning_time seconds as minutes
   ("1200 min" for a 20-minute clean), and PrinterCard would print an hours
   remaining_time as minutes ("2m" for 2h15m). The unit comes from the entity. */
describe("durationToMinutes", () => {
  it("converts each listed unit to minutes", () => {
    expect(durationToMinutes("1200", "s")).toBe(20);
    expect(durationToMinutes("35", "min")).toBe(35);
    expect(durationToMinutes("2.25", "h")).toBe(135);
    expect(durationToMinutes("1", "d")).toBe(1440);
    expect(durationToMinutes(90, "s")).toBe(1.5);
  });

  /* D22: every unit HA's DurationConverter converts, not just the four the
     integrations here register with. A user can pick any of them as a
     sensor's display unit, and 1200000 ms read as "—" dropped a fact HA
     reported in a standard unit. */
  it("converts ms, both spellings of μs, and weeks", () => {
    expect(durationToMinutes("1200000", "ms")).toBe(20);
    expect(durationToMinutes("90000", "ms")).toBe(1.5);
    expect(durationToMinutes("1200000000", "μs")).toBe(20);   // μs, Greek mu: what HA writes
    expect(durationToMinutes("1200000000", "µs")).toBe(20);   // µs, the micro sign
    expect(durationToMinutes("2", "w")).toBe(20160);
    expect(durationToMinutes("0", "ms")).toBe(0);
    expect(durationToMinutes("-1", "ms")).toBeNull();
    expect(durationToMinutes("unavailable", "μs")).toBeNull();
  });

  it("agrees with HA's own factors for every unit it converts (1 h in each)", () => {
    const oneHour = { "μs": 3.6e9, "µs": 3.6e9, ms: 3.6e6, s: 3600, min: 60, h: 1, d: 1 / 24, w: 1 / 168 };
    for (const [unit, v] of Object.entries(oneHour)) expect(durationToMinutes(v, unit)).toBeCloseTo(60, 9);
  });

  it("reads a real zero as zero", () => {
    expect(durationToMinutes("0", "s")).toBe(0);
    expect(durationToMinutes("0", "h")).toBe(0);
  });

  it("refuses to guess a unit it doesn't know, or one that isn't there", () => {
    // "m" and "y" are UnitOfTime's months and years: HA doesn't convert them, and neither does this.
    for (const unit of [undefined, null, "", "m", "y", "us", "MS", "MIN", "hours", "constructor", "toString"]) {
      expect(durationToMinutes("20", unit)).toBeNull();
    }
  });

  it("is null for every way a sensor says nothing, and for a negative duration", () => {
    for (const v of [null, undefined, "", "unavailable", "unknown", "NaN", "12 min", true]) {
      expect(durationToMinutes(v, "min")).toBeNull();
    }
    expect(durationToMinutes("-5", "min")).toBeNull();
  });
});

describe("pmBand", () => {
  it("bands PM2.5 at the WHO / EPA-ish edges", () => {
    expect(pmBand(0)).toBe("excellent");
    expect(pmBand(12)).toBe("excellent");
    expect(pmBand(13)).toBe("good");
    expect(pmBand(35)).toBe("good");
    expect(pmBand(55)).toBe("moderate");
    expect(pmBand(56)).toBe("poor");
  });

  it("has no band for an unknown reading", () => {
    expect(pmBand(null)).toBeNull();
    expect(pmBand(NaN)).toBeNull();
  });
});
