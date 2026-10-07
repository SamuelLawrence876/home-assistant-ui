/* Round 4d (D1) — the calendar cards across a Restart HA, end to end.

   The reconnect fetch fired at "ready", which the socket announces before
   HA's first batch on the new connection, so it asked for the calendar list
   from before the drop. When that batch then had no calendars (every one
   still loading), the hook's answer for "nothing to fetch" didn't supersede
   the fetch still in flight, and it landed last: HA's 400 for a calendar it
   hadn't loaded read "Calendar unavailable — Home Assistant didn't answer."
   on Overview and "This week · unavailable" on Schedule; with a 200 instead,
   Overview kept every pre-restart event, still counting them after the
   5-minute bound while Schedule said "No calendars".

   Everything real except the WebSocket and fetch: socket.js over the
   library's own Connection (the harness round4c-socket.test.jsx uses), the
   real useCalendarEvents, and both real cards. Calendar fetches are held
   open until the test answers them, the way a REST call to a Pi still busy
   restarting outlasts the first entity batch. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { HELD_BACK_WAIT_MS } from "../../src/ha/heldBack.js";

const HA = "https://ha.example.invalid";

const lib = vi.hoisted(() => ({ ha: null, pending: [] }));

vi.mock("home-assistant-js-websocket", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createConnection: (options) => real.createConnection({ ...options, createSocket: async () => lib.ha.open() }),
  };
});
vi.mock("../../src/ha/loginRedirect.js", async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: () => {},
}));

/* A stand-in Home Assistant speaking subscribe_entities, as in
   round4c-socket.test.jsx: initial values are a state string or { s, a }. */
function fakeHa(initial = {}) {
  const ha = { entities: {}, sockets: [], waiting: [], live: [] };
  const emit = (sock, type, ev) => (sock.listeners[type] || []).slice().forEach((cb) => cb(ev));
  const lc = () => Math.floor(Date.now() / 1000);
  const compressed = (v) => (typeof v === "string" ? { s: v, a: {}, lc: lc() } : { s: v.s, a: v.a || {}, lc: lc() });
  for (const [id, v] of Object.entries(initial)) ha.entities[id] = compressed(v);

  ha.open = () => {
    const sock = {
      listeners: {},
      readyState: 1,
      OPEN: 1,
      haVersion: "2026.10.0",
      addEventListener: (t, cb) => (sock.listeners[t] ||= []).push(cb),
      removeEventListener: (t, cb) => {
        sock.listeners[t] = (sock.listeners[t] || []).filter((x) => x !== cb);
      },
      send(raw) {
        const msg = JSON.parse(raw);
        if (msg.type === "subscribe_entities") ha.waiting.push({ sock, id: msg.id });
      },
      close() {
        if (sock.readyState === 3) return;
        sock.readyState = 3;
        emit(sock, "close", {});
      },
      deliver: (msg) => emit(sock, "message", { data: JSON.stringify(msg) }),
    };
    ha.sockets.push(sock);
    return sock;
  };
  ha.answer = () => {
    for (const sub of ha.waiting.splice(0)) {
      sub.sock.deliver({ id: sub.id, type: "result", success: true, result: null });
      sub.sock.deliver({ id: sub.id, type: "event", event: { a: { ...ha.entities } } });
      ha.live.push(sub);
    }
  };
  ha.drop = () => {
    ha.live = [];
    ha.sockets.at(-1).close();
  };
  return ha;
}

const SESSION = {
  hassUrl: HA,
  clientId: "http://localhost:3000/",
  access_token: "stored-access",
  refresh_token: "stored-refresh",
  expires_in: 1800,
};

let added = [];

async function loadPage() {
  vi.resetModules();
  const winSpy = vi.spyOn(window, "addEventListener");
  const docSpy = vi.spyOn(document, "addEventListener");
  const socket = await import("../../src/ha/socket.js");
  added.push(...winSpy.mock.calls.map(([t, h]) => [window, t, h]));
  added.push(...docSpy.mock.calls.map(([t, h]) => [document, t, h]));
  winSpy.mockRestore();
  docSpy.mockRestore();
  return socket;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
const reconnect = () => act(() => vi.advanceTimersByTimeAsync(0));

async function connected(initial) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 5, 9, 0)); // Wed 5 Aug 2026, 09:00 local
  localStorage.setItem("ha_tokens", JSON.stringify({ ...SESSION, expires: Date.now() + 3600_000 }));
  lib.ha = fakeHa(initial);
  const socket = await loadPage();
  await flush();
  act(() => lib.ha.answer());
  return socket;
}

/* Restart HA: dropped, back on a new connection ("ready"), then its first
   answer — without `ids`, whose integrations haven't loaded yet. */
async function restartWithout(...ids) {
  for (const id of ids) delete lib.ha.entities[id];
  act(() => lib.ha.drop());
  await reconnect();
  act(() => lib.ha.answer());
  await flush();
}

