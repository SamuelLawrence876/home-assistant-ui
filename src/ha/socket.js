/* Single shared HA WebSocket connection — now backed by
   `home-assistant-js-websocket`, the library HA's own frontend uses.

   On load: tries the OAuth flow. If we have cached tokens → connects.
   If `?code=` is in the URL (return from HA login) → exchanges + cleans URL.
   Otherwise → redirects to HA's login at ${VITE_HA_URL}/auth/authorize.
   After login, HA bounces back here and the cycle completes.

   Public API is the same shape the rest of the app already imports:
     subscribe(entityId, cb)         -> unsubscribe
     getEntity(id) / getAllStates()
     onConnectionChange(cb)          -> unsubscribe
     getConnectionStatus()
     reconnect()

   New exports for the OAuth refactor:
     getFreshAccessToken()           -> Promise<string | null>  (refreshes if expired)
     getHaUrl()                      -> string
     signOut()                       -> revokes tokens + reloads

   Session state, kept apart from the connection status on purpose (the
   status strings are what useEntity.js maps, and "signed out" is not a kind
   of connection):
     isSessionExpired() / onSessionExpiredChange(cb) -> unsubscribe
     signIn()                        -> user-initiated trip to HA's login
*/

import {
  createConnection,
  getAuth,
  subscribeEntities,
  ERR_INVALID_AUTH,
} from "home-assistant-js-websocket";
import { clearSpotifyToken } from "./spotify.js";
import { describeHaError, toHaError } from "./errors.js";
import { logError, clearErrors } from "../lib/errorLog.js";

const HA_URL = import.meta.env.VITE_HA_URL || "";
// getAuth strips one trailing slash before comparing stored tokens' hassUrl.
const HA_BASE = HA_URL.endsWith("/") ? HA_URL.slice(0, -1) : HA_URL;
const TOKENS_KEY = "ha_tokens";

/* Module-level state */
const states = new Map();              // entity_id -> state object
const subscribers = new Map();         // entity_id -> Set<callback>
const connectionListeners = new Set(); // callbacks for connection status
const statesListeners = new Set();     // callbacks for "states set changed" (size/keys)
const snapshotListeners = new Set();   // one-shot callbacks for first entity snapshot
const sessionListeners = new Set();    // callbacks for "signed out" on/off
let connection = null;
let auth = null;
let connectionStatus = "disconnected"; // "disconnected" | "connecting" | "authenticating" | "ready"
let snapshotReceived = false;
let sessionExpired = false;

function setStatus(next) {
  if (connectionStatus === next) return;
  connectionStatus = next;
  connectionListeners.forEach((cb) => cb(next));
}

function setSessionExpired(next) {
  if (sessionExpired === next) return;
  sessionExpired = next;
  sessionListeners.forEach((cb) => cb(next));
}

function notify(entityId) {
  const subs = subscribers.get(entityId);
  if (!subs) return;
  const state = states.get(entityId);
  subs.forEach((cb) => cb(state));
}

function applyEntities(entities) {
  for (const [id, state] of Object.entries(entities)) {
    states.set(id, state);
    notify(id);
  }
  /* The library hands over its whole store every time, so an id it no longer
     has was removed in HA — deleted, renamed, or an update.* whose add-on was
     uninstalled. Left in the map it kept its last state as live for the life
     of the page, and useEntityStatus said "ready" instead of "not_found". */
  for (const id of [...states.keys()]) {
    if (!Object.hasOwn(entities, id)) {
      states.delete(id);
      notify(id);
    }
  }
  if (!snapshotReceived) {
    snapshotReceived = true;
    snapshotListeners.forEach((cb) => cb());
    snapshotListeners.clear();
  }
  statesListeners.forEach((cb) => cb());
}

const saveTokens = (data) => {
  try {
    if (data) localStorage.setItem(TOKENS_KEY, JSON.stringify(data));
    else localStorage.removeItem(TOKENS_KEY);
  } catch (e) {
    console.warn("[ha-ws] saveTokens failed", e);
  }
};

