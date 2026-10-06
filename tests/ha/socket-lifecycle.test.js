/* The shared HA connection's lifecycle: first connect, retry, expired
   session, OAuth callback, removed entities, and readable errors.

   The real home-assistant-js-websocket getAuth runs (so the OAuth callback
   and stored-token logic is the library's own), with fetch stubbed. Only
   createConnection and subscribeEntities are replaced, so each test decides
   whether the Pi answers. Each test imports socket.js fresh — that is a
   page load. jsdom cannot navigate (it prints "Not implemented: navigation"
   straight to stderr), so a redirect to HA's login is detected by the
   rate-limit stamp socket.js writes at exactly the point getAuth redirects. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const HA = "https://ha.example.invalid";
const lib = vi.hoisted(() => ({ createConnection: null, onEntities: null }));

vi.mock("home-assistant-js-websocket", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createConnection: (...args) => lib.createConnection(...args),
    subscribeEntities: (_conn, cb) => {
      lib.onEntities = cb;
      return () => {};
    },
  };
});
// spotify.js runs its own OAuth callback at module load, and these tests put
// a ?code= in the URL.
vi.mock("../../src/ha/spotify.js", () => ({ clearSpotifyToken: () => {} }));

const ERR_CANNOT_CONNECT = 1;
const ERR_INVALID_AUTH = 2;
const ERR_CONNECTION_LOST = 3;
const REDIRECT_KEY = "gh_ha_login_redirect_at";

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

function fakeConnection() {
  const listeners = {};
  const conn = {
    addEventListener: (type, cb) => (listeners[type] ||= []).push(cb),
    fire: (type, data) => (listeners[type] || []).forEach((cb) => cb(conn, data)),
    close: vi.fn(),
    sendMessagePromise: vi.fn(),
  };
  return conn;
}

/* Handlers socket.js puts on window/document, so a previous test's module
   instance can't answer the next test's "online" event. */
let added = [];
let testStart = 0;

async function loadPage() {
  vi.resetModules();
  const winSpy = vi.spyOn(window, "addEventListener");
  const docSpy = vi.spyOn(document, "addEventListener");
  const socket = await import("../../src/ha/socket.js");
  const errorLog = await import("../../src/lib/errorLog.js");
  added.push(...winSpy.mock.calls.map(([t, h]) => [window, t, h]));
  added.push(...docSpy.mock.calls.map(([t, h]) => [document, t, h]));
  winSpy.mockRestore();
  docSpy.mockRestore();
  return { socket, errorLog };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const redirected = () => {
  const at = Number(sessionStorage.getItem(REDIRECT_KEY));
  return at >= testStart && at <= Date.now();
};
const connectionLog = (errorLog) =>
  errorLog.getEntries().filter((e) => e.source === "connection").map((e) => [e.message, e.detail]);

beforeEach(() => {
  vi.stubEnv("VITE_HA_URL", HA);
  sessionStorage.clear();
  lib.createConnection = vi.fn();
  lib.onEntities = null;
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

describe("first connect (data-layer#1)", () => {
  it("retries a failed first connect with backoff and connects once HA is back", async () => {
    vi.useFakeTimers();
    storeTokens();
    const conn = fakeConnection();
    lib.createConnection
      .mockRejectedValueOnce(ERR_CANNOT_CONNECT)
      .mockRejectedValueOnce(ERR_CANNOT_CONNECT)
      .mockResolvedValue(conn);

    const { socket, errorLog } = await loadPage();
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(1);
    expect(socket.getConnectionStatus()).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(2);
    expect(socket.getConnectionStatus()).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(3);
    expect(socket.getConnectionStatus()).toBe("ready");

    // One entry for the outage, not one per attempt — and in words.
    expect(connectionLog(errorLog)).toEqual([["WebSocket connection failed", "Could not reach Home Assistant"]]);
  });

  it("keeps backing off to a 30-second cap while the Pi stays down, without touching the session", async () => {
    vi.useFakeTimers();
    storeTokens();
    lib.createConnection.mockRejectedValue(ERR_CANNOT_CONNECT);
    const { socket } = await loadPage();
    await flush();

    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000 + 10000 + 30000 * 3);
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(lib.createConnection).toHaveBeenCalledTimes(8);

    // A Pi that is down is not a dead session: tokens kept, no login trip.
    expect(localStorage.getItem("ha_tokens")).not.toBeNull();
    expect(redirected()).toBe(false);
    expect(socket.isSessionExpired()).toBe(false);
  });

  it("tries again at once when the browser comes back online or the tab becomes visible", async () => {
    vi.useFakeTimers();
    storeTokens();
    lib.createConnection.mockRejectedValue(ERR_CANNOT_CONNECT);
    const { socket } = await loadPage();
    await flush();
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000);
    await flush();
    const before = lib.createConnection.mock.calls.length;

    window.dispatchEvent(new Event("online"));
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(before + 1);

    lib.createConnection.mockResolvedValue(fakeConnection());
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(lib.createConnection).toHaveBeenCalledTimes(before + 2);
    expect(socket.getConnectionStatus()).toBe("ready");

    // Connected: neither event starts a second connection.
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lib.createConnection).toHaveBeenCalledTimes(before + 2);
  });
});

