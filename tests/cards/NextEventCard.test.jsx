/* The Overview card that asked the Pi for its calendar 5-20 times a second.

   The card re-renders once a minute to keep its "Today / Tomorrow" labels
   honest. The fetch range it derives must NOT move at that rate — it is
   bucketed to the top of the hour, so it is identical across every render
   inside an hour and rolls forward exactly once when the hour turns. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

const PERSONAL = { entity_id: "calendar.personal", state: "on", attributes: { friendly_name: "Personal" } };
const cal = { entities: [PERSONAL] };
const calendarResult = { current: { events: [], loading: false, error: null, refresh: () => {} } };
const conn = { status: "ready", dashReady: true };
const rangesAsked = [];

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntitiesByDomain: () => cal.entities,
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
  cal.entities = [PERSONAL];
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

  it("drops an event whose start time cannot be read, instead of printing Invalid Date (roadmap I16)", () => {
    // `start < now` is false when `start` is an Invalid Date, so the event used
    // to survive the filter and its label rendered as the literal string
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

/* All-day events come from HA as a bare { date: "YYYY-MM-DD" }. Parsed with
   `new Date(str)` that is UTC midnight — 01:00 in BST — so today's all-day
   event vanished an hour into the day and the card said the week was empty.
   Every time here is built with local constructors, so the tests mean the same
   thing on a BST laptop and a UTC runner. */
