/* Round 4d (2026-10-06 sweep, fresh-eyes review of round 4) — the session
   around Sign out.

   D7  — Sign out during a reconnect: the library's own reconnect finished
         after the close, resubscribed and fired "ready", so the page came back
         "Pi · N live" with live controls under "Signing out…". A setup()
         already in flight had the same gap after each of its awaits.
   D8  — a tab with no session (on "Signed out · sign in") ignored another
         tab's Sign out, and its next error log entry wrote the previous
         session's log back from memory.
   D9  — Sign out sets the status to "disconnected", and not connected is the
         all-tabs fallback in roles.js: a guest's nav opened all seven tabs
         for the revoke wait.
   D11 — Sign out's second clear, after the revoke, removed a newer session
         another tab had signed into meanwhile, and so signed that tab out a
         second time.

   Same harness as round4c-socket.test.jsx — the library's own Connection
   over a fake WebSocket answered by a stand-in HA — plus a hold on opening a
   socket, so a connect or reconnect can be left in flight across Sign out,
   and an answer to auth/current_user for the role. A closed fake socket
   delivers nothing, as a real one doesn't. jsdom can't reload, so
   loginRedirect.js's reloadPage is counted. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, within } from "@testing-library/react";

const HA = "https://ha.example.invalid";
const SPOTIFY_KEY = "gh_spotify_token";
const ERROR_LOG_KEY = "gh_error_log";
const MARKER_KEY = "gh_signed_out_at";

const lib = vi.hoisted(() => ({ ha: null, reloads: 0, hold: null, user: null }));

vi.mock("home-assistant-js-websocket", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createConnection: (options) =>
      real.createConnection({
        ...options,
        // Also what the library's own reconnect calls.
        createSocket: async () => {
          if (lib.hold) await lib.hold.promise;
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
// The App test is about the nav, not the cards or the boot animation.
vi.mock("../../src/views/OverviewView.jsx", () => ({ default: () => <p>overview</p> }));
vi.mock("../../src/BootScreen.jsx", () => ({ default: () => null }));

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

function fakeHa(initial = {}) {
  const ha = { entities: {}, sockets: [], waiting: [] };
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
        if (msg.type === "auth/current_user" && lib.user) {
          Promise.resolve().then(() => sock.deliver({ id: msg.id, type: "result", success: true, result: lib.user }));
        }
      },
      close() {
        if (sock.readyState === 3) return;
        sock.readyState = 3;
        emit(sock, "close", {});
      },
      // A real WebSocket dispatches nothing once close() has been called.
      deliver: (msg) => sock.readyState === 1 && emit(sock, "message", { data: JSON.stringify(msg) }),
    };
    ha.sockets.push(sock);
    return sock;
  };
  ha.answer = () => {
    for (const sub of ha.waiting.splice(0)) {
      sub.sock.deliver({ id: sub.id, type: "result", success: true, result: null });
      sub.sock.deliver({ id: sub.id, type: "event", event: { a: { ...ha.entities } } });
    }
  };
  ha.drop = () => ha.sockets.at(-1).close();
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
/* The library waits a tick before its first reconnect attempt. */
const reconnect = () => act(() => vi.advanceTimersByTimeAsync(0));
const hangRevoke = () => fetch.mockImplementation(() => new Promise(() => {}));

async function connected(initial) {
  vi.useFakeTimers();
  storeTokens();
  lib.ha = fakeHa(initial);
  const page = await loadPage();
  await flush();
  act(() => lib.ha.answer());
  expect(page.socket.getConnectionStatus()).toBe("ready");
  return page;
}

/* Lets a socket open only when release() is called. */
function holdSockets() {
  lib.hold = deferred();
  return async () => {
    const { resolve } = lib.hold;
    lib.hold = null;
    resolve();
    await flush();
  };
}

/* What another tab's signOut() does to the shared storage (session.js#clearDevice),
   and the one event this tab hears of it. */
function signOutElsewhere(meanwhile = () => {}) {
  localStorage.setItem(MARKER_KEY, String(Date.now()));
  localStorage.removeItem("ha_tokens");
  localStorage.removeItem(SPOTIFY_KEY);
  localStorage.removeItem(ERROR_LOG_KEY);
  meanwhile();
  window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", oldValue: JSON.stringify(SESSION), newValue: null }));
}

