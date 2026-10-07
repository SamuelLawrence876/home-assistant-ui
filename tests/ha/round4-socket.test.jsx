/* Round 4 (2026-10-06 sweep) — the shared HA connection.

   fix-rounds#1 — after a drop, an entity Home Assistant hadn't sent again on
                  the new connection kept its pre-drop state and read "ready":
                  a restarting HA's not-yet-loaded vacuum showed "cleaning"
                  with live controls, and an entity deleted while the page was
                  away never became "not_found".
   round 4b C3  — the fix above made that held-back entity "not_found" at
                  once, so Restart HA put "<id> not found" across the
                  dashboard for the minutes a Pi takes to load. It is
                  "loading" now, for HELD_BACK_WAIT_MS, then "not_found".
   round 4b C4  — a Spotify refresh, or an error logged, landing after Sign
                  out's last clear and before the reload wrote itself back.
   lifecycle#1  — Sign out waited on /auth/revoke, with no timeout, before
                  clearing anything on the device.
   security#1   — a session HA declared dead (revoked or lapsed refresh token)
                  left Sam's Spotify token working on the device.
   lifecycle#3  — Back from HA's login page restored the page from the
                  back/forward cache, stuck on "connecting" for good.

   Unlike socket-lifecycle.test.js, the library's own Connection, collection
   and entity store run here; only the WebSocket is fake, answered by a
   stand-in HA that speaks subscribe_entities. That is the point: the first
   bug lived in how the library merges a reconnect's answer into its old
   store. jsdom can't reload, so loginRedirect.js's reloadPage is counted. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HELD_BACK_WAIT_MS } from "../../src/ha/heldBack.js";

const HA = "https://ha.example.invalid";
const REDIRECT_KEY = "gh_ha_login_redirect_at";
const SPOTIFY_KEY = "gh_spotify_token";
const ERR_CANNOT_CONNECT = 1;
const ERR_INVALID_AUTH = 2;

const lib = vi.hoisted(() => ({ ha: null, refuse: null, reloads: 0 }));

vi.mock("home-assistant-js-websocket", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    // The real createConnection and Connection — including the library's
    // own reconnect and resubscribe — over a fake socket.
    createConnection: (options) =>
      real.createConnection({
        ...options,
        createSocket: async () => {
          if (lib.refuse) throw lib.refuse;
          return lib.ha.open();
        },
      }),
  };
});
vi.mock("../../src/ha/loginRedirect.js", async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: () => {
    lib.reloads++;
  },
}));

/* A stand-in Home Assistant. Entities are kept in the compressed form
   subscribe_entities sends ({ s, a, lc }). Every subscribe_entities waits for
   answer(), which sends HA's complete current set, as HA does. */
function fakeHa(initial = {}) {
  const ha = { entities: {}, sockets: [], waiting: [], live: [] };
  const emit = (sock, type, ev) => (sock.listeners[type] || []).slice().forEach((cb) => cb(ev));
  const lc = () => Math.floor(Date.now() / 1000);
  for (const [id, s] of Object.entries(initial)) ha.entities[id] = { s, a: {}, lc: lc() };

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
  /* One entity added or changed, as HA forwards a state_changed. */
  ha.set = (id, s) => {
    const added = !(id in ha.entities);
    ha.entities[id] = { s, a: {}, lc: lc() };
    const event = added ? { a: { [id]: ha.entities[id] } } : { c: { [id]: { "+": { s, lc: lc() } } } };
    for (const sub of ha.live) if (sub.sock.readyState === 1) sub.sock.deliver({ id: sub.id, type: "event", event });
  };
  /* One entity removed while connected, as HA forwards it. */
  ha.remove = (id) => {
    delete ha.entities[id];
    for (const sub of ha.live) if (sub.sock.readyState === 1) sub.sock.deliver({ id: sub.id, type: "event", event: { r: [id] } });
  };
  /* HA goes away (a restart, a Funnel blip): the socket closes from its end. */
  ha.drop = () => {
    ha.live = [];
    ha.sockets.at(-1).close();
  };
  return ha;
}

