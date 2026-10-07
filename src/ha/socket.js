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
     hasSnapshot() / onSnapshotReady(cb) -> has HA sent its full set on THIS connection
     hasSnapshot(id)                 -> ...and isn't HA maybe still loading this one (heldBack.js)
     getLoadingIds()                 -> every id HA may still be loading, for domain/set readers

   New exports for the OAuth refactor:
     getFreshAccessToken()           -> Promise<string | null>  (refreshes if expired)
     getHaUrl()                      -> string
     signOut()                       -> clears this device, revokes (bounded), reloads;
                                        other open tabs follow (see onStorage)
     isSigningOut()                  -> from either until the reload

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
import {
  announceLoginRedirect,
  clearLoginRedirectStamp,
  hasAuthCallback,
  mayRedirectToLogin,
  reloadPage,
  revokeRefreshToken,
  stripAuthCallback,
} from "./loginRedirect.js";
import { logError } from "../lib/errorLog.js";
import { createHeldBack } from "./heldBack.js";
import { TOKENS_KEY, checkSession, clearAfterSignOutElsewhere, clearDevice, clearDeviceAgain, followsElsewhere, loadTokens, lockDevice } from "./session.js";

const HA_URL = import.meta.env.VITE_HA_URL || "";
// getAuth strips one trailing slash before comparing stored tokens' hassUrl.
const HA_BASE = HA_URL.endsWith("/") ? HA_URL.slice(0, -1) : HA_URL;

/* Module-level state */
const states = new Map();              // entity_id -> state object
const subscribers = new Map();         // entity_id -> Set<callback>
const connectionListeners = new Set(); // callbacks for connection status
const statesListeners = new Set();     // callbacks for "states set changed" (size/keys)
const snapshotListeners = new Set();   // one-shot callbacks for the next entity snapshot
const sessionListeners = new Set();    // callbacks for "signed out" on/off
let connection = null;
let auth = null;
let connectionStatus = "disconnected"; // "disconnected" | "connecting" | "authenticating" | "ready"
/* True once HA has sent its complete set on the CURRENT connection. A drop
   sets it false again — before the status change that announces the drop, so
   a status listener reading hasSnapshot() already sees it — and the first
   batch on the next connection sets it back. */
let snapshotReceived = false;
let sessionExpired = false;
let signingOut = false;

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

/* After a drop the library still hands over its pre-drop copy of an entity
   HA hasn't sent again — one it no longer has, or hasn't loaded yet. That
   copy is held back as absent (heldBack.js has the whole story), and while
   HA may still be loading it, hasSnapshot(id) says so. */
const heldBack = createHeldBack(() => statesListeners.forEach((cb) => cb()));

function applyEntities(entities) {
  const first = !snapshotReceived;
  for (const [id, state] of Object.entries(entities)) {
    if (heldBack.holds(id, state, first)) continue;
    states.set(id, state);
    notify(id);
  }
  heldBack.handedOver(entities);
  /* Anything else we hold that HA doesn't have — deleted, renamed, an update.*
     whose add-on was uninstalled, or held back above — goes, and its
     subscribers hear it is gone, so useEntityStatus stops calling the last
     state live: "not_found", or "loading" while it is held back. */
  for (const id of [...states.keys()]) {
    if (!Object.hasOwn(entities, id) || heldBack.has(id)) {
      states.delete(id);
      notify(id);
    }
  }
  if (first) {
    snapshotReceived = true;
    snapshotListeners.forEach((cb) => cb());
    snapshotListeners.clear();
  }
  statesListeners.forEach((cb) => cb());
}

const saveTokens = (data) => {
  // Signing out: a refresh still in flight must not write the session back.
  if (data && signingOut) return;
  try {
    if (data) localStorage.setItem(TOKENS_KEY, JSON.stringify(data));
    else localStorage.removeItem(TOKENS_KEY);
  } catch (e) {
    console.warn("[ha-ws] saveTokens failed", e);
  }
};

/* Rate-limited login redirects and OAuth callback-param cleanup live in
   loginRedirect.js; the one place a redirect can be vetoed is here. */
const SIGNED_OUT = Symbol("signed-out");

/* getAuth calls loadTokens as its last step before redirecting, and only
   redirects when there is nothing usable — so this is the one place a
   redirect can be vetoed. Throwing here rejects getAuth with SIGNED_OUT
   instead of navigating. */
const loadTokensOrGate = async () => {
  const data = await loadTokens();
  if (data && data.hassUrl === HA_BASE) return data;
  if (!mayRedirectToLogin()) throw SIGNED_OUT;
  announceLoginRedirect();
  leftForLogin = true;
  return data;
};

/* getAuth is about to navigate to HA's login, and the promise it returns
   never settles — so setupRunning stays true for good. Fine while the page is
   leaving; not when Back brings it out of the back/forward cache, which used
   to sit on "connecting" with nothing able to try again (even "Sign in" waits
   on setupRunning). The pageshow handler at the bottom starts it over. */