beforeEach(() => {
  vi.stubEnv("VITE_HA_URL", HA);
  sessionStorage.clear();
  localStorage.clear();
  lib.ha = fakeHa();
  lib.reloads = 0;
  lib.hold = null;
  lib.user = null;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [target, type, handler] of added) target.removeEventListener(type, handler);
  added = [];
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe("D7 — nothing that finishes connecting after Sign out brings the page back", () => {
  it("a reconnect in flight: its socket is closed, and nothing reads 'ready' or live", async () => {
    const { socket, hooks } = await connected({ "light.a": "on" });
    const { ConnectionChip } = await import("../../src/App.jsx");
    function Probe() {
      const { entity, status } = hooks.useEntityStatus("light.a");
      return <output>{`${status}:${entity?.state ?? "-"}`}</output>;
    }
    const { container } = render(
      <>
        <Probe />
        <ConnectionChip />
      </>,
    );

    // The Pi drops; the library's reconnect is left opening its new socket.
    const release = holdSockets();
    act(() => lib.ha.drop());
    await reconnect();
    expect(socket.getConnectionStatus()).toBe("disconnected");

    hangRevoke();
    act(() => {
      socket.signOut();
    });
    await release(); // HA's auth_ok arrives after the confirm

    expect(lib.ha.sockets).toHaveLength(2);
    expect(lib.ha.sockets[1].readyState).toBe(3);
    expect(socket.getConnectionStatus()).toBe("disconnected");
    act(() => lib.ha.answer()); // nothing arrives on a closed socket
    expect(socket.hasSnapshot()).toBe(false);
    expect(container.querySelector("output")).toHaveTextContent(/^loading:/);
    expect(container.querySelector(".chip")).toHaveTextContent("Signing out…");

    // And it stays down until the reload.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(lib.ha.sockets).toHaveLength(2);
    expect(socket.getConnectionStatus()).toBe("disconnected");
  });

  it("a first connect in flight: the connection it opens is closed, not kept", async () => {
    vi.useFakeTimers();
    storeTokens();
    const release = holdSockets();
    const { socket } = await loadPage();
    await flush();
    expect(socket.getConnectionStatus()).toBe("authenticating");

    hangRevoke();
    act(() => {
      socket.signOut();
    });
    await release();

    expect(lib.ha.sockets).toHaveLength(1);
    expect(lib.ha.sockets[0].readyState).toBe(3);
    expect(socket.getConnectionStatus()).toBe("disconnected");
    await expect(socket.sendWsMessage({ type: "ping" })).rejects.toThrow("Not connected");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(lib.ha.sockets).toHaveLength(1);
  });

  it("a sign-in in flight (the ?code= exchange): its session isn't kept in memory or opened", async () => {
    vi.useFakeTimers();
    const state = btoa(JSON.stringify({ hassUrl: HA, clientId: "http://localhost:3000/" }));
    window.history.replaceState(null, "", `/?auth_callback=1&code=abc&state=${encodeURIComponent(state)}`);
    let answerToken = null;
    fetch.mockImplementation((url) =>
      String(url).endsWith("/auth/token") ? new Promise((resolve) => (answerToken = resolve)) : new Promise(() => {}),
    );
    const { socket } = await loadPage();
    await flush();
    expect(answerToken).toBeTypeOf("function");

    act(() => {
      socket.signOut();
    });
    answerToken({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 1800, token_type: "Bearer" }),
    });
    await flush();

    expect(localStorage.getItem("ha_tokens")).toBeNull();
    expect(await socket.getFreshAccessToken()).toBeNull();
    expect(lib.ha.sockets).toHaveLength(0);
    expect(socket.getConnectionStatus()).not.toBe("ready");
    expect(socket.isSessionExpired()).toBe(false); // "Signing out…", not "Signed out · sign in"
  });
});

describe("D8 — a tab with no session follows another tab's Sign out too", () => {
  async function signedOutHere() {
    vi.useFakeTimers();
    sessionStorage.setItem("gh_ha_login_redirect_at", String(Date.now() - 10_000)); // the trip to login used up
    const page = await loadPage();
    await flush();
    expect(page.socket.isSessionExpired()).toBe(true);
    // What the previous session left in this tab's log.
    page.errorLog.logError({ source: "service", message: "light.turn_on failed", detail: "light.bathroom · fakeha says no" });
    expect(localStorage.getItem(ERROR_LOG_KEY)).toContain("light.turn_on failed");
    return page;
  }

  it("on 'Signed out · sign in': it clears and locks its log, and reloads", async () => {
    const { errorLog } = await signedOutHere();
    act(() => signOutElsewhere());
    expect(errorLog.getEntries()).toEqual([]);
    expect(lib.reloads).toBe(1);

    // Backup now, pressed before the page has gone.
    errorLog.logError({ source: "service", message: "backup.create_automatic failed", detail: "Not connected" });
    expect(localStorage.getItem(ERROR_LOG_KEY)).toBeNull();
    expect(errorLog.getEntries()).toEqual([]);
  });

  it("its Spotify token, written back before the event arrived, goes too", async () => {
    await signedOutHere();
    act(() => signOutElsewhere(storeSpotify)); // landed between the other tab's clear and the event
    expect(localStorage.getItem(SPOTIFY_KEY)).toBeNull();
  });

  it("a session HA ended elsewhere (no Sign out) changes nothing in a tab that had none", async () => {
    const { errorLog } = await signedOutHere();
    localStorage.setItem(MARKER_KEY, String(Date.now() - 10 * 60_000)); // an old Sign out
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ha_tokens", oldValue: JSON.stringify(SESSION), newValue: null })));
    expect(lib.reloads).toBe(0);
    expect(errorLog.getEntries()).toHaveLength(1);
    expect(localStorage.getItem(ERROR_LOG_KEY)).toContain("light.turn_on failed");
  });
});