function storeTokens(overrides = {}) {
  localStorage.setItem(
    "ha_tokens",
    JSON.stringify({
      hassUrl: HA,
      clientId: "http://localhost:3000/",
      access_token: "stored-access",
      refresh_token: "stored-refresh",
      expires: Date.now() + 3600_000,
      expires_in: 1800,
      ...overrides,
    }),
  );
}
const storeSpotify = () =>
  localStorage.setItem(SPOTIFY_KEY, JSON.stringify({ access_token: "SPOT", refresh_token: "SPOTREF", expires_at: Date.now() + 3600_000 }));

/* Handlers socket.js puts on window/document, removed after each test so an
   old module instance can't answer the next test's events. */
let added = [];
let testStart = 0;

async function loadPage() {
  vi.resetModules();
  const winSpy = vi.spyOn(window, "addEventListener");
  const docSpy = vi.spyOn(document, "addEventListener");
  const socket = await import("../../src/ha/socket.js");
  const { useEntityStatus } = await import("../../src/ha/useEntity.js");
  const errorLog = await import("../../src/lib/errorLog.js");
  added.push(...winSpy.mock.calls.map(([t, h]) => [window, t, h]));
  added.push(...docSpy.mock.calls.map(([t, h]) => [document, t, h]));
  winSpy.mockRestore();
  docSpy.mockRestore();
  return { socket, useEntityStatus, errorLog };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
/* The library waits a tick before its first reconnect attempt. */
const reconnect = () => act(() => vi.advanceTimersByTimeAsync(0));
const redirected = () => {
  const at = Number(sessionStorage.getItem(REDIRECT_KEY));
  return at >= testStart && at <= Date.now();
};

function probes(useEntityStatus, ids) {
  function Probe({ id }) {
    const { entity, status } = useEntityStatus(id);
    return <output data-testid={id}>{`${status}:${entity?.state ?? "-"}`}</output>;
  }
  render(ids.map((id) => <Probe key={id} id={id} />));
  return (id) => screen.getByTestId(id).textContent;
}

beforeEach(() => {
  vi.stubEnv("VITE_HA_URL", HA);
  sessionStorage.clear();
  lib.ha = fakeHa();
  lib.refuse = null;
  lib.reloads = 0;
  // /auth/token and anything else: 400 (a dead refresh token) unless a test says otherwise.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  testStart = Date.now();
});

afterEach(() => {
  for (const [target, type, handler] of added) target.removeEventListener(type, handler);
  added = [];
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("fix-rounds#1 — 'ready' means HA sent it on this connection", () => {
  async function connected(initial) {
    vi.useFakeTimers();
    storeTokens();
    lib.ha = fakeHa(initial);
    const page = await loadPage();
    await flush();
    return page;
  }

  it("an entity a restarted HA hasn't loaded yet is not 'ready' with its pre-restart state", async () => {
    const { socket, useEntityStatus } = await connected({ "light.a": "on", "vacuum.v": "cleaning" });
    const text = probes(useEntityStatus, ["vacuum.v", "light.a", "light.never"]);
    act(() => lib.ha.answer());
    expect(text("vacuum.v")).toBe("ready:cleaning");
    expect(text("light.never")).toBe("not_found:-");

    // Restart HA. Its websocket is back long before the vacuum's integration.
    delete lib.ha.entities["vacuum.v"];
    act(() => lib.ha.drop());
    expect(text("vacuum.v")).toBe("loading:cleaning");
    await reconnect();
    expect(socket.getConnectionStatus()).toBe("ready");
    expect(socket.hasSnapshot()).toBe(false);
    // Back, but HA hasn't answered the resubscribe: nothing is "ready" yet.
    expect(text("vacuum.v")).toBe("loading:cleaning");
    expect(text("light.a")).toBe("loading:on");

    act(() => lib.ha.answer()); // HA's complete set, without the vacuum
    // Its pre-restart state is not live any more — but HA may just not have
    // loaded it yet, so it is "loading", not "not found" (C3).
    expect(text("vacuum.v")).toBe("loading:-");
    expect(socket.getEntity("vacuum.v")).toBeUndefined();
    expect(socket.getAllStates().map((s) => s.entity_id)).toEqual(["light.a"]);
    // What HA did send is live at once: no loading past the resubscribe.
    expect(text("light.a")).toBe("ready:on");
    // Only a held-back copy waits: never on this page is still "not found".
    expect(text("light.never")).toBe("not_found:-");
  });

  it("the library's leftover copy stays out through later batches and drops, until HA sends it", async () => {
    const { useEntityStatus } = await connected({ "light.a": "on", "vacuum.v": "cleaning" });
    const text = probes(useEntityStatus, ["vacuum.v", "light.a"]);
    act(() => lib.ha.answer());
    delete lib.ha.entities["vacuum.v"];
    act(() => lib.ha.drop());
    await reconnect();
    act(() => lib.ha.answer());

    // An unrelated change: the library hands over its whole store again,
    // still holding the pre-restart vacuum.
    act(() => lib.ha.set("light.a", "off"));
    expect(text("light.a")).toBe("ready:off");
    expect(text("vacuum.v")).toBe("loading:-");

    // Another blip before it loads.
    act(() => lib.ha.drop());
    await reconnect();
    act(() => lib.ha.answer());
    expect(text("vacuum.v")).toBe("loading:-");

    // The integration loads: HA adds it, with its real state.
    act(() => lib.ha.set("vacuum.v", "docked"));
    expect(text("vacuum.v")).toBe("ready:docked");
  });

  it("still missing HELD_BACK_WAIT_MS after it was first held back, it is 'not_found' — a reconnect doesn't restart the clock", async () => {
    const { socket, useEntityStatus } = await connected({ "light.a": "on", "vacuum.v": "cleaning" });
    const text = probes(useEntityStatus, ["vacuum.v"]);
    act(() => lib.ha.answer());
    delete lib.ha.entities["vacuum.v"]; // deleted while the page was away
    act(() => lib.ha.drop());
    await reconnect();
    act(() => lib.ha.answer());
    expect(text("vacuum.v")).toBe("loading:-");
    expect(socket.hasSnapshot("vacuum.v")).toBe(false); // held back, still waiting

    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS - 60_000));
    expect(text("vacuum.v")).toBe("loading:-");
    act(() => lib.ha.drop());
    await reconnect();
    act(() => lib.ha.answer());
    expect(text("vacuum.v")).toBe("loading:-");

    // No batch needed: the hold runs out on its own.
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(text("vacuum.v")).toBe("loading:-");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(text("vacuum.v")).toBe("not_found:-");
    expect(socket.getEntity("vacuum.v")).toBeUndefined();
    expect(socket.hasSnapshot("vacuum.v")).toBe(true);

    // A later batch doesn't bring the stale copy back…
    act(() => lib.ha.set("light.a", "off"));
    expect(text("vacuum.v")).toBe("not_found:-");
    // …nor does another reconnect start a new wait…
    act(() => lib.ha.drop());
    await reconnect();
    act(() => lib.ha.answer());
    expect(text("vacuum.v")).toBe("not_found:-");
    // …and if HA does send it after all, it is live.
    act(() => lib.ha.set("vacuum.v", "docked"));
    expect(text("vacuum.v")).toBe("ready:docked");
  });

  it("sent again and then missing after a second restart, it waits from the second restart", async () => {
    const { useEntityStatus } = await connected({ "light.a": "on", "vacuum.v": "cleaning" });
    const text = probes(useEntityStatus, ["vacuum.v"]);
    act(() => lib.ha.answer());
    const restartWithoutVacuum = async () => {
      delete lib.ha.entities["vacuum.v"];
      act(() => lib.ha.drop());
      await reconnect();
      act(() => lib.ha.answer());
    };

    await restartWithoutVacuum(); // first wait starts
    expect(text("vacuum.v")).toBe("loading:-");
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    act(() => lib.ha.set("vacuum.v", "docked")); // loaded
    expect(text("vacuum.v")).toBe("ready:docked");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await restartWithoutVacuum(); // second wait starts, 3 minutes after the first

    // The first wait's timer runs out: not this one's business any more.
    await act(() => vi.advanceTimersByTimeAsync(HELD_BACK_WAIT_MS - 3 * 60_000));
    expect(text("vacuum.v")).toBe("loading:-");
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(text("vacuum.v")).toBe("not_found:-");
  });

  it("an entity HA removes while connected is 'not_found' at once — nothing is held back", async () => {
    const { useEntityStatus } = await connected({ "light.a": "on", "update.gone": "on" });
    const text = probes(useEntityStatus, ["update.gone"]);
    act(() => lib.ha.answer());
    expect(text("update.gone")).toBe("ready:on");
    act(() => lib.ha.remove("update.gone"));
    expect(text("update.gone")).toBe("not_found:-");
  });

  it("a plain blip: everything HA re-sends is ready again straight after its answer", async () => {
    const { useEntityStatus } = await connected({ "light.a": "on", "switch.b": "off" });
    const text = probes(useEntityStatus, ["light.a", "switch.b"]);
    act(() => lib.ha.answer());
    act(() => lib.ha.drop());
    await reconnect();
    expect(text("light.a")).toBe("loading:on");
    act(() => lib.ha.answer());
    expect(text("light.a")).toBe("ready:on");
    expect(text("switch.b")).toBe("ready:off");
  });

  /* useReconnectNotice reads the same cache to verify a restart, by object
     identity. With the real library and socket underneath, it must still say
     "checking" — not "didn't restart" — while HA hasn't loaded sensor.uptime,
     and clear once a new start time arrives. */
  describe("restart verification on top of it", () => {
    const T0 = "2026-10-01T08:00:00+00:00";
    const RESTART = {
      kind: "restart",
      logAs: "homeassistant.restart",
      label: "Restart HA",
      text: "Restarting…",
      checkText: "Reconnected — checking…",
      failText: "Didn't restart.",
      unsureText: "Couldn't confirm.",
    };
    async function restart() {
      vi.setSystemTime(Date.parse("2026-10-06T12:00:00Z"));
      const page = await connected({ "light.a": "on", "sensor.uptime": T0 });
      act(() => lib.ha.answer());
      const notice = await import("../../src/cards/system/useReconnectNotice.js");
      const go = notice.prepareNotice("t", "k", RESTART);
      act(() => go(undefined));
      return { ...page, notice };
    }
    const noticeText = (notice) => {
      let out;
      function N() {
        out = notice.useReconnectNotice("t");
        return null;
      }
      render(<N />);
      return () => out;
    };
    const failures = (errorLog) => errorLog.getEntries().filter((e) => e.source === "service");

    it("a first batch without sensor.uptime is 'checking', then the new start time clears it", async () => {
      const { notice, errorLog } = await restart();
      const current = noticeText(notice);
      delete lib.ha.entities["sensor.uptime"];
      act(() => lib.ha.drop());
      await reconnect();
      act(() => lib.ha.answer());
      await act(() => vi.advanceTimersByTimeAsync(notice.RESTART_GRACE_MS + 60_000));
      expect(current().message).toBe(RESTART.checkText);
      expect(failures(errorLog)).toEqual([]);
      act(() => lib.ha.set("sensor.uptime", "2026-10-06T12:00:20+00:00"));
      expect(current()).toBeNull();
      notice.clearNotices();
    });

    it("sensor.uptime still missing once its hold runs out: 'couldn't confirm', never 'didn't restart'", async () => {
      const { socket, notice, errorLog } = await restart();
      const current = noticeText(notice);
      delete lib.ha.entities["sensor.uptime"];
      act(() => lib.ha.drop());
      await reconnect();
      act(() => lib.ha.answer());
      expect(socket.hasSnapshot("sensor.uptime")).toBe(false); // held back, still waiting
      // Past both VERIFY_WAIT_MS and the hold (5 minutes each), short of OUTCOME_MS.
      await act(() => vi.advanceTimersByTimeAsync(6 * 60_000));
      expect(socket.hasSnapshot("sensor.uptime")).toBe(true);
      expect(current().message).toBe(RESTART.unsureText);
      expect(failures(errorLog)).toEqual([]);
      notice.clearNotices();
    });

    it("a blip to the same HA, which re-sends the old start time, is 'didn't restart'", async () => {
      const { notice, errorLog } = await restart();
      const current = noticeText(notice);
      act(() => lib.ha.drop());
      await reconnect();
      act(() => lib.ha.answer());
      await act(() => vi.advanceTimersByTimeAsync(notice.RESTART_GRACE_MS));
      expect(current().message).toBe(RESTART.failText);
      expect(failures(errorLog)).toHaveLength(1);
      notice.clearNotices();
    });
  });
});

describe("lifecycle#1 — Sign out clears the device first, and doesn't wait long for HA", () => {
  async function signedIn() {
    vi.useFakeTimers();
    storeTokens();
    storeSpotify();
    const page = await loadPage();
    await flush();
    act(() => lib.ha.answer());
    expect(page.socket.getConnectionStatus()).toBe("ready");
    page.errorLog.logError({ source: "service", message: "light.turn_on failed", detail: "light.bedroom" });
    return page;
  }

  it("with /auth/revoke hanging: everything local is gone at once, and it reloads after 3 s", async () => {
    const { socket, errorLog } = await signedIn();
    fetch.mockImplementation(() => new Promise(() => {}));

    const done = socket.signOut();
    // Synchronously, before any answer from HA.
    expect(localStorage.getItem("ha_tokens")).toBeNull();
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
    expect(errorLog.getEntries()).toEqual([]);
    expect(lib.ha.sockets.at(-1).readyState).toBe(3);
    // The revoke still goes, with the refresh token kept in memory for it.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${HA}/auth/revoke`);
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(init.body.get("token")).toBe("stored-refresh");

    await vi.advanceTimersByTimeAsync(2999);
    expect(lib.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(lib.reloads).toBe(1);
  });

  it("reloads as soon as HA answers, and a second press starts nothing new", async () => {
    const { socket } = await signedIn();
    fetch.mockImplementation(async () => ({ ok: true, status: 200 }));
    const done = socket.signOut();
    expect(socket.signOut()).toBe(done);
    await done;
    expect(lib.reloads).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a Spotify refresh that answers after the last clear can't write the token back (C4)", async () => {
    const { socket } = await signedIn();
    const spotify = await import("../../src/ha/spotify.js");
    // Sam's Spotify access token has just lapsed, so the next call refreshes it.
    localStorage.setItem(
      SPOTIFY_KEY,
      JSON.stringify({ access_token: "SPOT", refresh_token: "SPOTREF", expires_at: Date.now() - 1 }),
    );
    let answerRefresh = null;
    fetch.mockImplementation((url) =>
      String(url).startsWith("https://accounts.spotify.com/")
        ? new Promise((resolve) => (answerRefresh = resolve))
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
    );
    const search = spotify.searchTracks("abba").then(
      () => "answered",
      () => "refused",
    );
    await flush();
    expect(answerRefresh).toBeTypeOf("function");

    await socket.signOut(); // HA answers the revoke at once: cleared twice, reload asked for
    expect(lib.reloads).toBe(1);
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();

    // The page hasn't unloaded yet when Spotify answers.
    answerRefresh({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "NEW", refresh_token: "NEWREF", expires_in: 3600 }),
    });
    await flush();
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
    // Nor does anything get to use the fresh token.
    expect(await search).toBe("refused");
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith("https://api.spotify.com/"))).toBe(false);
  });

  it("an error logged after the last clear isn't written back (C4)", async () => {
    const { socket, errorLog } = await signedIn();
    fetch.mockImplementation(async () => ({ ok: true, status: 200 }));
    await socket.signOut();
    expect(lib.reloads).toBe(1);
    // A call the closing socket rejected, logged before the page unloads —
    // with HA stalled the close can outlast the 3 s revoke wait.
    errorLog.logError({ source: "service", message: "light.turn_on failed", detail: "light.bedroom · Connection lost" });
    expect(errorLog.getEntries()).toEqual([]);
    expect(localStorage.getItem("gh_error_log")).toBeNull();
  });

  it("a token refresh still in flight can't write the session back", async () => {
    const { socket } = await signedIn();
    let answerRefresh;
    fetch.mockImplementation((url) =>
      String(url).endsWith("/auth/token")
        ? new Promise((resolve) => (answerRefresh = resolve))
        : new Promise(() => {}),
    );
    vi.setSystemTime(Date.now() + 2 * 3600_000); // the access token has expired
    const pending = socket.getFreshAccessToken();
    await flush();
    socket.signOut();
    answerRefresh({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "fresh", expires_in: 1800, token_type: "Bearer" }),
    });
    await pending.catch(() => {});
    await flush();
    expect(localStorage.getItem("ha_tokens")).toBeNull();
  });
});

