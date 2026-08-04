/* The calendar fetch — the worst bug in the 2026-08 sweep lived here.

   A caller derived its fetch range from `new Date()` during render. That range
   keyed the fetch, the fetch returned a fresh array, the fresh array
   re-rendered the caller, the caller produced a new timestamp: 5-20 REST
   requests a second at the Pi, forever, from boot, on the default tab.

   So the two properties under test are (1) the same range never fetches twice
   and (2) the returned array keeps its identity when the data has not changed.
   Property 2 is what makes property 1 hold for a caller that is already
   slightly wrong. Nothing here touches a network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let connectionStatus = "ready";
const connectionListeners = new Set();

vi.mock("../../src/ha/socket.js", () => ({
  getHaUrl: () => "https://ha.example.invalid",
  getFreshAccessToken: async () => "test-token",
  getConnectionStatus: () => connectionStatus,
  onConnectionChange: (cb) => {
    connectionListeners.add(cb);
    return () => connectionListeners.delete(cb);
  },
}));

const { useCalendarEvents } = await import("../../src/ha/useCalendarEvents.js");

const EVENT = {
  uid: "evt-1",
  summary: "Dentist",
  start: { dateTime: "2026-08-05T10:00:00+01:00" },
  end: { dateTime: "2026-08-05T10:30:00+01:00" },
};

const START = "2026-08-04T00:00:00.000Z";
const END = "2026-08-11T00:00:00.000Z";

let fetchMock;

beforeEach(() => {
  connectionStatus = "ready";
  connectionListeners.clear();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [{ ...EVENT }],
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calendarUrls = () => fetchMock.mock.calls.map(([url]) => url);

describe("useCalendarEvents", () => {
  it("asks each calendar for the range once", async () => {
    const { result } = renderHook(() =>
      useCalendarEvents(["calendar.personal", "calendar.work"], START, END),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calendarUrls()[0]).toContain("/api/calendars/calendar.personal");
    expect(calendarUrls()[0]).toContain(`start=${encodeURIComponent(START)}`);
  });

  it("does not fetch again when the caller re-renders with the same range", async () => {
    const { result, rerender } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    for (let i = 0; i < 10; i++) rerender();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch again when the caller rebuilds an equal range string every render", async () => {
    // A caller that recomputes its range on every render is the shape that
    // caused the storm. Equal strings must be the same run.
    const { result, rerender } = renderHook(
      ({ start, end }) => useCalendarEvents(["calendar.personal"], start, end),
      { initialProps: { start: START, end: END } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    for (let i = 0; i < 10; i++) rerender({ start: `${START}`, end: `${END}` });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands back the same array object when a refetch brings back the same events", async () => {
    // A fresh array identity re-renders every consumer, and a consumer that
    // derives its range while rendering then hands us a new key and starts the
    // fetch over. This is the brake on that loop.
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    const first = result.current.events;

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // an explicit refresh does refetch
    expect(result.current.events).toBe(first); // but nothing downstream re-renders
  });

  it("hands back a new array when the events actually changed", async () => {
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    const first = result.current.events;

    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ ...EVENT, summary: "Dentist (moved)" }],
      text: async () => "",
    }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.events).not.toBe(first);
    expect(result.current.events[0].summary).toBe("Dentist (moved)");
  });

  it("fetches again when the range really does move", async () => {
    const { result, rerender } = renderHook(
      ({ start, end }) => useCalendarEvents(["calendar.personal"], start, end),
      { initialProps: { start: START, end: END } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ start: "2026-08-11T00:00:00.000Z", end: "2026-08-18T00:00:00.000Z" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(calendarUrls()[1]).toContain(encodeURIComponent("2026-08-11T00:00:00.000Z"));
  });

  it("says which calendar each event came from", async () => {
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].cal_entity_id).toBe("calendar.personal");
  });

  it("does not call Home Assistant at all when there are no calendars", async () => {
    const { result } = renderHook(() => useCalendarEvents([], START, END));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
  });

  it("keeps handing back the same empty array when there is nothing to fetch", async () => {
    // Otherwise a caller that re-renders on `events` loops with no network in
    // the way to slow it down.
    const { result, rerender } = renderHook(() => useCalendarEvents([], START, END));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.events;
    for (let i = 0; i < 5; i++) rerender();
    expect(result.current.events).toBe(first);
  });

  it("does not fetch before the socket is ready", async () => {
    connectionStatus = "connecting";
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.events).toEqual([]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once the socket becomes ready, without the caller doing anything", async () => {
    connectionStatus = "connecting";
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    expect(fetchMock).not.toHaveBeenCalled();

    connectionStatus = "ready";
    await act(async () => {
      connectionListeners.forEach((cb) => cb("ready"));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an error rather than an empty week when Home Assistant refuses", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => [],
      text: async () => "bad gateway",
    }));
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // An empty list with an error set means "we do not know", not "nothing on".
    expect(result.current.events).toEqual([]);
    expect(result.current.error.message).toContain("502");
  });

  it("does not treat a failed run as done, so the range can be retried", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => [],
      text: async () => "bad gateway",
    }));
    const { result } = renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ ...EVENT }],
      text: async () => "",
    }));
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.error).toBe(null);
  });

  it("keeps the events it did get when only one of several calendars fails", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("calendar.work")
        ? { ok: false, status: 500, json: async () => [], text: async () => "nope" }
        : { ok: true, status: 200, json: async () => [{ ...EVENT }], text: async () => "" },
    );
    const { result } = renderHook(() =>
      useCalendarEvents(["calendar.personal", "calendar.work"], START, END),
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].cal_entity_id).toBe("calendar.personal");
  });

  it("sends the token in a header, never in the URL", async () => {
    renderHook(() => useCalendarEvents(["calendar.personal"], START, END));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain("test-token");
    expect(init.headers.Authorization).toBe("Bearer test-token");
  });
});
