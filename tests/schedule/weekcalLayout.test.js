/* Weekly calendar geometry.

   Home Assistant returns one object per event even when it runs across several
   days, and all-day events carry an *exclusive* end date. Getting either wrong
   paints a phantom extra day on the grid. Monday 3 August 2026 is the week
   start used throughout. */
import { describe, it, expect } from "vitest";
import {
  layoutEventsInDay,
  haEventToGridPositions,
  toGridEvents,
  hhmm,
  hourLabel,
  eventTimeLabel,
  DOWS,
} from "../../src/cards/schedule/weekcalLayout.js";

const WEEK_START = new Date(2026, 7, 3); // Monday
const timed = (startISO, endISO) => ({ start: { dateTime: startISO }, end: { dateTime: endISO } });
const local = (...args) => new Date(...args).toISOString();
const allDay = (startDate, endDate) => ({ start: { date: startDate }, end: { date: endDate } });

describe("layoutEventsInDay", () => {
  it("gives overlapping events their own lane, side by side", () => {
    const out = layoutEventsInDay([
      { start: 9, end: 11 },
      { start: 10, end: 12 },
    ]);
    expect(out.map((e) => e._lane)).toEqual([0, 1]);
    expect(out.every((e) => e._totalLanes === 2)).toBe(true);
  });

  it("reuses a lane for events that do not overlap", () => {
    const out = layoutEventsInDay([
      { start: 9, end: 10 },
      { start: 11, end: 12 },
    ]);
    expect(out.map((e) => e._lane)).toEqual([0, 0]);
    expect(out.every((e) => e._totalLanes === 1)).toBe(true);
  });

  it("treats back-to-back events as not overlapping", () => {
    const out = layoutEventsInDay([
      { start: 9, end: 10 },
      { start: 10, end: 11 },
    ]);
    expect(out.map((e) => e._lane)).toEqual([0, 0]);
  });

  it("keeps two overlap groups in the same day independent", () => {
    const out = layoutEventsInDay([
      { start: 9, end: 11 },
      { start: 10, end: 12 },
      { start: 15, end: 16 },
    ]);
    const lonely = out.find((e) => e.start === 15);
    expect(lonely._totalLanes).toBe(1); // not widened by the morning pair
  });

  it("sorts by start time whatever order it is handed", () => {
    const out = layoutEventsInDay([
      { start: 15, end: 16 },
      { start: 9, end: 10 },
    ]);
    expect(out.map((e) => e.start)).toEqual([9, 15]);
  });

  it("does not mutate the events it was given", () => {
    const input = [{ start: 9, end: 10 }];
    layoutEventsInDay(input);
    expect(input[0]._lane).toBeUndefined();
  });

  it("copes with an empty day", () => {
    expect(layoutEventsInDay([])).toEqual([]);
  });
});