const loadTokens = async () => {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

/* ---- Login redirects, rate-limited ----------------------------------
   An invalid session sends the browser back to HA's login page, as HA's own
   frontend does. What must not happen is a loop: tokens that fail the moment
   they are issued (or an auth provider that signs straight back in) would
   bounce between the two origins forever. So at most one *automatic*
   redirect per minute per tab; past that the chip says "Signed out" and
   offers a button. sessionStorage, because it survives the round trip to
   HA and back within a tab and is gone when the tab is. */
const LOGIN_REDIRECT_KEY = "gh_ha_login_redirect_at";
const LOGIN_REDIRECT_WINDOW_MS = 60_000;
const SIGNED_OUT = Symbol("signed-out");

function mayRedirectToLogin() {
  const now = Date.now();
  let last = NaN;
  try {
    last = Number(sessionStorage.getItem(LOGIN_REDIRECT_KEY));
  } catch {}
  // Read back as hostile input: only a real, past timestamp can block.
  if (Number.isFinite(last) && last > 0 && last <= now && now - last < LOGIN_REDIRECT_WINDOW_MS) {
    return false;
  }
  try {
    sessionStorage.setItem(LOGIN_REDIRECT_KEY, String(now));
  } catch {}
  return true;
}

function clearLoginRedirectStamp() {
  try {
    sessionStorage.removeItem(LOGIN_REDIRECT_KEY);
  } catch {}
}

/* getAuth calls loadTokens as its last step before redirecting, and only
   redirects when there is nothing usable — so this is the one place a
   redirect can be vetoed. Throwing here rejects getAuth with SIGNED_OUT
   instead of navigating. */
const loadTokensOrGate = async () => {
  const data = await loadTokens();
  if (data && data.hassUrl === HA_BASE) return data;
  if (!mayRedirectToLogin()) throw SIGNED_OUT;
  return data;
};

/* Remove the last occurrence of a repeated query param, keeping the earlier ones. */
function dropLastParam(params, name) {
  const all = params.getAll(name);
  if (all.length === 0) return;
  params.delete(name);
  all.slice(0, -1).forEach((v) => params.append(name, v));
}

const hasAuthCallback = () => new URLSearchParams(window.location.search).has("auth_callback");

/* Clean HA OAuth callback params only. A Spotify callback that lands while we
   have no HA tokens gets carried through HA's login round trip (the library
   builds its redirect URI from the current query string), so the URL can hold
   two code/state pairs — and `delete` removes every occurrence. HA appends its
   own last, so drop only the last of each and leave Spotify's alone. */
function stripAuthCallback() {
  if (!hasAuthCallback()) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_callback");
  dropLastParam(url.searchParams, "code");
  dropLastParam(url.searchParams, "state");
  window.history.replaceState(null, "", url.toString());
}

/* getAuth, with the callback handled so it can only ever be tried once.
   getAuth exchanges ?code= *before* it looks at stored tokens, and an HA
   auth code is single-use and short-lived. The params used to be cleaned
   only on success, so one failed exchange (a Funnel 502, a lost response)
   left a spent code in the URL that every reload — Sign out included —
   re-sent, never reaching the valid tokens behind it. LESSONS.md pattern 3. */
async function authenticate() {
  const options = { hassUrl: HA_URL, saveTokens, loadTokens: loadTokensOrGate };
  if (!hasAuthCallback()) return getAuth(options);
  try {
    return await getAuth(options);
  } catch (err) {
    logError({
      source: "connection",
      message: "Home Assistant sign-in failed",
      detail: describeHaError(err),
    });
  } finally {
    stripAuthCallback();
  }
  // With the callback gone: stored tokens, or a (rate-limited) fresh login.
  return getAuth(options);
}

/* ---- Connecting, and trying again -----------------------------------
   Once a Connection exists the library reconnects by itself, with backoff,
   forever (except on invalid auth — see "reconnect-error" below). The
   *first* connect has no retry at all: createConnection's default is one
   attempt. So a tablet that powered up before the Pi did, or a phone that
   opened the PWA with no signal, sat on "Pi offline" until someone reloaded.

   While retrying, the status stays "disconnected": that is what the library
   reports mid-session between its own attempts, and flipping the chip to
   "connecting" every 30 seconds would make its live region announce it
   every 30 seconds. Only the first attempt of a streak says "connecting". */
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
let setupRunning = false;
let retryTimer = null;
let retryAttempt = 0; // consecutive failures in the current streak

function scheduleRetry() {
  if (retryTimer || connection || sessionExpired) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    setup();
  }, delay);
}

/* Back online, or the tab came back to the front: don't sit out the rest of
   a 30-second backoff. Only acts mid-streak — never starts a second setup. */
