/* The weekly calendar card's "+ Add event": which calendar the dialog starts
   on, and what happens when that calendar is dead.

   It used to start on calendarIds[0] — the alphabetically first calendar,
   whatever its state — and Home Assistant drops a service call aimed at an
   unavailable entity and still answers success. So with the iCloud calendar
   down, "Create event" closed the dialog as a success and wrote nothing.
   callService below behaves the way HA does for exactly that case. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ entities: [], sent: [] }));

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntitiesByDomain: () => h.entities,
  useConnectionStatus: () => "ready",
}));
vi.mock("../../src/hooks/useDashReady.js", () => ({ useDashReady: () => true }));
vi.mock("../../src/hooks/useNow.js", () => ({ useNow: () => 12 }));
vi.mock("../../src/ha/client.js", () => ({
  // HA's entity_service_call: an unavailable target is skipped, and a call
  // that wants no response resolves cleanly anyway.
  callService: async (domain, service, data, target) => {
    const ent = h.entities.find((e) => e.entity_id === target?.entity_id);
    h.sent.push({ service: `${domain}.${service}`, entity_id: target?.entity_id, wrote: ent?.state !== "unavailable" });
    return null;
  },
}));
vi.mock("../../src/ha/useCalendarEvents.js", () => ({
  useCalendarEvents: () => ({ events: [], loading: false, error: null, failedIds: [], refresh: () => {} }),
}));

const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");

const cal = (id, name, state, supported_features) => ({
  entity_id: id,
  state,
  attributes: { friendly_name: name, ...(supported_features === undefined ? {} : { supported_features }) },
});

function openDialog() {
  render(<WeeklyCalendarCard />);
  fireEvent.click(screen.getByRole("button", { name: "Add event" }));
  return screen.getByLabelText("Calendar");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 5, 12, 0));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  h.sent.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WeeklyCalendarCard → New event: the starting calendar", () => {
  it("skips an unavailable calendar, even when it sorts first", () => {
    h.entities = [cal("calendar.a_icloud", "iCloud", "unavailable", 1), cal("calendar.b_local", "Local", "off", 7)];
    const select = openDialog();
    expect(select.value).toBe("calendar.b_local");
    expect(screen.getByRole("option", { name: "iCloud (unavailable)" })).toBeDisabled();
  });

  it("treats 'unknown' as dead too", () => {
    h.entities = [cal("calendar.a_icloud", "iCloud", "unknown", 1), cal("calendar.b_local", "Local", "off", 7)];
    expect(openDialog().value).toBe("calendar.b_local");
    expect(screen.getByRole("option", { name: "iCloud (unavailable)" })).toBeDisabled();
  });

  it("prefers a calendar that says it takes new events over a read-only one", () => {
    h.entities = [cal("calendar.a_holidays", "Holidays", "off", 0), cal("calendar.b_local", "Local", "on", 7)];
    expect(openDialog().value).toBe("calendar.b_local");
    expect(screen.getByRole("option", { name: "Holidays (read-only)" })).toBeDisabled();
  });

  it("falls back to a live calendar that doesn't report its features", () => {
    h.entities = [cal("calendar.a_icloud", "iCloud", "unavailable", 1), cal("calendar.b_other", "Other", "off")];
    expect(openDialog().value).toBe("calendar.b_other");
    expect(screen.getByRole("option", { name: "Other" })).not.toBeDisabled();
  });

  it("starts on nothing, and can't submit, when every calendar is dead", () => {
    h.entities = [cal("calendar.a_icloud", "iCloud", "unavailable", 1), cal("calendar.b_work", "Work", "unknown", 1)];
    expect(openDialog().value).toBe("");
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();
  });
});

describe("WeeklyCalendarCard → New event: never a silent no-op", () => {
  it("creates into the live calendar, not the dead one HA would skip", async () => {
    h.entities = [cal("calendar.a_icloud", "iCloud", "unavailable", 1), cal("calendar.b_local", "Local", "off", 7)];
    openDialog();
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
    await act(async () => { fireEvent.submit(screen.getByRole("dialog")); });
    expect(h.sent).toEqual([{ service: "calendar.create_event", entity_id: "calendar.b_local", wrote: true }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