describe("haEventToGridPositions", () => {
  it("places a timed event on its own day", () => {
    const pos = haEventToGridPositions(timed(local(2026, 7, 4, 10, 0), local(2026, 7, 4, 11, 30)), WEEK_START);
    expect(pos).toEqual([{ day: 1, start: 10, end: 11.5, allDay: false }]);
  });

  it("puts an all-day event on one day only, despite its exclusive end date", () => {
    const pos = haEventToGridPositions(allDay("2026-08-05", "2026-08-06"), WEEK_START);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ day: 2, allDay: true });
  });

  it("explodes a multi-day event into one entry per day it covers", () => {
    const pos = haEventToGridPositions(timed(local(2026, 7, 3, 22, 0), local(2026, 7, 5, 2, 0)), WEEK_START);
    expect(pos.map((p) => p.day)).toEqual([0, 1, 2]);
    expect(pos[0]).toMatchObject({ start: 22, end: 24 });
    expect(pos[1]).toMatchObject({ start: 0, end: 24 });
    expect(pos[2]).toMatchObject({ start: 0, end: 2 });
  });

  it("does not paint the next morning for a meeting that ends at midnight", () => {
    const pos = haEventToGridPositions(timed(local(2026, 7, 4, 22, 0), local(2026, 7, 5, 0, 0)), WEEK_START);
    expect(pos.map((p) => p.day)).toEqual([1]);
    expect(pos[0].end).toBe(24);
  });

  it("keeps the visible part of an event that started before the week", () => {
    const pos = haEventToGridPositions(timed(local(2026, 7, 2, 20, 0), local(2026, 7, 3, 1, 0)), WEEK_START);
    expect(pos).toEqual([{ day: 0, start: 0, end: 1, allDay: false }]);
  });

  it("drops an event that misses the visible week entirely", () => {
    expect(haEventToGridPositions(timed(local(2026, 7, 20, 9, 0), local(2026, 7, 20, 10, 0)), WEEK_START)).toEqual([]);
    expect(haEventToGridPositions(timed(local(2026, 6, 20, 9, 0), local(2026, 6, 20, 10, 0)), WEEK_START)).toEqual([]);
  });

  it("drops an event with missing or unparseable times instead of drawing NaN", () => {
    expect(haEventToGridPositions({}, WEEK_START)).toEqual([]);
    expect(haEventToGridPositions({ start: {}, end: {} }, WEEK_START)).toEqual([]);
    expect(haEventToGridPositions(timed("banana", "also banana"), WEEK_START)).toEqual([]);
    expect(haEventToGridPositions({ start: { dateTime: local(2026, 7, 4, 9, 0) } }, WEEK_START)).toEqual([]);
  });

  it("gives a zero-length event enough height to be visible", () => {
    const pos = haEventToGridPositions(timed(local(2026, 7, 4, 9, 0), local(2026, 7, 4, 9, 0)), WEEK_START);
    expect(pos).toHaveLength(1);
    expect(pos[0].end).toBeGreaterThan(pos[0].start);
  });

  it("accepts a single-day all-day event from a feed that sends a non-exclusive end", () => {
    const pos = haEventToGridPositions(allDay("2026-08-05", "2026-08-05"), WEEK_START);
    expect(pos.map((p) => p.day)).toEqual([2]);
  });
});

describe("toGridEvents", () => {
  it("keeps every slice of a multi-day event under one event id", () => {
    const out = toGridEvents(
      [{ uid: "abc", summary: "Trip", cal_entity_id: "calendar.personal", ...timed(local(2026, 7, 3, 9, 0), local(2026, 7, 5, 17, 0)) }],
      WEEK_START,
    );
    expect(out).toHaveLength(3);
    expect(new Set(out.map((e) => e.evId)).size).toBe(1);
    expect(new Set(out.map((e) => e.id)).size).toBe(3); // per-day ids stay unique
  });

  it("labels an event with no summary rather than rendering undefined", () => {
    const out = toGridEvents(
      [{ uid: "x", cal_entity_id: "calendar.personal", ...timed(local(2026, 7, 4, 9, 0), local(2026, 7, 4, 10, 0)) }],
      WEEK_START,
    );
    expect(out[0].title).toBe("(untitled)");
    expect(out[0].where).toBe("");
  });

  it("still gives an event without a uid a stable id", () => {
    const ev = { summary: "Standup", cal_entity_id: "calendar.work", ...timed(local(2026, 7, 4, 9, 0), local(2026, 7, 4, 9, 30)) };
    const a = toGridEvents([ev], WEEK_START);
    const b = toGridEvents([ev], WEEK_START);
    expect(a[0].id).toBe(b[0].id);
  });

  it("returns nothing for an empty calendar", () => {
    expect(toGridEvents([], WEEK_START)).toEqual([]);
  });
});

describe("time labels", () => {
  it("writes fractional hours as a wall clock", () => {
    expect(hhmm(14.5)).toBe("14:30");
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(9.25)).toBe("09:15");
  });

  it("labels the hour rows", () => {
    expect(hourLabel(9)).toBe("09:00");
    expect(hourLabel(14.75)).toBe("14:00");
  });

  it("describes an event's span, or says All day", () => {
    expect(eventTimeLabel(9, 10.5, false)).toBe("09:00–10:30");
    expect(eventTimeLabel(0, 0.5, true)).toBe("All day");
  });

  it("starts the week on Monday", () => {
    expect(DOWS[0]).toBe("Mon");
    expect(DOWS).toHaveLength(7);
  });
});