describe("security#1 — a session HA ends takes the Spotify token with it", () => {
  it("mid-session: the refresh token was revoked in HA", async () => {
    vi.useFakeTimers();
    storeTokens();
    storeSpotify();
    const { socket } = await loadPage();
    await flush();
    act(() => lib.ha.answer());

    lib.refuse = ERR_INVALID_AUTH; // the socket refuses the token…
    act(() => lib.ha.drop());
    await reconnect();
    await flush(); // …and /auth/token says 400: the session is dead
    expect(localStorage.getItem("ha_tokens")).toBeNull();
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
    const spotify = await import("../../src/ha/spotify.js");
    expect(spotify.isSpotifyConnected()).toBe(false);
    expect(redirected()).toBe(true);
    expect(socket.isSessionExpired()).toBe(false);
  });

  it("on load, rate-limited to 'Signed out': no working Spotify left behind either", async () => {
    sessionStorage.setItem(REDIRECT_KEY, String(Date.now() - 10_000));
    storeTokens();
    storeSpotify();
    lib.refuse = ERR_INVALID_AUTH;
    const { socket } = await loadPage();
    await flush();
    expect(socket.isSessionExpired()).toBe(true);
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
  });

  it("a Pi that is down is not a dead session: the Spotify token stays", async () => {
    vi.useFakeTimers();
    storeTokens();
    storeSpotify();
    lib.refuse = ERR_CANNOT_CONNECT;
    const { socket } = await loadPage();
    await flush();
    expect(socket.getConnectionStatus()).toBe("disconnected");
    expect(localStorage.getItem(SPOTIFY_KEY)).not.toBeNull();
    expect(localStorage.getItem("ha_tokens")).not.toBeNull();
  });
});

describe("lifecycle#3 — Back from HA's login page doesn't leave the page stuck", () => {
  const pageshow = (persisted) => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));

  it("restored from the back/forward cache mid-trip to login: it starts over", async () => {
    const { socket } = await loadPage(); // no tokens: off to HA's login
    await flush();
    expect(redirected()).toBe(true);
    expect(socket.getConnectionStatus()).toBe("connecting");
    pageshow(false); // an ordinary load event is not a restore
    expect(lib.reloads).toBe(0);
    pageshow(true);
    expect(lib.reloads).toBe(1);
  });

  it("a restored page that never left for the login is left alone", async () => {
    storeTokens();
    const { socket } = await loadPage();
    await flush();
    act(() => lib.ha.answer());
    expect(socket.getConnectionStatus()).toBe("ready");
    pageshow(true);
    expect(lib.reloads).toBe(0);
  });
});
