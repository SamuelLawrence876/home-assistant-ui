/* Round 4c (2026-10-06 sweep, re-review) — the shared HA connection's readers.

   R4C-1 — round 4b made an entity held back after a reconnect "loading" for
           useEntityStatus, but every reader of a whole domain or set just saw
           it gone. After each Restart HA, while slow integrations loaded: the
           week said "No calendars", the new-event dialog "(not found)" / "no
           longer in Home Assistant", Updates "✓ current" from a partial set,
           Scenes counted held-back devices "offline" (and its header read one
           bulb's status as the whole set's), and the topbar total dropped.
   R4C-4 — Sign out locked only the tab that pressed it. Another Glasshouse
           tab in the same browser kept its session in memory and could write
           its tokens, its error log or its Spotify token back.
   R4C-5 — Sign out closes the socket itself, so the library fired no
           "disconnected": for the whole revoke wait every card read "ready"
           over a closed socket.

   Same harness as round4-socket.test.jsx: the library's own Connection,
   collection and entity store, over a fake WebSocket answered by a stand-in
   HA. jsdom can't reload, so loginRedirect.js's reloadPage is counted. A
   change another tab makes to localStorage reaches this one only as a
   `storage` event, which is what the R4C-4 tests dispatch. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { HELD_BACK_WAIT_MS } from "../../src/ha/heldBack.js";

const HA = "https://ha.example.invalid";
const SPOTIFY_KEY = "gh_spotify_token";
const ERROR_LOG_KEY = "gh_error_log";

const lib = vi.hoisted(() => ({ ha: null, reloads: 0, calendar: null }));

vi.mock("home-assistant-js-websocket", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createConnection: (options) => real.createConnection({ ...options, createSocket: async () => lib.ha.open() }),
  };
});
vi.mock("../../src/ha/loginRedirect.js", async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: () => {
    lib.reloads++;
  },
}));
// The calendar cards' events come over REST, not the socket; what matters
// here is which calendars the socket says exist.
vi.mock("../../src/ha/useCalendarEvents.js", () => ({
  useCalendarEvents: (ids) => ({ events: [], loading: false, error: null, failedIds: [], refresh: () => {}, ...lib.calendar?.(ids) }),
}));

/* A stand-in Home Assistant speaking subscribe_entities (see
   round4-socket.test.jsx), with attributes: initial values are a state
   string or { s, a }. */
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
  /* One entity added, as HA forwards it once its integration has loaded. */
  ha.add = (id, v) => {
    ha.entities[id] = compressed(v);
    for (const sub of ha.live) {
      if (sub.sock.readyState === 1) sub.sock.deliver({ id: sub.id, type: "event", event: { a: { [id]: ha.entities[id] } } });
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
  expires: Date.now() + 3600_000,
  expires_in: 1800,
};
const storeTokens = (overrides = {}) => localStorage.setItem("ha_tokens", JSON.stringify({ ...SESSION, ...overrides }));
const storeSpotify = () =>
  localStorage.setItem(SPOTIFY_KEY, JSON.stringify({ access_token: "SPOT", refresh_token: "SPOTREF", expires_at: Date.now() + 3600_000 }));

let added = [];

async function loadPage() {
  vi.resetModules();
  const winSpy = vi.spyOn(window, "addEventListener");
  const docSpy = vi.spyOn(document, "addEventListener");
  const socket = await import("../../src/ha/socket.js");
  const hooks = await import("../../src/ha/useEntity.js");
  const errorLog = await import("../../src/lib/errorLog.js");
  added.push(...winSpy.mock.calls.map(([t, h]) => [window, t, h]));
  added.push(...docSpy.mock.calls.map(([t, h]) => [document, t, h]));
  winSpy.mockRestore();
  docSpy.mockRestore();
  return { socket, hooks, errorLog };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
const reconnect = () => act(() => vi.advanceTimersByTimeAsync(0));

/* Connected and answered: the page has seen HA's whole set once. */
async function connected(initial) {
  vi.useFakeTimers();
  storeTokens();
  lib.ha = fakeHa(initial);
  const page = await loadPage();
  await flush();
  act(() => lib.ha.answer());
  return page;
}

/* Restart HA: back on a new connection, its first answer without `ids` —
   their integrations haven't loaded yet. */
async function restartWithout(...ids) {
  for (const id of ids) delete lib.ha.entities[id];
  act(() => lib.ha.drop());
  await reconnect();
  act(() => lib.ha.answer());
}

beforeEach(() => {
  vi.stubEnv("VITE_HA_URL", HA);
  sessionStorage.clear();
  localStorage.clear();
  lib.ha = fakeHa();
  lib.reloads = 0;
  lib.calendar = null;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
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

const meta = (container) => container.querySelector(".meta")?.textContent;
const cal = (name) => ({ s: "off", a: { friendly_name: name, supported_features: 1 } });

describe("R4C-1 — a reader of a whole domain or set knows what HA may still be loading", () => {
  it("the hooks: listed while held back, gone once HA sends it or the wait runs out", async () => {
    const { hooks } = await connected({
      "calendar.work": "off",
      "calendar.home": "off",
      "update.core": "on",
      "light.a": "on",
    });
    const seen = {};
    function Probe() {
      seen.calendars = hooks.useEntitiesByDomain("calendar");
      seen.loading = hooks.useLoadingIds(["calendar.work", "light.a", "update.core"]);
      seen.counts = hooks.useEntityCounts();
      return null;
    }
    render(<Probe />);
    expect(seen.calendars.loadingIds).toEqual([]);
    expect(seen.counts).toMatchObject({ total: 4, loading: 0 });

    await restartWithout("calendar.work", "update.core");
    expect(seen.calendars.map((e) => e.entity_id)).toEqual(["calendar.home"]);
    expect(seen.calendars.loadingIds).toEqual(["calendar.work"]);
    expect(seen.loading).toEqual(["calendar.work", "update.core"]);
    // The chip adds them back: 4 in all, not 2.
    expect(seen.counts).toMatchObject({ available: 2, total: 2, loading: 2 });

    const before = seen.loading;
    act(() => lib.ha.add("light.b", "on")); // an unrelated batch
    expect(seen.loading).toBe(before); // same contents, same array

    act(() => lib.ha.add("calendar.work", "off"));
    expect(seen.calendars.loadingIds).toEqual([]);
    expect(seen.loading).toEqual(["update.core"]);

    // Never sent: after the wait it is gone, not loading.
    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS));
    expect(seen.loading).toEqual([]);
    expect(seen.counts).toMatchObject({ total: 4, loading: 0 });
  });

  it("the topbar chip: its total keeps what HA may still be loading", async () => {
    await connected({ "light.a": "on", "light.b": "off", "calendar.work": "off" });
    const { ConnectionChip } = await import("../../src/App.jsx");
    const { container } = render(<ConnectionChip />);
    const chip = () => container.querySelector(".chip").textContent;
    expect(chip()).toBe("Pi · 3/3 live");

    await restartWithout("calendar.work");
    expect(chip()).toBe("Pi · 2/3 live");
    act(() => lib.ha.add("calendar.work", "off"));
    expect(chip()).toBe("Pi · 3/3 live");
  });

  it("the week: 'Loading this week…', not 'No calendars', while its only calendar is held back", async () => {
    await connected({ "calendar.work": cal("Work"), "light.a": "on" });
    const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");
    const { container } = render(<WeeklyCalendarCard />);
    expect(meta(container)).toBe("no events");

    await restartWithout("calendar.work");
    expect(container.textContent).not.toMatch(/No calendars/);
    expect(screen.getByText("Loading this week…")).toBeInTheDocument();

    act(() => lib.ha.add("calendar.work", cal("Work")));
    expect(meta(container)).toBe("no events");

    // Deleted while the page was away: once the wait is over it says so.
    await restartWithout("calendar.work");
    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS));
    expect(meta(container)).toBe("no calendars");
  });

  it("the week: another calendar's events don't read as the whole week, nor its silence as 'no events'", async () => {
    await connected({ "calendar.work": cal("Work"), "calendar.home": cal("Home") });
    const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");
    const { container } = render(<WeeklyCalendarCard />);
    await restartWithout("calendar.work");
    expect(meta(container)).toBe("loading…");

    const now = new Date();
    const at = (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString();
    lib.calendar = (ids) => ({
      events: ids.includes("calendar.home")
        ? [{ uid: "gym", summary: "Gym", cal_entity_id: "calendar.home", start: { dateTime: at(10) }, end: { dateTime: at(11) } }]
        : [],
    });
    act(() => lib.ha.add("light.a", "on")); // any batch re-renders it with the events
    expect(meta(container)).toBe("1 events · some calendars loading");
  });

  it("the new-event dialog: a calendar HA hasn't sent back yet is '(loading…)', not '(not found)'", async () => {
    await connected({ "calendar.work": cal("Work"), "calendar.home": cal("Home") });
    const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");
    render(<WeeklyCalendarCard />);
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "calendar.work" } });
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Dentist" } });

    await restartWithout("calendar.work");
    const select = screen.getByLabelText("Calendar");
    expect(select).toHaveValue("calendar.work");
    expect(within(select).getByRole("option", { name: "Work (loading…)" })).toBeDisabled();
    await act(async () => {
      fireEvent.submit(select.closest("form"));
    });
    expect(screen.getByText("Work hasn't loaded yet. Try again in a moment, or pick another calendar.")).toBeInTheDocument();
    expect(screen.queryByText(/no longer in Home Assistant/)).toBeNull();

    // Never comes back: past the wait it is "(not found)" after all.
    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS));
    expect(within(select).getByRole("option", { name: "Work (not found)" })).toBeDisabled();
  });

  it("the new-event dialog: with only a read-only calendar back so far, it says 'still loading', not 'no calendar can'", async () => {
    const readOnly = { s: "off", a: { friendly_name: "Holidays", supported_features: 0 } };
    await connected({ "calendar.holidays": readOnly, "calendar.work": cal("Work") });
    const { WeeklyCalendarCard } = await import("../../src/cards/schedule/WeeklyCalendarCard.jsx");
    render(<WeeklyCalendarCard />);
    await restartWithout("calendar.work");
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    const select = screen.getByLabelText("Calendar");
    expect(within(select).getByRole("option", { name: "Still loading calendars…" })).toBeDisabled();
    expect(within(select).queryByRole("option", { name: "No calendar can take new events" })).toBeNull();

    // Back: it becomes the default, as it would have been at open.
    act(() => lib.ha.add("calendar.work", cal("Work")));
    expect(select).toHaveValue("calendar.work");
  });

  it("next event: 'Loading events…', not 'No calendars are exposed', while its calendars are held back", async () => {
    await connected({ "calendar.work": cal("Work") });
    const { NextEventCard } = await import("../../src/cards/overview/NextEventCard.jsx");
    const { container } = render(<NextEventCard />);
    expect(container.textContent).toMatch(/Nothing scheduled this week/);

    await restartWithout("calendar.work");
    expect(container.textContent).not.toMatch(/No calendars|Nothing scheduled/);
    expect(screen.getByText("Loading events…")).toBeInTheDocument();
    expect(meta(container)).toBe("loading");
  });

  it("updates: no '✓ current' or 'All up to date' while a pending update.* is held back", async () => {
    const upd = (title, s) => ({ s, a: { title, installed_version: "1.0", latest_version: s === "on" ? "1.1" : "1.0" } });
    await connected({ "update.esphome": upd("ESPHome", "on"), "update.tailscale": upd("Tailscale", "off") });
    const { AddonsCard } = await import("../../src/cards/system/AddonsCard.jsx");
    const { container } = render(<AddonsCard />);
    expect(screen.getByRole("heading")).toHaveTextContent("1 update available");

    await restartWithout("update.esphome");
    expect(meta(container)).toBeUndefined();
    expect(container.textContent).not.toMatch(/✓ current|All up to date|All \d+ tracked/);
    expect(screen.getByRole("heading")).toHaveTextContent("Can't tell yet");
    expect(screen.getByText("1 tracked component is at the latest version.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for 1 more from Home Assistant…")).toBeInTheDocument();

    act(() => lib.ha.add("update.esphome", upd("ESPHome", "on")));
    expect(screen.getByRole("heading")).toHaveTextContent("1 update available");
    expect(screen.queryByText(/Waiting for 1 more/)).toBeNull();
  });

  /* R4D-1: the System tab's registry count. Held-back entities are left out
     of getAllStates(), so it read "All entities available" after a restart —
     and a device unavailable before it simply dropped off the list. */
  it("entity health: 'Waiting for N more', not 'All entities available', while entities are held back", async () => {
    await connected({ "light.a": "on", "light.b": "unavailable" });
    const { EntityHealthCard } = await import("../../src/cards/system/EntityHealthCard.jsx");
    const { container } = render(<EntityHealthCard />);
    expect(container.textContent).toMatch(/1 online · 1 unavailable/);

    await restartWithout("light.b");
    expect(container.textContent).not.toMatch(/All entities available/);
    expect(screen.getByText("Waiting for 1 more entity from Home Assistant…")).toBeInTheDocument();
    expect(container.textContent).toMatch(/1 loading/);

    act(() => lib.ha.add("light.b", "unavailable"));
    expect(container.textContent).toMatch(/1 online · 1 unavailable/);
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });

  /* D2 (round 4d): back on a new connection, before HA's first batch, the
     cache is the pre-drop set — and Updates read it as "All up to date". */
  it("updates: between the reconnect and HA's first batch, nothing cached reads as current", async () => {
    const upd = (title, s) => ({ s, a: { title, installed_version: "1.0", latest_version: s === "on" ? "1.1" : "1.0" } });
    await connected({ "update.esphome": upd("ESPHome", "off"), "update.tailscale": upd("Tailscale", "off") });
    const { AddonsCard } = await import("../../src/cards/system/AddonsCard.jsx");
    const { container } = render(<AddonsCard />);
    expect(screen.getByRole("heading")).toHaveTextContent("All up to date");

    act(() => lib.ha.drop());
    lib.ha.entities["update.esphome"] = { s: "on", a: { title: "ESPHome", installed_version: "1.0", latest_version: "1.1" }, lc: 1 };
    await reconnect(); // "ready", HA's answer not in yet
    expect(container.textContent).not.toMatch(/✓ current|All up to date|are at the latest version|Not connected/);
    expect(screen.getByRole("heading")).toHaveTextContent("Can't tell yet");

    act(() => lib.ha.answer());
    expect(screen.getByRole("heading")).toHaveTextContent("1 update available");
    expect(within(container).getByRole("button", { name: "Install" })).not.toHaveAttribute("aria-disabled");
  });

  it("scenes: a held-back device is 'loading' — neither 'offline' nor all clear — and the header speaks for the whole set", async () => {
    const BULB = "light.smartbulb_5c_h";
    const deps = {
      [BULB]: "on",
      "light.smart_humidifier_2403124281557464110148e1e9eff28f": "on",
      "light.smart_humidifier_2403124281557464110148e1e9eff28f_dnd": "on",
      "select.smart_humidifier_2403124281557464110148e1e9eff28f_spray": "low",
      "light.x1c_00m09d522400385_chamber_light": "on",
      "switch.x1c_00m09d522400385_camera": "on",
      "switch.sambox360_plug": "on",
      "light.divoom_pixoo_64_light": "on",
      "fan.core_300s_series": "on",
    };
    await connected({ ...deps, "script.gh_work_done": "off" });
    const { ScenesCard } = await import("../../src/cards/overview/ScenesCard.jsx");
    const { container } = render(<ScenesCard />);
    const workDone = () => container.querySelector(".scene.work_done .scene-sub").textContent;
    expect(workDone()).toBe("Colour flow");
    expect(meta(container)).toBe("Idle");

    // The bulb's integration is slow to load (and the bulb is the first dep,
    // the header's old stand-in for the whole set). Round 4d (D3): this read
    // "Colour flow" / "Idle" for the whole wait, as if every device were up.
    await restartWithout(BULB);
    expect(workDone()).toBe("1/2 loading");
    expect(container.querySelector(".scene.work_done")).not.toHaveClass("degraded");
    expect(container.querySelector(".scene.work_done")).toHaveAccessibleName("Work Done! — 1 of 2 devices loading: Bedroom bulb");
    expect(meta(container)).toBe("1 device loading");

    // Sent back: all clear again.
    act(() => lib.ha.add(BULB, "on"));
    expect(workDone()).toBe("Colour flow");
    expect(meta(container)).toBe("Idle");

    // Never sent this time: once the wait is over it is offline.
    await restartWithout(BULB);
    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS));
    expect(workDone()).toBe("1/2 offline");
    expect(meta(container)).toBe("1 device offline");
  });
});