function retryNow() {
  if (!retryTimer || connection || setupRunning) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  setup();
}

/* Logged once per streak, not once per attempt: a Pi that is down for an
   hour would otherwise push everything else out of the 100-entry log. */
function connectFailed(message, err) {
  console.warn(`[ha-ws] ${message}`, err);
  if (retryAttempt === 0) {
    logError({ source: "connection", message, detail: describeHaError(err) });
  }
  setStatus("disconnected");
  return "retry";
}

/* The session is dead: forget its tokens so the next getAuth goes to the
   login page (or, rate-limited, to "Signed out"). */
function dropSession() {
  saveTokens(null);
  auth = null;
  stripAuthCallback();
}

async function connectOnce() {
  if (retryAttempt === 0) setStatus("connecting");
  try {
    auth = await authenticate();
  } catch (err) {
    if (err === SIGNED_OUT) return "signed_out";
    return connectFailed("Home Assistant sign-in failed", err);
  }

  if (retryAttempt === 0) setStatus("authenticating");
  let conn;
  try {
    conn = await createConnection({ auth });
  } catch (err) {
    if (err === ERR_INVALID_AUTH) {
      logError({ source: "connection", message: "Home Assistant session expired" });
      return "relogin";
    }
    return connectFailed("WebSocket connection failed", err);
  }

  connection = conn;
  retryAttempt = 0;
  conn.addEventListener("ready", () => setStatus("ready"));
  /* Drops are recorded, not announced. The chip in the topbar is the live
     signal; this is the record you read afterwards to find out that the Pi
     dropped eleven times at 3am. errorLog dedupes a burst of identical
     entries, so a reconnect storm can't flush the buffer. */
  conn.addEventListener("disconnected", () => {
    logError({ source: "connection", message: "Home Assistant WebSocket disconnected" });
    setStatus("disconnected");
  });
  /* The library fires this for ERR_INVALID_AUTH only, and then stops
     reconnecting for good — the chip used to read "Pi offline" forever for
     what was really an expired or revoked session. */
  conn.addEventListener("reconnect-error", (_conn, err) => {
    logError({
      source: "connection",
      message: "Home Assistant WebSocket reconnect failed",
      detail: describeHaError(err),
    });
    setStatus("disconnected");
    try { conn.close(); } catch {}
    if (connection === conn) connection = null;
    if (err === ERR_INVALID_AUTH) {
      dropSession();
      setup({ afterRelogin: true });
    } else {
      scheduleRetry();
    }
  });

  subscribeEntities(conn, applyEntities);
  setStatus("ready");
  return "ready";
}

async function setup({ afterRelogin = false } = {}) {
  if (!HA_URL) {
    console.warn("[ha-ws] VITE_HA_URL not set — cannot connect");
    setStatus("disconnected");
    return;
  }
  if (setupRunning || connection || sessionExpired) return;
  setupRunning = true;
  clearTimeout(retryTimer);
  retryTimer = null;

  let outcome;
  try {
    outcome = await connectOnce();
  } catch (err) {
    outcome = connectFailed("Home Assistant connection failed", err);
  } finally {
    setupRunning = false;
  }

  if (outcome === "retry") {
    scheduleRetry();
  } else if (outcome === "signed_out" || (outcome === "relogin" && afterRelogin)) {
    // A second invalid session straight after dropping the first means the
    // tokens could not be forgotten (storage blocked) — stop rather than loop.
    setStatus("disconnected");
    setSessionExpired(true);
  } else if (outcome === "relogin") {
    dropSession();
    await setup({ afterRelogin: true });
  }
}

/* Public API — unchanged shape, mostly used by useEntity.js + the chip */

export function getEntity(entityId) {
  return states.get(entityId);
}

export function getAllStates() {
  return Array.from(states.values());
}

export function subscribe(entityId, callback) {
  if (!subscribers.has(entityId)) subscribers.set(entityId, new Set());
  subscribers.get(entityId).add(callback);
  if (states.has(entityId)) callback(states.get(entityId));
  return () => {
    const subs = subscribers.get(entityId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(entityId);
    }
  };
}

export function onConnectionChange(callback) {
  connectionListeners.add(callback);
  callback(connectionStatus);
  return () => connectionListeners.delete(callback);
}

/* Fires once per applyEntities batch — listeners use this to recompute
   aggregates (e.g. the topbar's available/total count) without subscribing
   to every entity individually. */