describe("NextEventCard all-day events and the count", () => {
  const day = (start, end) => ({ start: { date: start }, end: { date: end } });
  const withEvents = (events) => {
    calendarResult.current = { events, loading: false, error: null, refresh: () => {} };
  };

  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 9, 6, 10, 0)); // Tue 6 Oct 2026, 10:00 local
  });

  it("keeps today's all-day event on screen all day, labelled Today", () => {
    withEvents([{ uid: "a", summary: "Bin day", cal_entity_id: "calendar.personal", ...day("2026-10-06", "2026-10-07") }]);
    render(<NextEventCard />);
    expect(screen.getByText("Bin day")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("Nothing scheduled this week")).not.toBeInTheDocument();
  });

  it("still shows it at 23:30 — the last half hour of the day it covers", () => {
    vi.setSystemTime(new Date(2026, 9, 6, 23, 30));
    withEvents([{ uid: "a", summary: "Bin day", cal_entity_id: "calendar.personal", ...day("2026-10-06", "2026-10-07") }]);
    render(<NextEventCard />);
    expect(screen.getByText("Bin day")).toBeInTheDocument();
  });

  it("keeps a multi-day event that began yesterday, and labels it Today rather than its start date", () => {
    withEvents([{ uid: "a", summary: "Half term", cal_entity_id: "calendar.personal", ...day("2026-10-05", "2026-10-10") }]);
    render(<NextEventCard />);
    expect(screen.getByText("Half term")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("drops an all-day event that finished yesterday (HA's end date is exclusive)", () => {
    withEvents([{ uid: "a", summary: "Over", cal_entity_id: "calendar.personal", ...day("2026-10-05", "2026-10-06") }]);
    render(<NextEventCard />);
    expect(screen.queryByText("Over")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled this week")).toBeInTheDocument();
  });

  it("treats a missing end date as a single day", () => {
    withEvents([{ uid: "a", summary: "Bin day", cal_entity_id: "calendar.personal", start: { date: "2026-10-06" } }]);
    render(<NextEventCard />);
    expect(screen.getByText("Bin day")).toBeInTheDocument();
  });

  it("drops an all-day event whose date cannot be read, rather than guessing one", () => {
    withEvents([
      { uid: "a", summary: "Rolled over", cal_entity_id: "calendar.personal", ...day("2026-02-31", "2026-03-01") },
      { uid: "b", summary: "Garbage", cal_entity_id: "calendar.personal", ...day("soon", "later") },
    ]);
    render(<NextEventCard />);
    expect(screen.queryByText("Rolled over")).not.toBeInTheDocument();
    expect(screen.queryByText("Garbage")).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("lists an all-day event later in the week by its own date, not as Today", () => {
    withEvents([{ uid: "a", summary: "Dentist", cal_entity_id: "calendar.personal", ...day("2026-10-09", "2026-10-10") }]);
    render(<NextEventCard />);
    expect(screen.getByText("Dentist")).toBeInTheDocument();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });

  it("puts today's all-day event ahead of a timed event later today", () => {
    withEvents([
      { uid: "t", summary: "Standup", cal_entity_id: "calendar.personal", start: { dateTime: new Date(2026, 9, 6, 15, 0).toISOString() } },
      { uid: "a", summary: "Bin day", cal_entity_id: "calendar.personal", ...day("2026-10-06", "2026-10-07") },
    ]);
    render(<NextEventCard />);
    const rows = screen.getAllByText(/^(Standup|Bin day)$/).map((el) => el.textContent);
    expect(rows).toEqual(["Bin day", "Standup"]);
  });

  it("counts the whole week in the meta line, not just the three rows that fit", () => {
    withEvents(
      Array.from({ length: 10 }, (_, i) => ({
        uid: `e${i}`,
        summary: `Event ${i}`,
        cal_entity_id: "calendar.personal",
        start: { dateTime: new Date(2026, 9, 7, 9 + i, 0).toISOString() },
      })),
    );
    render(<NextEventCard />);
    expect(screen.getByText("10 events")).toBeInTheDocument();
    expect(screen.getAllByText(/^Event \d$/)).toHaveLength(3);
  });

  it("says '1 event', not '1 events'", () => {
    withEvents([{ uid: "a", summary: "Bin day", cal_entity_id: "calendar.personal", ...day("2026-10-06", "2026-10-07") }]);
    render(<NextEventCard />);
    expect(screen.getByText("1 event")).toBeInTheDocument();
  });
});

/* Round 4d (D1). After a Restart HA, with every calendar still loading, the
   card read "Calendar unavailable — Home Assistant didn't answer." (HA's 400
   for a calendar it hadn't loaded yet) or kept the pre-restart events under
   a plain count, while the Schedule tab said "No calendars". */
describe("NextEventCard while Home Assistant is still sending its calendars back", () => {
  const standup = { uid: "s", summary: "Standup", cal_entity_id: "calendar.work", start: { dateTime: "2026-08-05T09:00:00.000Z" } };
  const dentist = { uid: "d", summary: "Dentist", cal_entity_id: "calendar.personal", start: { dateTime: "2026-08-05T11:00:00.000Z" } };
  const listing = (entities, loadingIds = []) => {
    cal.entities = Object.assign([...entities], { loadingIds });
  };
  const result = (over) => ({ events: [], loading: false, error: null, refresh: () => {}, ...over });

  it("says loading, not unavailable, when every calendar is loading and a read failed", () => {
    listing([], ["calendar.personal", "calendar.work"]);
    calendarResult.current = result({ error: new Error("HA GET /api/calendars/calendar.work → 400") });
    render(<NextEventCard />);
    expect(screen.getByText("Loading events…")).toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("doesn't show events from a calendar HA no longer lists", () => {
    listing([], ["calendar.work"]);
    calendarResult.current = result({ events: [standup] });
    render(<NextEventCard />);
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 event/)).not.toBeInTheDocument();
    expect(screen.getByText("Loading events…")).toBeInTheDocument();
  });

  it("says there are no calendars once none is loading either, rather than counting old events", () => {
    listing([]);
    calendarResult.current = result({ events: [standup] });
    render(<NextEventCard />);
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
    expect(screen.getByText("No calendars are exposed to this dashboard.")).toBeInTheDocument();
  });

  it("keeps a listed calendar's events and drops only the gone one's, count included", () => {
    listing([PERSONAL], ["calendar.work"]);
    calendarResult.current = result({ events: [standup, dentist] });
    render(<NextEventCard />);
    expect(screen.getByText("Dentist")).toBeInTheDocument();
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
    expect(screen.getByText("1 event · some calendars loading")).toBeInTheDocument();
  });
});
