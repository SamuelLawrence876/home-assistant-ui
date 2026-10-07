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

/* A calendar Home Assistant can't write to. HA's entity_service_call drops an
   unavailable target and still resolves, so a create into a dead calendar used
   to close the dialog as a success with nothing written. It is now greyed out
   in the picker and refused, in words, if it is the one chosen at submit. */
describe("NewEventDialog with a calendar that can't take the event", () => {
  const mixed = [
    { entity_id: "calendar.icloud", label: "iCloud", dead: true, creatable: true },
    { entity_id: "calendar.holidays", label: "Holidays", dead: false, creatable: false },
    { entity_id: "calendar.personal", label: "Personal", dead: false, creatable: true },
  ];

  function openWith(list, defaultCalendarId) {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <NewEventDialog
        onClose={onClose}
        onCreated={onCreated}
        calendars={list}
        defaultCalendarId={defaultCalendarId}
        initial={{ date: "2026-08-05", startTime: "10:00", endTime: "11:00" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
    return { onClose, onCreated };
  }
  const option = (name) => screen.getByRole("option", { name });

  it("marks a dead calendar '(unavailable)' and won't let it be picked", () => {
    openWith(mixed, "calendar.personal");
    expect(option("iCloud (unavailable)")).toBeDisabled();
    expect(option("Holidays (read-only)")).toBeDisabled();
    expect(option("Personal")).not.toBeDisabled();
  });

  it("refuses a create into a calendar that died after it was chosen", async () => {
    const { onClose, onCreated } = openWith(mixed, "calendar.icloud");
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/iCloud is unavailable in Home Assistant right now/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Create stays enabled: a button that disables under the cursor drops focus.
    expect(screen.getByRole("button", { name: "Create event" })).not.toBeDisabled();
  });

  it("refuses a read-only calendar", async () => {
    openWith(mixed, "calendar.holidays");
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Holidays doesn't take new events/)).toBeInTheDocument();
  });

  it("refuses a calendar that is no longer in the list", async () => {
    openWith(mixed.slice(1), "calendar.icloud");
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/no longer in Home Assistant/)).toBeInTheDocument();
  });

  it("goes through once a live calendar is picked", async () => {
    const { onClose, onCreated } = openWith(mixed, "calendar.icloud");
    await submit();
    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "calendar.personal" } });
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({ entity_id: "calendar.personal" });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("says so, and can't submit, when no calendar can take an event", async () => {
    openWith([mixed[0], mixed[1]], "");
    expect(screen.getByLabelText("Calendar").value).toBe("");
    expect(option("No calendar can take new events")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();
    await submit();
    expect(calls).toHaveLength(0);
  });
});

/* Round 4b (C2). The chosen calendar can leave the list while the dialog is
   open: removed in Home Assistant, or not loaded yet after an HA restart (the
   socket holds back entities that haven't come back). React's controlled
   select then showed the first enabled calendar while the state — and so the
   submit — kept the gone one: "Personal" on screen, "no longer in Home
   Assistant" on Create, and picking the Personal it already showed fired no
   change event. With one calendar left the dialog couldn't be submitted at
   all. The gone one now stays chosen, shown as "(not found)". */
describe("NewEventDialog when the chosen calendar leaves the list", () => {
  const both = [
    { entity_id: "calendar.icloud", label: "iCloud", dead: false, creatable: true },
    { entity_id: "calendar.personal", label: "Personal", dead: false, creatable: true },
  ];
  function openOn(list, chosen) {
    const props = {
      onClose: vi.fn(),
      onCreated: vi.fn(),
      defaultCalendarId: chosen,
      initial: { date: "2026-08-05", startTime: "10:00", endTime: "11:00" },
    };
    const view = render(<NewEventDialog {...props} calendars={list} />);
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
    return { ...props, setCalendars: (next) => view.rerender(<NewEventDialog {...props} calendars={next} />) };
  }
  const select = () => screen.getByLabelText("Calendar");
  const shown = () => select().selectedOptions[0]?.textContent;

  it("keeps showing the calendar a create would go to, by name, marked (not found)", async () => {
    const { setCalendars, onClose } = openOn(both, "calendar.icloud");
    expect(shown()).toBe("iCloud");
    setCalendars(both.slice(1));
    expect(select().value).toBe("calendar.icloud");
    expect(shown()).toBe("iCloud (not found)");
    expect(screen.getByRole("option", { name: "iCloud (not found)" })).toBeDisabled();
    await submit();
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/no longer in Home Assistant/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the one calendar left is a real change to pick, and the event goes there", async () => {
    const { setCalendars, onClose } = openOn(both, "calendar.icloud");
    setCalendars(both.slice(1));
    // A browser fires no change for the option already showing — so it mustn't be Personal.
    expect(select().value).not.toBe("calendar.personal");
    fireEvent.change(select(), { target: { value: "calendar.personal" } });
    expect(shown()).toBe("Personal");
    expect(screen.queryByRole("option", { name: /not found/ })).toBeNull();
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({ entity_id: "calendar.personal" });
    expect(onClose).toHaveBeenCalled();
  });

  it("is still the choice when it comes back, as after an HA restart", async () => {
    const { setCalendars } = openOn(both, "calendar.icloud");
    setCalendars(both.slice(1));
    setCalendars(both);
    expect(shown()).toBe("iCloud");
    expect(screen.queryByRole("option", { name: /not found/ })).toBeNull();
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({ entity_id: "calendar.icloud" });
  });
});