let leftForLogin = false;

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
      // A 400/403 here is HA turning down the code, not a session expiring:
      // there is no session yet.
      detail: err === ERR_INVALID_AUTH ? "Home Assistant rejected the sign-in code" : describeHaError(err),
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
   login page (or, rate-limited, to "Signed out"). And the Spotify token with
   them, as Sign out does: HA ending the session — a refresh token revoked in
   HA's profile page, or one that lapsed — is how a lost or handed-on device
   gets signed out, and it used to stay a working remote for Sam's Spotify. */
function dropSession() {
  saveTokens(null);
  auth = null;
  stripAuthCallback();
  try { clearSpotifyToken(); } catch {}
}

/* createConnection, with an invalid-auth refusal checked before it is
   believed. Resolves to a Connection, or to connectOnce's outcome string. */
async function openConnection() {
  /* A token already known to be expired is renewed first, never sent. Left to
     the library, a failing /auth/token means the stale token goes out anyway on
     every retry — and HA logs each one as a failed login (and counts it toward
     an IP ban, if one is set), for as long as the refresh keeps failing. */
  if (auth.expired) {
    const session = await checkSession(auth);
    if (session.dead) {
      logError({ source: "connection", message: "Home Assistant session expired" });
      return "relogin";
    }
    if (!session.alive) return connectFailed("Could not renew the Home Assistant session", session.err);
  }
  try {
    return await createConnection({ auth });
  } catch (err) {
    if (err !== ERR_INVALID_AUTH) return connectFailed("WebSocket connection failed", err);
  }
  const session = await checkSession(auth);
  if (session.dead) {
    logError({ source: "connection", message: "Home Assistant session expired" });
    return "relogin";
  }
  // Couldn't tell: keep the tokens and try again later, as for a Pi that's down.
  if (!session.alive) return connectFailed("Could not renew the Home Assistant session", session.err);
  // Renewed, so it was the stale token that was refused. Try the fresh one
  // now — once. HA refusing a token it has only just issued isn't a dead
  // refresh token either, so that backs off too rather than looping here.
  try {
    return await createConnection({ auth });
  } catch (err) {
    return connectFailed(
      "WebSocket connection failed",
      err === ERR_INVALID_AUTH ? "Home Assistant refused a token it had just issued" : err,
    );
  }
}