describe("R4C-5 — after Sign out closes the socket, nothing reads 'ready'", () => {
  it("the status goes 'disconnected' and the snapshot with it, for the whole revoke wait", async () => {
    const { socket, hooks } = await connected({ "light.a": "on" });
    function Probe() {
      const { entity, status } = hooks.useEntityStatus("light.a");
      return <output>{`${status}:${entity?.state ?? "-"}`}</output>;
    }
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("ready:on");

    fetch.mockImplementation(() => new Promise(() => {})); // /auth/revoke hangs
    act(() => {
      socket.signOut();
    });
    expect(socket.getConnectionStatus()).toBe("disconnected");
    expect(socket.hasSnapshot()).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(/^loading:/);
    await act(() => vi.advanceTimersByTimeAsync(2999));
    expect(screen.getByRole("status")).toHaveTextContent(/^loading:/);
    expect(lib.reloads).toBe(0);
  });

  it("the chip says 'Signing out…' meanwhile, not 'Pi offline' — the Pi is fine", async () => {
    const { socket } = await connected({ "light.a": "on" });
    const { ConnectionChip } = await import("../../src/App.jsx");
    const { container } = render(<ConnectionChip />);
    expect(container.querySelector(".chip")).toHaveTextContent("Pi · 1/1 live");

    fetch.mockImplementation(() => new Promise(() => {})); // /auth/revoke hangs
    act(() => {
      socket.signOut();
    });
    expect(container.querySelector(".chip")).toHaveTextContent("Signing out…");
    expect(container.textContent).not.toMatch(/Pi offline|live/);
  });
});