/* Round 4d (D4, D18). The refusal was stored when Create was pressed, so it
   went stale: it kept saying "iCloud is unavailable…" with Personal picked,
   and "Work hasn't loaded yet" after Work had loaded — or under a select that
   by then read "Work (not found)". It now follows the calendar chosen. */
describe("NewEventDialog's refusal follows the chosen calendar", () => {
  const live = (entity_id, label) => ({ entity_id, label, dead: false, creatable: true });
  const work = live("calendar.work", "Work");
  const personal = live("calendar.personal", "Personal");
  const icloud = live("calendar.icloud", "iCloud");
  function openOn(list, chosen, loadingIds = []) {
    const props = {
      onClose: vi.fn(),
      onCreated: vi.fn(),
      defaultCalendarId: chosen,
      initial: { date: "2026-08-05", startTime: "10:00", endTime: "11:00" },
    };
    const view = render(<NewEventDialog {...props} calendars={list} loadingIds={loadingIds} />);
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });
    return { ...props, update: (next, ids = []) => view.rerender(<NewEventDialog {...props} calendars={next} loadingIds={ids} />) };
  }
  const refusalText = () => document.querySelector(".modal-error")?.textContent ?? null;
  const shown = () => screen.getByLabelText("Calendar").selectedOptions[0]?.textContent;

  it("goes when another calendar is picked, rather than naming the refused one", async () => {
    openOn([{ ...icloud, dead: true }, personal], "calendar.icloud");
    await submit();
    expect(refusalText()).toMatch(/^iCloud is unavailable/);

    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "calendar.personal" } });
    expect(shown()).toBe("Personal");
    expect(refusalText()).toBe(null);
    expect(calls).toHaveLength(0);
  });

  it("goes once the calendar that hadn't loaded is back, and Create then goes through", async () => {
    const { update } = openOn([work, personal], "calendar.work");
    update([personal], ["calendar.work"]);
    await submit();
    expect(refusalText()).toMatch(/^Work hasn't loaded yet/);

    update([work, personal]);
    expect(shown()).toBe("Work");
    expect(refusalText()).toBe(null);
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({ entity_id: "calendar.work" });
  });

  it("says it's gone, not 'hasn't loaded yet', once the wait for it is over", async () => {
    const { update } = openOn([work, personal], "calendar.work");
    update([personal], ["calendar.work"]);
    await submit();
    update([personal]);
    expect(shown()).toBe("Work (not found)");
    expect(refusalText()).toMatch(/no longer in Home Assistant/);
    expect(refusalText()).not.toMatch(/hasn't loaded/);
  });

  it("goes once a dead calendar is live again", async () => {
    const { update } = openOn([{ ...icloud, dead: true }, personal], "calendar.icloud");
    await submit();
    expect(refusalText()).toMatch(/^iCloud is unavailable/);
    update([icloud, personal]);
    expect(refusalText()).toBe(null);
  });

  it("names the calendar now chosen if that one dies too, and only after a refused Create", async () => {
    const { update } = openOn([{ ...icloud, dead: true }, personal], "calendar.icloud");
    await submit();
    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "calendar.personal" } });
    update([{ ...icloud, dead: true }, { ...personal, dead: true }]);
    expect(refusalText()).toBe(null); // nothing refused for Personal yet
    await submit();
    expect(refusalText()).toMatch(/^Personal is unavailable/);
    expect(calls).toHaveLength(0);
  });
});