async function connectOnce() {
  if (retryAttempt === 0) setStatus("connecting");
  try {
    auth = await authenticate();
  } catch (err) {
    if (err === SIGNED_OUT) return "signed_out";
    return connectFailed("Home Assistant sign-in failed", err);
  }
  /* Sign out (here or in another tab) while authenticate() above or
     openConnection() below was in flight: what came back belongs to the
     session that ended. It used to land anyway — the session back in memory,
     the connection kept and "ready" over the "Signing out…" chip (D7). Closed
     and dropped instead, and setup() stands down too. */
  if (signingOut) { auth = null; return "stopped"; }

  if (retryAttempt === 0) setStatus("authenticating");
  const conn = await openConnection();
  if (signingOut) { if (typeof conn !== "string") conn.close(); return "stopped"; }
  if (typeof conn === "string") return conn;

  connection = conn;
  retryAttempt = 0;
  /* The library's own reconnect doesn't look at close() once its new socket
     is opening: one that finished after Sign out closed this connection
     resubscribed and fired "ready" — the chip read live, every card had live
     controls, over the old session's open socket (D7). Not ours any more:
     closed again, for good this time, and never "ready". */
  conn.addEventListener("ready", () => (conn === connection ? setStatus("ready") : conn.close()));
  /* Drops are recorded, not announced. The chip in the topbar is the live
     signal; this is the record you read afterwards to find out that the Pi
     dropped eleven times at 3am. errorLog dedupes a burst of identical
     entries, so a reconnect storm can't flush the buffer. */
  conn.addEventListener("disconnected", () => {
    snapshotReceived = false; // see applyEntities
    logError({ source: "connection", message: "Home Assistant WebSocket disconnected" });
    setStatus("disconnected");
  });
  /* The library fires this for ERR_INVALID_AUTH only, and then stops
     reconnecting for good — the chip used to read "Pi offline" forever for
     what was really an expired or revoked session. It is no more proof of a
     dead session than the same error on first connect (session.js#checkSession), so
     start over and let openConnection ask /auth/token before anything is
     forgotten; it logs whichever way that goes. */
  conn.addEventListener("reconnect-error", (_conn, err) => {
    snapshotReceived = false;
    setStatus("disconnected");
    try { conn.close(); } catch {}
    if (connection === conn) connection = null;
    if (err === ERR_INVALID_AUTH) {
      setup();
    } else {
      logError({
        source: "connection",
        message: "Home Assistant WebSocket reconnect failed",
        detail: describeHaError(err),
      });
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
  if (setupRunning || connection || sessionExpired || signingOut) return;
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

  if (signingOut) return; // signed out while it ran: nothing to retry, end or redo
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
   to every entity individually — and once more when a held-back entity's
   wait runs out (heldBack.js), or Sign out closes the socket (closeForSignOut),
   with no entity changed. */
export function onStatesChanged(callback) {
  statesListeners.add(callback);
  return () => statesListeners.delete(callback);
}

export function getConnectionStatus() {
  return connectionStatus;
}

/* Whether HA has sent its complete set on the current connection — false
   from a drop until the first batch after the reconnect. Given an entity id,
   also false while that entity is held back and still waiting: that set left
   it out, but this page had it before the drop, and HA may still be loading
   it (heldBack.js — for up to HELD_BACK_WAIT_MS). */
export function hasSnapshot(entityId) {
  return snapshotReceived && !heldBack.isWaiting(entityId);
}

/* Every id hasSnapshot(id) is false for on that account: held back and still
   waiting. getAllStates() leaves them out, so a reader of a whole domain or
   set would otherwise just see them gone — "No calendars", "✓ current",
   "offline" after every Restart HA. useEntity.js has the hooks over it. */
export function getLoadingIds() {
  return heldBack.waiting();
}

/* Calls back once, when the next snapshot lands (at once if one is in). */
export function onSnapshotReady(callback) {
  if (snapshotReceived) {
    callback();
    return () => {};
  }
  snapshotListeners.add(callback);
  return () => snapshotListeners.delete(callback);
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

/* Sign out clears this device first, synchronously, and only then asks HA to
   revoke the refresh token. It used to wait for /auth/revoke before touching
   anything, with no timeout: on a stalled request (HA mid-restart, a Pi that
   black-holes the Funnel, a dead spot) nothing local was cleared and the
   button quietly reset. Close the tab then, and the next person on a shared
   tablet opened Glasshouse signed in as Sam, Spotify and all. */
let signOutDone = null;

/* Nothing in this tab writes a credential or the error log again before the
   reload: saveTokens and setup() stand down here, and session.js#lockDevice
   stands Spotify's token writes and logError down (LESSONS.md pattern 5). */
function latchSignOut() {
  signingOut = true;
  lockDevice();
}

/* Closing it ourselves, the library fires no "disconnected": the status read
   "ready" and the snapshot stayed in for the whole revoke wait, so every card
   showed live controls over a closed socket. Marked the way a drop is —
   snapshot first, see applyEntities — until the reload. The states listeners
   hear it too: mid-reconnect the status is "disconnected" already, so
   setStatus tells nobody, and the chip kept reading "Pi offline" (D7). */
function closeForSignOut() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (connection) {
    try { connection.close(); } catch {}
    connection = null;
  }
  snapshotReceived = false;
  setStatus("disconnected");
  statesListeners.forEach((cb) => cb());
}

/* True from Sign out (here or in another tab) until the reload — for the
   chip, which would otherwise read "Pi offline" over the closed socket. It
   changes only with the status or a states tick (both above), so read it
   on either. */
export const isSigningOut = () => signingOut;

/* Resolves once the reload has been asked for; never rejects. */
export function signOut() {
  if (signOutDone) return signOutDone;
  latchSignOut();
  const session = auth?.data; // the refresh token outlives the clear, in memory only
  auth = null;
  clearDevice();
  closeForSignOut();
  // Asked for, so the reload goes straight to HA's login, not "Signed out".
  // And never reload onto a spent ?code= — see authenticate().
  clearLoginRedirectStamp();
  stripAuthCallback();
  // Bounded (loginRedirect.js): the reload goes ahead whatever HA says.
  signOutDone = revokeRefreshToken(session?.hassUrl, session?.refresh_token).then(() => {
    // Again, belt and braces: with the locks above nothing should have
    // written since, but this is the last chance to make sure — sparing a
    // session another tab has signed into since (session.js#clearDeviceAgain).
    clearDeviceAgain(session?.refresh_token);
    reloadPage();
  });
  return signOutDone;
}

/* Sign out in another Glasshouse tab or PWA window on this browser used to
   leave this one signed in: its socket, its tokens in memory — a refresh
   wrote ha_tokens straight back if the revoke hadn't landed — its error log,
   written back on its next entry, and its own Spotify refresh. The other tab
   removing ha_tokens is the signal (storage events fire in every tab but the
   one that made the change), and this tab does what Sign out does here, bar
   the revoke, which that tab has sent: latch, clear, reload. A tab with no
   session does the same for a Sign out — its log and Spotify module are still
   live, and only the reload ends their lock (session.js#followsElsewhere) —
   and the clear spares a newer session than this tab's
   (session.js#clearAfterSignOutElsewhere). */
function onStorage(e) {
  if (signingOut || !followsElsewhere(e, Boolean(auth))) return;
  const mine = auth?.data?.refresh_token;
  latchSignOut();
  auth = null;
  clearAfterSignOutElsewhere(mine);
  closeForSignOut();
  stripAuthCallback();
  reloadPage();
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
  /* Back from HA's login page can restore this page from the back/forward
     cache, still waiting on a trip it never finished (see leftForLogin). A
     reload re-reads the tokens: connected, a fresh login, or "Signed out". */
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && leftForLogin) reloadPage();
  });
  window.addEventListener("storage", onStorage);
  setup();
}
