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
*/

import {
  createConnection,
  getAuth,
  subscribeEntities,
} from "home-assistant-js-websocket";
import { clearSpotifyToken } from "./spotify.js";
import { logError, clearErrors } from "../lib/errorLog.js";

const HA_URL = import.meta.env.VITE_HA_URL || "";
const TOKENS_KEY = "ha_tokens";

/* Module-level state */
const states = new Map();              // entity_id -> state object
const subscribers = new Map();         // entity_id -> Set<callback>
const connectionListeners = new Set(); // callbacks for connection status
const statesListeners = new Set();     // callbacks for "states set changed" (size/keys)
const snapshotListeners = new Set();   // one-shot callbacks for first entity snapshot
let connection = null;
let auth = null;
let connectionStatus = "disconnected"; // "disconnected" | "connecting" | "authenticating" | "ready"
let snapshotReceived = false;

function setStatus(next) {
  if (connectionStatus === next) return;
  connectionStatus = next;
  connectionListeners.forEach((cb) => cb(next));
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

/* Remove the last occurrence of a repeated query param, keeping the earlier ones. */
function dropLastParam(params, name) {
  const all = params.getAll(name);
  if (all.length === 0) return;
  params.delete(name);
  all.slice(0, -1).forEach((v) => params.append(name, v));
}

async function setup() {
  if (!HA_URL) {
    console.warn("[ha-ws] VITE_HA_URL not set — cannot connect");
    setStatus("disconnected");
    return;
  }

  setStatus("connecting");
  try {
    auth = await getAuth({
      hassUrl: HA_URL,
      saveTokens,
      loadTokens,
    });
  } catch (err) {
    // getAuth either resolves with an Auth, or redirects to HA login (no resolve).
    // We only land here on hard errors (network down, HA unreachable, etc.).
    console.warn("[ha-ws] getAuth failed", err);
    logError({
      source: "connection",
      message: "Home Assistant sign-in failed",
      detail: err?.message || String(err),
    });
    setStatus("disconnected");
    return;
  }

  // Clean HA OAuth callback params only. A Spotify callback that lands while we
  // have no HA tokens gets carried through HA's login round trip (the library
  // builds its redirect URI from the current query string), so the URL can hold
  // two code/state pairs — and `delete` removes every occurrence. HA appends its
  // own last, so drop only the last of each and leave Spotify's alone.
  if (window.location.search.includes("auth_callback=")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("auth_callback");
    dropLastParam(url.searchParams, "code");
    dropLastParam(url.searchParams, "state");
    window.history.replaceState(null, "", url.toString());
  }

  setStatus("authenticating");
  try {
    connection = await createConnection({ auth });
  } catch (err) {
    console.warn("[ha-ws] createConnection failed", err);
    logError({
      source: "connection",
      message: "WebSocket connection failed",
      detail: err?.message || String(err),
    });
    setStatus("disconnected");
    return;
  }

  connection.addEventListener("ready", () => setStatus("ready"));
  /* Drops are recorded, not announced. The chip in the topbar is the live
     signal; this is the record you read afterwards to find out that the Pi
     dropped eleven times at 3am. errorLog dedupes a burst of identical
     entries, so a reconnect storm can't flush the buffer. */
  connection.addEventListener("disconnected", () => {
    logError({ source: "connection", message: "Home Assistant WebSocket disconnected" });
    setStatus("disconnected");
  });
  connection.addEventListener("reconnect-error", () => {
    logError({ source: "connection", message: "Home Assistant WebSocket reconnect failed" });
    setStatus("disconnected");
  });

  subscribeEntities(connection, applyEntities);
  setStatus("ready");
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
  states.clear();
  snapshotReceived = false;
  setup();
}

/* OAuth-specific extras */

/* The only token getter. There used to be a synchronous `getAccessToken()`
   beside this one that handed out `auth.accessToken` without checking expiry —
   the WS library only refreshes at connect time, so REST callers that picked it
   started 401ing ~30 minutes in while the socket still read "live". */
export async function getFreshAccessToken() {
  if (!auth) return null;
  if (auth.expired) {
    await auth.refreshAccessToken();
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
  if (connection) {
    try { connection.close(); } catch {}
  }
  window.location.reload();
}

export function sendWsMessage(message) {
  if (!connection) return Promise.reject(new Error("Not connected"));
  return connection.sendMessagePromise(message).catch((err) => {
    console.warn("[ha-ws] sendMessagePromise failed", message.type, err);
    throw err;
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
if (typeof window !== "undefined") setup();