describe("D9 — the nav keeps the session's role for the whole Sign out wait", () => {
  const GUEST = { id: "some-unknown-id", name: "Guest", is_admin: false, is_owner: false };

  async function app(user) {
    lib.user = user;
    window.history.replaceState(null, "", "/?viewport=desktop");
    const page = await connected({ "light.a": "on" });
    const { default: App } = await import("../../src/App.jsx");
    const { container } = render(<App />);
    await flush();
    const tabs = () => within(container.querySelector(".tabs")).getAllByRole("tab").map((t) => t.textContent);
    const bottom = () => within(container.querySelector(".bottom-nav")).getAllByRole("tab").length;
    return { ...page, tabs, bottom };
  }

  it("a guest still sees Overview only", async () => {
    const { socket, tabs, bottom } = await app(GUEST);
    expect(tabs()).toEqual(["Overview"]);

    hangRevoke();
    act(() => {
      socket.signOut();
    });
    await flush();
    expect(socket.getConnectionStatus()).toBe("disconnected");
    expect(tabs()).toEqual(["Overview"]);
    expect(bottom()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2999)); // up to the reload
    expect(tabs()).toEqual(["Overview"]);
  });

  it("a user whose role hadn't come back yet stays fail-closed, not all seven", async () => {
    const { socket, tabs } = await app(null); // auth/current_user never answers
    expect(tabs()).toEqual(["Overview"]);
    hangRevoke();
    act(() => {
      socket.signOut();
    });
    await flush();
    expect(tabs()).toEqual(["Overview"]);
  });

  it("family keeps every tab", async () => {
    const { socket, tabs } = await app({ ...GUEST, is_admin: true });
    expect(tabs()).toHaveLength(7);
    hangRevoke();
    act(() => {
      socket.signOut();
    });
    await flush();
    expect(tabs()).toHaveLength(7);
  });
});

describe("D11 — Sign out's second clear spares a session another tab signed into meanwhile", () => {
  async function signingOut() {
    const page = await connected({ "light.a": "on" });
    let answerRevoke = null;
    fetch.mockImplementation((url) =>
      String(url).endsWith("/auth/revoke") ? new Promise((resolve) => (answerRevoke = resolve)) : new Promise(() => {}),
    );
    const done = page.socket.signOut();
    expect(localStorage.getItem("ha_tokens")).toBeNull();
    return { ...page, done, answer: () => answerRevoke({ ok: true, status: 200 }) };
  }

  it("a newer session, its Spotify token and its log are left alone", async () => {
    const { done, answer } = await signingOut();
    const markedAt = localStorage.getItem(MARKER_KEY);
    // Another tab heard it, reloaded and signed straight back in.
    vi.setSystemTime(Date.now() + 1500);
    storeTokens({ access_token: "b-access", refresh_token: "b-refresh" });
    storeSpotify();
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify([{ id: "b-1", ts: Date.now(), source: "service", message: "b's entry" }]));

    answer();
    await done;
    expect(lib.reloads).toBe(1);
    expect(JSON.parse(localStorage.getItem("ha_tokens")).refresh_token).toBe("b-refresh");
    expect(localStorage.getItem(MARKER_KEY)).toBe(markedAt); // not re-stamped: that tab isn't signed out again
    expect(localStorage.getItem(SPOTIFY_KEY)).not.toBeNull();
    expect(localStorage.getItem(ERROR_LOG_KEY)).toContain("b's entry");
  });

  it("the session it signed out, written back by another tab meanwhile, still goes", async () => {
    const { done, answer } = await signingOut();
    storeTokens({ access_token: "refreshed-elsewhere" }); // same refresh token
    answer();
    await done;
    expect(localStorage.getItem("ha_tokens")).toBeNull();
  });

  it("with no session stored, the old log another tab wrote back still goes", async () => {
    const { done, answer } = await signingOut();
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify([{ id: "a-1", ts: Date.now(), source: "service", message: "old entry" }]));
    answer();
    await done;
    expect(localStorage.getItem(ERROR_LOG_KEY)).toBeNull();
  });
});