describe("expired session (data-layer#2)", () => {
  it("drops dead tokens and goes to HA's login instead of reading 'Pi offline' forever", async () => {
    vi.useFakeTimers();
    storeTokens();
    lib.createConnection.mockRejectedValue(ERR_INVALID_AUTH);
    const { socket, errorLog } = await loadPage();
    await flush();

    expect(localStorage.getItem("ha_tokens")).toBeNull();
    expect(redirected()).toBe(true);
    expect(sessionStorage.getItem(REDIRECT_KEY)).not.toBeNull();
    expect(socket.isSessionExpired()).toBe(false);
    expect(connectionLog(errorLog).map(([m]) => m)).toContain("Home Assistant session expired");

    // Invalid auth is not retried.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(lib.createConnection).toHaveBeenCalledTimes(1);
  });

  it("stops at 'Signed out' rather than looping when it already sent the tab to login a moment ago", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(REDIRECT_KEY, String(Date.now() - 10_000));
    storeTokens();
    lib.createConnection.mockRejectedValue(ERR_INVALID_AUTH);
    const { socket } = await loadPage();
    await flush();

    expect(redirected()).toBe(false);
    expect(socket.isSessionExpired()).toBe(true);
    expect(socket.getConnectionStatus()).toBe("disconnected");
    expect(localStorage.getItem("ha_tokens")).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(lib.createConnection).toHaveBeenCalledTimes(1);

    // The chip's "sign in" button is consent: it goes, whatever the limit says.
    const seen = [];
    socket.onSessionExpiredChange((v) => seen.push(v));
    socket.signIn();
    await flush();
    expect(redirected()).toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it("treats a hostile rate-limit stamp as absent", async () => {
    for (const junk of ["banana", "-5", String(Date.now() + 3600_000), ""]) {
      sessionStorage.setItem(REDIRECT_KEY, junk);
      const { socket } = await loadPage();
      await flush();
      // No tokens at all: the first-visit path, which must still reach login.
      expect(redirected()).toBe(true);
      expect(socket.isSessionExpired()).toBe(false);
    }
  });

  it("mid-session, a reconnect rejected for invalid auth goes to re-login, not a dead socket", async () => {
    storeTokens();
    const conn = fakeConnection();
    lib.createConnection.mockResolvedValue(conn);
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.getConnectionStatus()).toBe("ready"));

    conn.fire("disconnected");
    conn.fire("reconnect-error", ERR_INVALID_AUTH);
    await flush();

    expect(conn.close).toHaveBeenCalled();
    expect(localStorage.getItem("ha_tokens")).toBeNull();
    expect(redirected()).toBe(true);
    expect(lib.createConnection).toHaveBeenCalledTimes(1);
  });
});

