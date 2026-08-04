/* The Overview card that asked the Pi for its calendar 5-20 times a second.

   The card re-renders once a minute to keep its "Today / Tomorrow" labels
   honest. The fetch range it derives must NOT move at that rate — it is
   bucketed to the top of the hour, so it is identical across every render
   inside an hour and rolls forward exactly once when the hour turns. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

const calendarEntities = [
  { entity_id: "calendar.personal", state: "on", attributes: { friendly_name: "Personal" } },
];
const calendarResult = { current: { events: [], loading: false, error: null, refresh: () => {} } };
const conn = { status: "ready", dashReady: true };
const rangesAsked = [];

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntitiesByDomain: () => calendarEntities,
  useConnectionStatus: () => conn.status,
}));
vi.mock("../../src/hooks/useDashReady.js", () => ({
  useDashReady: () => conn.dashReady,
}));
vi.mock("../../src/ha/useCalendarEvents.js", () => ({
  useCalendarEvents: (ids, startISO, endISO) => {
    rangesAsked.push(`${startISO}|${endISO}`);
    return calendarResult.current;
  },
}));

const { NextEventCard } = await import("../../src/cards/overview/NextEventCard.jsx");

const distinctRanges = () => [...new Set(rangesAsked)];

beforeEach(() => {
  rangesAsked.length = 0;
  calendarResult.current = { events: [], loading: false, error: null, refresh: () => {} };
  conn.status = "ready";
  conn.dashReady = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-04T10:05:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NextEventCard fetch range", () => {
  it("asks for exactly one range on first render", () => {
    render(<NextEventCard />);
    expect(distinctRanges()).toHaveLength(1);
    expect(rangesAsked[0].startsWith("2026-08-04T10:00:00.000Z")).toBe(true);
  });

  it("asks for a week", () => {
    render(<NextEventCard />);
    const [start, end] = rangesAsked[0].split("|");
    const days = (new Date(end) - new Date(start)) / 86_400_000;
    expect(days).toBe(7);
  });

  it("keeps asking for the same range as the minutes tick past", () => {
    render(<NextEventCard />);
    for (let i = 0; i < 20; i++) act(() => vi.advanceTimersByTime(60_000));
    expect(rangesAsked.length).toBeGreaterThan(1); // it really did re-render
    expect(distinctRanges()).toHaveLength(1); // but never asked for anything new
  });

  it("rolls the range forward exactly once when the hour turns", () => {
    render(<NextEventCard />);
    for (let i = 0; i < 60; i++) act(() => vi.advanceTimersByTime(60_000)); // 10:05 -> 11:05

    const ranges = distinctRanges();
    expect(ranges).toHaveLength(2);
    const starts = ranges.map((r) => r.split("|")[0]);
    expect(starts).toEqual(["2026-08-04T10:00:00.000Z", "2026-08-04T11:00:00.000Z"]);
  });

  it("stops asking altogether once it is unmounted", () => {
    const { unmount } = render(<NextEventCard />);
    const askedWhileMounted = rangesAsked.length;
    unmount();
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(rangesAsked.length).toBe(askedWhileMounted);
  });
});

describe("NextEventCard content", () => {
  const at = (isoLocal) => ({ start: { dateTime: isoLocal }, end: { dateTime: isoLocal } });

  it("says nothing is scheduled rather than showing an empty box", () => {
    render(<NextEventCard />);
    expect(screen.getByText("Nothing scheduled this week")).toBeInTheDocument();
  });

  /* An empty list means "nothing is on" ONLY when we actually reached the Pi.
     Offline, or after a failed read, an empty list means we don't know — and
     saying "Nothing scheduled this week" beside a PI OFFLINE chip is a lie. */
  it("does not claim an empty week when it cannot reach Home Assistant", () => {
    conn.status = "disconnected";
    render(<NextEventCard />);
    expect(screen.queryByText("Nothing scheduled this week")).not.toBeInTheDocument();
    expect(screen.getByText(/Calendar unavailable/)).toBeInTheDocument();
  });

  it("does not claim an empty week when the calendar read failed", () => {
    calendarResult.current = { events: [], loading: false, error: new Error("boom"), refresh: () => {} };
    render(<NextEventCard />);
    expect(screen.queryByText("Nothing scheduled this week")).not.toBeInTheDocument();
    expect(screen.getByText(/Calendar unavailable/)).toBeInTheDocument();
  });

  it("keeps real events on screen when the socket drops, with the caveat in the meta line", () => {
    calendarResult.current = {
      events: [{ summary: "Dentist", start: { dateTime: "2026-08-05T09:00:00.000Z" }, cal_entity_id: "calendar.personal" }],
      loading: false,
      error: null,
      refresh: () => {},
    };
    conn.status = "disconnected";
    render(<NextEventCard />);
    expect(screen.getByText("Dentist")).toBeInTheDocument();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  it("says it is loading rather than claiming the week is empty", () => {
    calendarResult.current = { events: [], loading: true, error: null, refresh: () => {} };
    render(<NextEventCard />);
    expect(screen.getByText("Loading events…")).toBeInTheDocument();
  });

  it("lists the next three events, soonest first", () => {
    const soon = (hoursAhead) => new Date(Date.now() + hoursAhead * 3600_000).toISOString();
    calendarResult.current = {
      events: [
        { uid: "c", summary: "Later still", cal_entity_id: "calendar.personal", ...at(soon(72)) },
        { uid: "a", summary: "Dentist", cal_entity_id: "calendar.personal", ...at(soon(2)) },
        { uid: "b", summary: "Standup", cal_entity_id: "calendar.personal", ...at(soon(26)) },
        { uid: "d", summary: "Way off", cal_entity_id: "calendar.personal", ...at(soon(120)) },
      ],
      loading: false,
      error: null,
      refresh: () => {},
    };
    render(<NextEventCard />);

    expect(screen.getByText("Dentist")).toBeInTheDocument();
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.queryByText("Way off")).not.toBeInTheDocument(); // only three fit
  });

  it("leaves out an event that has already started", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    calendarResult.current = {
      events: [{ uid: "a", summary: "Already begun", cal_entity_id: "calendar.personal", ...at(past) }],
      loading: false,
      error: null,
      refresh: () => {},
    };
    render(<NextEventCard />);
    expect(screen.queryByText("Already begun")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled this week")).toBeInTheDocument();
  });

  it.skip("BUG: drops an event whose start time cannot be read, instead of printing Invalid Date", () => {
    // `start < now` is false when `start` is an Invalid Date, so the event
    // survives the filter and its label renders as the literal string
    // "Invalid Date" on the Overview tab (LESSONS.md pattern 4).
    // Expected: the event is skipped, exactly like one with no start at all.
    calendarResult.current = {
      events: [{ uid: "a", summary: "Broken", cal_entity_id: "calendar.personal", ...at("not-a-date") }],
      loading: false,
      error: null,
      refresh: () => {},
    };
    render(<NextEventCard />);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled this week")).toBeInTheDocument();
  });
});
