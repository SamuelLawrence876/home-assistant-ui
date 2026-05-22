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
     getAccessToken()                -> string | null   (auto-refreshing)
     getHaUrl()                      -> string
     signOut()                       -> revokes tokens + reloads
*/

import {
  createConnection,
  getAuth,
  subscribeEntities,
} from "home-assistant-js-websocket";

const HA_URL = import.meta.env.VITE_HA_URL || "";
const TOKENS_KEY = "ha_tokens";

/* Module-level state */
const states = new Map();              // entity_id -> state object
const subscribers = new Map();         // entity_id -> Set<callback>
const connectionListeners = new Set(); // callbacks for connection status
let connection = null;
let auth = null;
let connectionStatus = "disconnected"; // "disconnected" | "connecting" | "authenticating" | "ready"

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
  // `entities` is HassEntities: Record<entity_id, HassEntity>.
  // The library delivers diffs after the first full snapshot — each call
  // gives the new state for any entity that changed.
  for (const [id, state] of Object.entries(entities)) {
    states.set(id, state);
    notify(id);
  }
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
    setStatus("disconnected");
    return;
  }

  // Clean OAuth callback params from the URL so a reload doesn't re-exchange.
  if (window.location.search.includes("auth_callback=") || window.location.search.includes("code=")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("auth_callback");
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState(null, "", url.toString());
  }

  setStatus("authenticating");
  try {
    connection = await createConnection({ auth });
  } catch (err) {
    console.warn("[ha-ws] createConnection failed", err);
    setStatus("disconnected");
    return;
  }

  connection.addEventListener("ready", () => setStatus("ready"));
  connection.addEventListener("disconnected", () => setStatus("disconnected"));
  // "reconnect-error" surfaces if the library can't reconnect after retries.
  connection.addEventListener("reconnect-error", () => setStatus("disconnected"));

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

export function getConnectionStatus() {
  return connectionStatus;
}

export function reconnect() {
  if (connection) {
    try { connection.close(); } catch {}
    connection = null;
  }
  states.clear();
  setup();
}

/* OAuth-specific extras */

export function getAccessToken() {
  return auth?.accessToken ?? null;
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
  if (connection) {
    try { connection.close(); } catch {}
  }
  window.location.reload();
}

/* Auto-connect on first import. */
if (typeof window !== "undefined") setup();