describe("OAuth callback (data-layer#3)", () => {
  const state = () => btoa(JSON.stringify({ hassUrl: HA, clientId: "http://localhost:3000/" }));

  it("strips a spent ?code= after one failed exchange and falls back to the stored tokens", async () => {
    window.history.replaceState(null, "", `/?tab=media&auth_callback=1&code=SPENT&state=${state()}`);
    storeTokens();
    lib.createConnection.mockResolvedValue(fakeConnection());

    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.getConnectionStatus()).toBe("ready"));
    expect(window.location.search).toBe("?tab=media");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lib.createConnection.mock.calls[0][0].auth.accessToken).toBe("stored-access");

    // The next load has nothing left to re-send.
    await loadPage();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a Spotify code/state pair that rode along through HA's login", async () => {
    window.history.replaceState(
      null,
      "",
      `/?code=SPOTIFY&state=sp&auth_callback=1&code=SPENT&state=${state()}`,
    );
    storeTokens();
    lib.createConnection.mockResolvedValue(fakeConnection());
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.getConnectionStatus()).toBe("ready"));
    expect(window.location.search).toBe("?code=SPOTIFY&state=sp");
  });

  it("with no stored tokens, a failed exchange right after a login redirect stops at 'Signed out'", async () => {
    sessionStorage.setItem(REDIRECT_KEY, String(Date.now() - 20_000));
    window.history.replaceState(null, "", `/?auth_callback=1&code=SPENT&state=${state()}`);
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.isSessionExpired()).toBe(true));
    expect(window.location.search).toBe("");
    expect(redirected()).toBe(false);
  });

  it("sign out never reloads onto a callback URL, and goes straight to login", async () => {
    storeTokens();
    sessionStorage.setItem(REDIRECT_KEY, String(Date.now()));
    lib.createConnection.mockResolvedValue(fakeConnection());
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.getConnectionStatus()).toBe("ready"));

    window.history.replaceState(null, "", `/?auth_callback=1&code=OLD&state=${state()}`);
    await socket.signOut();
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem(REDIRECT_KEY)).toBeNull();
    expect(localStorage.getItem("ha_tokens")).toBeNull();
  });
});

describe("entity removal (data-layer#6)", () => {
  it("drops an entity HA removed and tells its subscribers it is gone", async () => {
    storeTokens();
    lib.createConnection.mockResolvedValue(fakeConnection());
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(lib.onEntities).toBeTypeOf("function"));

    const a = { entity_id: "light.a", state: "on", attributes: {} };
    const gone = { entity_id: "update.gone", state: "on", attributes: {} };
    lib.onEntities({ "light.a": a, "update.gone": gone });
    const seen = [];
    socket.subscribe("update.gone", (s) => seen.push(s?.state));

    lib.onEntities({ "light.a": a });
    expect(socket.getEntity("update.gone")).toBeUndefined();
    expect(socket.getAllStates()).toEqual([a]);
    expect(seen).toEqual(["on", undefined]);
  });
});

describe("readable errors (data-layer#7)", () => {
  async function connected() {
    storeTokens();
    const conn = fakeConnection();
    lib.createConnection.mockResolvedValue(conn);
    const page = await loadPage();
    await vi.waitFor(() => expect(page.socket.getConnectionStatus()).toBe("ready"));
    return { ...page, conn };
  }

  it("turns the library's bare 3 and its 'Connection lost' frame into Errors that say so", async () => {
    const { socket, conn } = await connected();
    conn.sendMessagePromise.mockRejectedValueOnce(ERR_CONNECTION_LOST);
    await expect(socket.sendWsMessage({ type: "x" })).rejects.toMatchObject({
      message: "Not connected to Home Assistant",
      code: 3,
    });

    conn.sendMessagePromise.mockRejectedValueOnce({
      type: "result",
      success: false,
      error: { code: ERR_CONNECTION_LOST, message: "Connection lost" },
    });
    await expect(socket.sendWsMessage({ type: "x" })).rejects.toMatchObject({
      message: "Not connected to Home Assistant",
    });
  });

  it("passes Home Assistant's own errors through untouched", async () => {
    const { socket, conn } = await connected();
    const haError = { code: "not_found", message: "Service not found." };
    conn.sendMessagePromise.mockRejectedValueOnce(haError);
    await expect(socket.sendWsMessage({ type: "x" })).rejects.toBe(haError);
  });

  it("a dead refresh token reaches REST callers as 'session expired', not the number 2", async () => {
    storeTokens({ expires: Date.now() - 1000 });
    lib.createConnection.mockResolvedValue(fakeConnection());
    const { socket } = await loadPage();
    await vi.waitFor(() => expect(socket.getConnectionStatus()).toBe("ready"));
    await expect(socket.getFreshAccessToken()).rejects.toMatchObject({
      message: "Home Assistant session expired",
      code: 2,
    });
  });
});
