/* The new-event dialog must never post a NaN timestamp to Home Assistant.

   Clearing a time field (or the date) parses to an Invalid Date, and every
   comparison against NaN is false — so the end-after-start check used to wave
   it through and "NaN-NaN-NaNTNaN:NaN:00+NaN:NaN" went to
   calendar.create_event. toLocalISOWithOffset now returns null for that
   (dateUtils.test.js); this is the dialog's half: say so, don't submit. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const calls = [];
vi.mock("../../src/ha/client.js", () => ({
  callService: async (...args) => {
    calls.push(args);
  },
}));

const { NewEventDialog } = await import("../../src/cards/schedule/NewEventDialog.jsx");

const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/;
const calendars = [{ entity_id: "calendar.personal", label: "Personal" }];

function open() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewEventDialog
      onClose={onClose}
      onCreated={onCreated}
      calendars={calendars}
      defaultCalendarId="calendar.personal"
      initial={{ date: "2026-08-05", startTime: "10:00", endTime: "11:00" }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
  return { onClose, onCreated };
}

const submit = () => act(async () => {
  // fireEvent.submit skips the browser's own `required` check on purpose:
  // the dialog's guard is what's under test, not the browser's.
  fireEvent.submit(screen.getByRole("dialog"));
});

beforeEach(() => {
  calls.length = 0;
});

describe("NewEventDialog with an unreadable date or time", () => {
  it("refuses a cleared start time instead of posting NaN", async () => {
    const { onClose } = open();
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } });
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Couldn't read that date or time/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a cleared end time", async () => {
    open();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "" } });
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Couldn't read that date or time/)).toBeInTheDocument();
  });

  it("refuses a cleared date on a timed event", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Couldn't read that date or time/)).toBeInTheDocument();
  });

  it("refuses a cleared date on an all-day event", async () => {
    open();
    fireEvent.click(screen.getByLabelText("All-day"));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Couldn't read that date or time/)).toBeInTheDocument();
  });

  it("lets the person fix it and submit, once the time is readable again", async () => {
    const { onClose, onCreated } = open();
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } });
    await submit();
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    await submit();
    expect(calls).toHaveLength(1);
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("NewEventDialog with good input", () => {
  it("posts timestamps that carry their own offset", async () => {
    open();
    await submit();
    expect(calls).toHaveLength(1);
    const [domain, service, data, target] = calls[0];
    expect(`${domain}.${service}`).toBe("calendar.create_event");
    expect(target).toEqual({ entity_id: "calendar.personal" });
    expect(data.summary).toBe("Dentist");
    expect(data.start_date_time).toMatch(WITH_OFFSET);
    expect(data.end_date_time).toMatch(WITH_OFFSET);
    expect(data.start_date_time.startsWith("2026-08-05T10:00:00")).toBe(true);
  });

  it("posts an all-day event with an exclusive end date", async () => {
    open();
    fireEvent.click(screen.getByLabelText("All-day"));
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ start_date: "2026-08-05", end_date: "2026-08-06" });
  });

  it("still says so when the end is not after the start", async () => {
    open();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "09:00" } });
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText("End time must be after start time.")).toBeInTheDocument();
  });
});