export function onStatesChanged(callback) {
  statesListeners.add(callback);
  return () => statesListeners.delete(callback);
}

export function getConnectionStatus() {
  return connectionStatus;
}

export function hasSnapshot() {
  return snapshotReceived;
}

export function onSnapshotReady(callback) {
  if (snapshotReceived) {
    callback();
    return () => {};
  }
  snapshotListeners.add(callback);
  return () => snapshotListeners.delete(callback);
}

export function reconnect() {
  if (connection) {
    try { connection.close(); } catch {}
    connection = null;
  }
  clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
  states.clear();
  snapshotReceived = false;
  setup();
}

/* "Signed out" — the session is gone and the automatic trip to the login
   page has been used up (see mayRedirectToLogin). Distinct from "Pi offline",
   which is what the chip used to claim. */
export function isSessionExpired() {
  return sessionExpired;
}

export function onSessionExpiredChange(callback) {
  sessionListeners.add(callback);
  callback(sessionExpired);
  return () => sessionListeners.delete(callback);
}

/* A person pressed "Sign in": that is consent, so the rate limit resets. */
export function signIn() {
  clearLoginRedirectStamp();
  retryAttempt = 0;
  setSessionExpired(false);
  setup();
}

/* OAuth-specific extras */

/* The only token getter. There used to be a synchronous `getAccessToken()`
   beside this one that handed out `auth.accessToken` without checking expiry —
   the WS library only refreshes at connect time, so REST callers that picked it
   started 401ing ~30 minutes in while the socket still read "live".
   A failed refresh rejects with the library's bare number (2 for a dead
   refresh token); toHaError turns that into an Error that says so. */
export async function getFreshAccessToken() {
  if (!auth) return null;
  if (auth.expired) {
    try {
      await auth.refreshAccessToken();
    } catch (err) {
      throw toHaError(err);
    }
  }
  return auth.accessToken;
}

export function getHaUrl() {
  return HA_URL;
}

export async function signOut() {
  try {
    if (auth) await auth.revoke();
  } catch (e) {
    console.warn("[ha-ws] revoke failed (logging out locally anyway)", e);
  }
  try { localStorage.removeItem(TOKENS_KEY); } catch {}
  // Clear every credential this app owns, not just HA's — on a shared tablet the
  // next person used to inherit a working Spotify refresh token.
  clearSpotifyToken();
  // Same reasoning for the error log. No credential can reach it (errorLog
  // redacts on the way in and again on the way out), but it holds entity ids,
  // HA's own error text and full stack traces from the previous session, and
  // the card promises "kept in this browser" — which reads as a session
  // guarantee. Signing out is where that promise has to be kept.
  clearErrors();
  clearTimeout(retryTimer);
  retryTimer = null;
  if (connection) {
    try { connection.close(); } catch {}
  }
  // Asked for, so the reload goes straight to HA's login, not "Signed out".
  // And never reload onto a spent ?code= — see authenticate().
  clearLoginRedirectStamp();
  stripAuthCallback();
  window.location.reload();
}

/* Rejections come back as something with a readable `.message` — see
   ha/errors.js for the two library shapes that didn't have one. */
export function sendWsMessage(message) {
  if (!connection) return Promise.reject(new Error("Not connected"));
  return connection.sendMessagePromise(message).catch((err) => {
    console.warn("[ha-ws] sendMessagePromise failed", message.type, err);
    throw toHaError(err);
  });
}

/* Resolves once the socket is live, rejects after `timeoutMs`. It used to have
   neither a timeout nor a rejection: with HA unreachable the promise stayed
   pending forever and its listener stayed in `connectionListeners` for good —
   useStatistics adds one every 10 minutes. */
export function waitForConnection(timeoutMs = 15000) {
  if (connectionStatus === "ready" && connection) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let unsub = null;
    let done = false;
    const finish = (settle, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (unsub) unsub();
      settle(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("HA connection timed out")),
      timeoutMs,
    );
    // onConnectionChange calls back synchronously with the current status, i.e.
    // before `unsub` exists — hence the `done` flag and the cleanup below.
    unsub = onConnectionChange((s) => {
      if (s === "ready" && connection) finish(resolve);
    });
    if (done) unsub();
  });
}

/* Auto-connect on first import. */
if (typeof window !== "undefined") {
  window.addEventListener("online", retryNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryNow();
  });
  setup();
}
