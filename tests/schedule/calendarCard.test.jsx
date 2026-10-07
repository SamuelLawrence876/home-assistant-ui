/* The weekly calendar card when only some calendars can be read.

   calendar.work going dark (an expired CalDAV or Google credential) while
   calendar.personal is fine used to read "3 events · may be out of date",
   with Work listed in the legend as normal — so a Work calendar we could not
   read looked exactly like a Work calendar with nothing on. The hook now
   reports which calendars failed; these tests pin what the card says. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const PERSONAL = { entity_id: "calendar.personal", state: "off", attributes: { friendly_name: "Personal" } };
const WORK = { entity_id: "calendar.work", state: "off", attributes: { friendly_name: "Work" } };
const cal = { entities: [PERSONAL, WORK] };
const hook = { current: null };
const conn = { status: "ready", dashReady: true };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntitiesByDomain: () => cal.entities,
  useConnectionStatus: () => conn.status,
}));
vi.mock("../../src/hooks/useDashReady.js", () => ({ useDashReady: () => conn.dashReady }));
vi.mock("../../src/hooks/useNow.js", () => ({ useNow: () => 12 }));
vi.mock("../../src/ha/client.js", () => ({ callService: async () => {} }));
vi.mock("../../src/ha/useCalendarEvents.js", () => ({
  useCalendarEvents: () => hook.current,
}));

const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");

// Wednesday 5 August 2026, so the week is Mon 3 - Sun 9.
const gym = {
  uid: "gym",
  summary: "Gym",
  cal_entity_id: "calendar.personal",
  start: { dateTime: new Date(2026, 7, 5, 10, 0).toISOString() },
  end: { dateTime: new Date(2026, 7, 5, 11, 0).toISOString() },
};
const standup = { ...gym, uid: "standup", summary: "Standup", cal_entity_id: "calendar.work" };
const result = (over) => ({ events: [], loading: false, error: null, failedIds: [], refresh: () => {}, ...over });
const legendItem = (label) =>
  [...document.querySelectorAll(".cal-legend .item")].find((n) => n.textContent.startsWith(label));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 5, 12, 0));
  conn.status = "ready";
  conn.dashReady = true;
  cal.entities = [PERSONAL, WORK];
  hook.current = result();
  // jsdom has no ResizeObserver; WeekGrid only uses it to re-read --col-h.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WeeklyCalendarCard with one calendar unreadable", () => {
  it("names the calendar it couldn't read, rather than 'may be out of date'", () => {
    hook.current = result({ events: [gym], error: new Error("500"), failedIds: ["calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("1 events · Work unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();
  });

  it("marks that calendar in the legend, and only that one", () => {
    hook.current = result({ events: [gym], error: new Error("500"), failedIds: ["calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(legendItem("Work").textContent).toMatch(/unavailable/);
    expect(legendItem("Work").getAttribute("title")).toMatch(/Couldn't read this calendar/);
    expect(legendItem("Personal").textContent).not.toMatch(/unavailable/);
  });

  it("keeps the failed calendar's last known events on the grid", () => {
    hook.current = result({ events: [gym, standup], error: new Error("500"), failedIds: ["calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("2 events · Work unavailable")).toBeInTheDocument();
  });

  it("does not call an empty week empty when one calendar couldn't be read", () => {
    hook.current = result({ error: new Error("500"), failedIds: ["calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(screen.queryByText("No events this week")).not.toBeInTheDocument();
    expect(screen.getByText("Work unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't read Work/)).toBeInTheDocument();
  });

  it("still says 'may be out of date' when every calendar failed", () => {
    hook.current = result({
      events: [gym],
      error: new Error("500"),
      failedIds: ["calendar.personal", "calendar.work"],
    });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("1 events · may be out of date")).toBeInTheDocument();
  });

  it("puts 'not connected' ahead of a per-calendar failure", () => {
    conn.status = "disconnected";
    hook.current = result({ events: [gym], error: new Error("500"), failedIds: ["calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("1 events · not connected")).toBeInTheDocument();
  });

  it("marks nothing when every calendar answered", () => {
    hook.current = result({ events: [gym, standup] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(document.querySelector(".cal-legend").textContent).not.toMatch(/unavailable/);
  });

  it("copes with a hook result that has no failedIds at all", () => {
    hook.current = { events: [gym], loading: false, error: null, refresh: () => {} };
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("1 events")).toBeInTheDocument();
  });
});

/* Round 4d (D1). After a Restart HA with every calendar still loading, the
   week read "This week · UNAVAILABLE — Home Assistant didn't answer for this
   week" (HA's 400 for a calendar it hadn't loaded), and a calendar HA had
   dropped kept its events on the grid until the next fetch landed. */
describe("WeeklyCalendarCard while Home Assistant is still sending its calendars back", () => {
  const listing = (entities, loadingIds = []) => {
    cal.entities = Object.assign([...entities], { loadingIds });
  };
  const meta = () => document.querySelector(".meta")?.textContent;

  it("says 'Loading this week…', not 'unavailable', when every calendar is loading and a read failed", () => {
    listing([], ["calendar.personal", "calendar.work"]);
    hook.current = result({ error: new Error("400"), failedIds: ["calendar.personal", "calendar.work"] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("Loading this week…")).toBeInTheDocument();
    expect(meta()).toBe("loading…");
    expect(screen.queryByText(/didn't answer/)).not.toBeInTheDocument();
  });

  it("keeps a calendar HA no longer lists off the grid and out of the count", () => {
    listing([PERSONAL], ["calendar.work"]);
    hook.current = result({ events: [gym, standup] });
    render(<WeeklyCalendarCard />);
    expect(screen.getByText("Gym")).toBeInTheDocument();
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
    expect(meta()).toBe("1 events · some calendars loading");
  });

  it("says 'No calendars' once none is loading either, with nothing left on the grid", () => {
    listing([]);
    hook.current = result({ events: [gym, standup] });
    render(<WeeklyCalendarCard />);
    expect(meta()).toBe("no calendars");
    expect(screen.queryByText("Gym")).not.toBeInTheDocument();
  });
});