const calendarFetches = () => fetch.mock.calls.filter(([url]) => String(url).includes("/api/calendars/")).length;
const event = (calId, summary) => ({
  uid: `${calId}-${summary}`,
  summary,
  start: { dateTime: new Date(2026, 7, 5, 14, 0).toISOString() },
  end: { dateTime: new Date(2026, 7, 5, 15, 0).toISOString() },
});
const ok = (list) => ({ ok: true, status: 200, json: async () => list, text: async () => "" });
const refuse = { ok: false, status: 400, json: async () => ({}), text: async () => "400: Bad Request" };
/* Answers every calendar fetch still open: `reply(entityId)` → a response. */
async function answerCalendars(reply) {
  for (const { url, resolve } of lib.pending.splice(0)) {
    resolve(reply(decodeURIComponent(url.split("/api/calendars/")[1].split("?")[0])));
  }
  await flush();
}
const SUMMARIES = { "calendar.work": "Standup", "calendar.home": "Bin day" };
const theirEvents = (id) => ok([event(id, SUMMARIES[id])]);

const meta = (container) => container.querySelector(".meta")?.textContent;
const cal = (name) => ({ s: "off", a: { friendly_name: name, supported_features: 1 } });

async function bothCards() {
  const { NextEventCard } = await import("../../src/cards/overview/NextEventCard.jsx");
  const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");
  const overview = render(<NextEventCard />).container;
  const week = render(<WeeklyCalendarCard />).container;
  await flush();
  await answerCalendars(theirEvents);
  expect(meta(overview)).toBe("2 events");
  expect(meta(week)).toBe("2 events");
  return { overview, week };
}

beforeEach(() => {
  vi.stubEnv("VITE_HA_URL", HA);
  sessionStorage.clear();
  localStorage.clear();
  lib.pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url) =>
      String(url).includes("/api/calendars/")
        ? new Promise((resolve) => lib.pending.push({ url: String(url), resolve }))
        : Promise.resolve({ ok: false, status: 400, json: async () => ({}), text: async () => "" }),
    ),
  );
  // jsdom has no ResizeObserver; WeekGrid only uses it to re-read --col-h.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [target, type, handler] of added) target.removeEventListener(type, handler);
  added = [];
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe("Calendar cards across a Restart HA with every calendar still loading", () => {
  it("say loading, not unavailable, when HA refuses calendars it hasn't loaded (real HA: 400)", async () => {
    await connected({ "calendar.work": cal("Work"), "calendar.home": cal("Home"), "light.a": "on" });
    const { overview, week } = await bothCards();
    const asked = calendarFetches();

    await restartWithout("calendar.work", "calendar.home");
    expect(calendarFetches()).toBe(asked); // nothing asked over the pre-restart list
    await answerCalendars(() => refuse);

    expect(overview.textContent).toMatch(/Loading events…/);
    expect(meta(overview)).toBe("loading");
    expect(week.textContent).toMatch(/Loading this week…/);
    expect(meta(week)).toBe("loading…");
    expect(overview.textContent + week.textContent).not.toMatch(/unavailable|didn't answer/i);

    // Where the old 8 s retry used to flip it back: still loading.
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(meta(overview)).toBe("loading");
    expect(meta(week)).toBe("loading…");
  });

  it("drop the pre-restart events, and agree on 'no calendars' once the wait runs out (HA answering 200)", async () => {
    await connected({ "calendar.work": cal("Work"), "calendar.home": cal("Home"), "light.a": "on" });
    const { overview, week } = await bothCards();

    await restartWithout("calendar.work", "calendar.home");
    await answerCalendars(theirEvents);

    expect(overview.textContent).not.toMatch(/Standup|Bin day/);
    expect(meta(overview)).toBe("loading");
    expect(meta(week)).toBe("loading…");

    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS));
    expect(meta(overview)).toBe("no calendars");
    expect(meta(week)).toBe("no calendars");
    expect(overview.textContent).not.toMatch(/Standup|Bin day/);
  });

  it("ask again for HA's own list once its first batch is in — once, and only for what it has", async () => {
    await connected({ "calendar.work": cal("Work"), "calendar.home": cal("Home"), "light.a": "on" });
    const { overview } = await bothCards();
    const asked = calendarFetches();

    await restartWithout("calendar.work"); // Home is back at once; Work is still loading
    const urls = fetch.mock.calls.slice(-2).map(([url]) => String(url));
    expect(calendarFetches()).toBe(asked + 2); // one per card, for Home only
    expect(urls.every((u) => u.includes("/api/calendars/calendar.home"))).toBe(true);

    await answerCalendars(theirEvents);
    expect(overview.textContent).toMatch(/Bin day/);
    expect(overview.textContent).not.toMatch(/Standup/);
    expect(meta(overview)).toBe("1 event · some calendars loading");
  });
});