describe("R4C-4 — Sign out in another tab signs this one out too", () => {
  /* What the other tab's signOut() does to the shared storage, and the one
     event this tab hears of it. */
  function signOutElsewhere() {
    localStorage.setItem("gh_signed_out_at", String(Date.now())); // session.js#clearDevice marks a Sign out first
    localStorage.removeItem("ha_tokens");
    localStorage.removeItem(SPOTIFY_KEY);
    localStorage.removeItem(ERROR_LOG_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", oldValue: JSON.stringify(SESSION), newValue: null }));
  }

  async function signedInHere() {
    storeSpotify();
    const page = await connected({ "light.a": "on" });
    page.errorLog.logError({ source: "service", message: "light.turn_on failed", detail: "light.a" });
    expect(localStorage.getItem(ERROR_LOG_KEY)).not.toBeNull();
    return page;
  }

  it("latches, clears and reloads: its socket closes and nothing reads 'ready'", async () => {
    const { socket, errorLog } = await signedInHere();
    act(() => signOutElsewhere());
    expect(lib.reloads).toBe(1);
    expect(lib.ha.sockets.at(-1).readyState).toBe(3);
    expect(socket.getConnectionStatus()).toBe("disconnected");
    expect(socket.hasSnapshot()).toBe(false);
    expect(errorLog.getEntries()).toEqual([]);
    // Nothing reconnects in the meantime.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(lib.ha.sockets).toHaveLength(1);
  });

  it("its error log isn't written back by its next entry", async () => {
    const { errorLog } = await signedInHere();
    act(() => signOutElsewhere());
    // HA closing this tab's socket on the revoke, a call that fails meanwhile…
    errorLog.logError({ source: "connection", message: "Home Assistant WebSocket disconnected" });
    expect(localStorage.getItem(ERROR_LOG_KEY)).toBeNull();
    expect(errorLog.getEntries()).toEqual([]);
  });

  it("a token refresh it had in flight can't write the session back", async () => {
    const { socket } = await signedInHere();
    let answerRefresh;
    fetch.mockImplementation((url) =>
      String(url).endsWith("/auth/token") ? new Promise((resolve) => (answerRefresh = resolve)) : new Promise(() => {}),
    );
    vi.setSystemTime(Date.now() + 2 * 3600_000); // its access token has expired
    const pending = socket.getFreshAccessToken();
    await flush();
    act(() => signOutElsewhere());
    answerRefresh({ ok: true, status: 200, json: async () => ({ access_token: "fresh", expires_in: 1800, token_type: "Bearer" }) });
    await pending.catch(() => {});
    await flush();
    expect(localStorage.getItem("ha_tokens")).toBeNull();
  });

  it("a Spotify refresh it had in flight can't write the token back", async () => {
    await signedInHere();
    const spotify = await import("../../src/ha/spotify.js");
    localStorage.setItem(SPOTIFY_KEY, JSON.stringify({ access_token: "SPOT", refresh_token: "SPOTREF", expires_at: Date.now() - 1 }));
    let answerRefresh = null;
    fetch.mockImplementation((url) =>
      String(url).startsWith("https://accounts.spotify.com/")
        ? new Promise((resolve) => (answerRefresh = resolve))
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
    );
    const search = spotify.searchTracks("abba").then(() => "answered", () => "refused");
    await flush();
    expect(answerRefresh).toBeTypeOf("function");
    act(() => signOutElsewhere());
    answerRefresh({ ok: true, status: 200, json: async () => ({ access_token: "NEW", refresh_token: "NEWREF", expires_in: 3600 }) });
    await flush();
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
    expect(await search).toBe("refused");
  });

  it("its own session, written back before the event arrived, goes; a newer one is left alone", async () => {
    await signedInHere();
    storeTokens({ access_token: "refreshed-here" }); // this tab's refresh landed first
    act(() => signOutElsewhere());
    expect(localStorage.getItem("ha_tokens")).toBeNull();

    // A frozen background tab hearing of it late, after someone signed in again.
    await signedInHere();
    localStorage.removeItem("ha_tokens");
    storeTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", newValue: null })));
    expect(lib.reloads).toBe(2);
    expect(JSON.parse(localStorage.getItem("ha_tokens")).refresh_token).toBe("guest-refresh");
  });

  /* dropSession in another tab — HA ended the session (revoked, lapsed), nobody
     signed out — removes the tokens too. That tab logged "session expired";
     wiping the log here would erase the only record of why (R4D-2). */
  it("a session HA ended in another tab: this one stops too, but the error log is kept", async () => {
    const { errorLog } = await signedInHere();
    errorLog.logError({ source: "connection", message: "Home Assistant session expired" });
    act(() => {
      localStorage.removeItem("ha_tokens");
      window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", oldValue: JSON.stringify(SESSION), newValue: null }));
    });
    expect(lib.reloads).toBe(1);
    expect(errorLog.getEntries().map((e) => e.message)).toContain("Home Assistant session expired");
    expect(localStorage.getItem(ERROR_LOG_KEY)).toContain("session expired");
  });

  it("an old Sign out marker doesn't turn a later dropped session into a Sign out", async () => {
    const { errorLog } = await signedInHere();
    localStorage.setItem("gh_signed_out_at", String(Date.now() - 10 * 60_000));
    act(() => {
      localStorage.removeItem("ha_tokens");
      window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", oldValue: JSON.stringify(SESSION), newValue: null }));
    });
    expect(errorLog.getEntries().length).toBeGreaterThan(0);
  });

  it("localStorage cleared in another tab counts too", async () => {
    await signedInHere();
    localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null })));
    expect(lib.reloads).toBe(1);
  });

  it("anything else changing in storage is left alone", async () => {
    const { socket } = await signedInHere();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", newValue: JSON.stringify(SESSION) })));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: SPOTIFY_KEY, newValue: null })));
    expect(lib.reloads).toBe(0);
    expect(socket.getConnectionStatus()).toBe("ready");
  });

  // A Sign out elsewhere is another matter: round4d-session.test.jsx, D8.
  it("a tab already signed out ('Signed out · sign in') has nothing to end when HA ends a session elsewhere", async () => {
    sessionStorage.setItem("gh_ha_login_redirect_at", String(Date.now() - 10_000));
    const { socket } = await loadPage(); // no tokens, and the trip to login used up
    await flush();
    expect(socket.isSessionExpired()).toBe(true);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", newValue: null })));
    expect(lib.reloads).toBe(0);
  });
});
