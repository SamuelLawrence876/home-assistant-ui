/* Kanban helpers — tag encoding and the due-date chip.

   The due-date chip is where "Invalid Date" reached the screen in the 2026-08
   sweep, and `dueFields` is the thing that decides which of two mutually
   exclusive HA fields a due value goes into. Getting that wrong throws, and a
   throw mid-move is how a task gets deleted from Home Assistant and never
   re-added (LESSONS.md pattern 2). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseTags, buildDescription, fmtDue, dueFields } from "../../src/cards/schedule/kanbanUtils.js";

describe("parseTags", () => {
  it("pulls hash tags out and leaves the prose behind", () => {
    expect(parseTags("#home #urgent fix the boiler")).toEqual({
      tags: ["home", "urgent"],
      text: "fix the boiler",
    });
  });

  it("copes with no description at all", () => {
    expect(parseTags(undefined)).toEqual({ tags: [], text: "" });
    expect(parseTags(null)).toEqual({ tags: [], text: "" });
    expect(parseTags("")).toEqual({ tags: [], text: "" });
  });

  it("returns no tags when there are none", () => {
    expect(parseTags("just a note")).toEqual({ tags: [], text: "just a note" });
  });

  it("keeps hyphens inside a tag", () => {
    expect(parseTags("#3d-print check the plate").tags).toEqual(["3d-print"]);
  });
});

describe("buildDescription", () => {
  it("round-trips through parseTags", () => {
    const built = buildDescription(["home", "urgent"], "fix the boiler");
    expect(parseTags(built)).toEqual({ tags: ["home", "urgent"], text: "fix the boiler" });
  });

  it("returns undefined rather than an empty string when there is nothing to say", () => {
    // undefined means "omit the field"; an empty string would overwrite a
    // description in Home Assistant with nothing.
    expect(buildDescription([], "")).toBeUndefined();
  });

  it("works with tags but no text, and text but no tags", () => {
    expect(buildDescription(["home"], "")).toBe("#home");
    expect(buildDescription([], "just a note")).toBe("just a note");
  });
});

describe("fmtDue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("says nothing when there is no due date", () => {
    expect(fmtDue(undefined)).toBe(null);
    expect(fmtDue(null)).toBe(null);
    expect(fmtDue("")).toBe(null);
  });

  it("never renders Invalid Date for a value it cannot parse", () => {
    for (const junk of ["unavailable", "banana", "2026-13-45", "not-a-date-at-all"]) {
      expect(fmtDue(junk)).toBe(null);
    }
  });

  it("names today and tomorrow for bare dates", () => {
    expect(fmtDue("2026-08-04")).toBe("today");
    expect(fmtDue("2026-08-05")).toBe("tomorrow");
  });

  it("calls a past date overdue", () => {
    expect(fmtDue("2026-08-03")).toBe("overdue");
    expect(fmtDue("2026-07-01")).toBe("overdue");
  });

  it("treats a bare date as due at the end of that day, not at midnight", () => {
    // It is midday on the 4th; a task due "2026-08-04" is not late yet.
    expect(fmtDue("2026-08-04")).toBe("today");
  });

  it("uses the time of day when the due value carries one", () => {
    expect(fmtDue("2026-08-04T09:00:00")).toBe("overdue"); // this morning
    expect(fmtDue("2026-08-04T18:00:00")).toBe("today"); // this evening
  });

  it("spells out anything further ahead", () => {
    expect(fmtDue("2026-08-12")).toMatch(/Wed/);
  });
});

describe("dueFields", () => {
  it("routes a bare date to due_date", () => {
    expect(dueFields("2026-08-04")).toEqual({ due_date: "2026-08-04" });
  });

  it("routes a timestamp to due_datetime", () => {
    expect(dueFields("2026-08-04T14:30:00+01:00")).toEqual({
      due_datetime: "2026-08-04T14:30:00+01:00",
    });
  });

  it("sends neither field when there is no due value", () => {
    expect(dueFields(undefined)).toEqual({});
    expect(dueFields(null)).toEqual({});
    expect(dueFields("")).toEqual({});
  });

  it("agrees with fmtDue about which values carry a time", () => {
    // Both decide on the same length test; if one changes, a move drops a due
    // time or throws on the re-add.
    expect(Object.keys(dueFields("2026-08-04"))).toEqual(["due_date"]);
    expect(Object.keys(dueFields("2026-08-04T00:00:00"))).toEqual(["due_datetime"]);
  });
});
