/* Single shared HA WebSocket connection.
   On connect: authenticates, fetches all states, subscribes to state_changed events.
   Components subscribe via useEntity (see ./useEntity.js) — they get current state
   immediately + every future change.

   Protocol reference: https://developers.home-assistant.io/docs/api/websocket */

import { getHAConfig } from "./client.js";
const wsUrl = () => {
  const { url } = getHAConfig();
  return url ? url.replace(/^http/, "ws") + "/api/websocket" : null;
};

/* Module-level state */
const states = new Map();              // entity_id -> state object
const subscribers = new Map();         // entity_id -> Set<callback>
const connectionListeners = new Set(); // callbacks for connection status
let ws = null;
let msgId = 1;
let connectionStatus = "disconnected"; // "disconnected" | "connecting" | "authenticating" | "ready"
let reconnectDelay = 1000;
let reconnectTimer = null;

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

function handleStateChanged(event) {
  const { entity_id, new_state } = event.data;
  if (new_state === null) {
    states.delete(entity_id);
  } else {
    states.set(entity_id, new_state);
  }
  notify(entity_id);
}

export function connect() {
  const WS_URL = wsUrl();
  const { token: TOKEN } = getHAConfig();
  if (!WS_URL || !TOKEN) {
    console.info("[ha-ws] HA URL / token not configured — open the Settings drawer to connect");
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  setStatus("connecting");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("authenticating");
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    switch (data.type) {
      case "auth_required":
        ws.send(JSON.stringify({ type: "auth", access_token: getHAConfig().token }));
        break;

      case "auth_ok":
        reconnectDelay = 1000;
        bootstrap();
        break;

      case "auth_invalid":
        console.error("[ha-ws] auth_invalid — token rejected", data.message);
        setStatus("disconnected");
        ws.close();
        break;

      case "result":
        if (data.id === RESULT_IDS.getStates && data.success) {
          for (const s of data.result) {
            states.set(s.entity_id, s);
          }
          setStatus("ready");
          subscribers.forEach((_, entityId) => notify(entityId));
        }
        break;

      case "event":
        if (data.event?.event_type === "state_changed") {
          handleStateChanged(data.event);
        }
        break;
    }
  };

  ws.onclose = () => {
    setStatus("disconnected");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(30000, reconnectDelay * 2);
  };

  ws.onerror = (e) => {
    console.warn("[ha-ws] error", e);
  };
}

const RESULT_IDS = { getStates: 0, subscribeEvents: 0 };

function bootstrap() {
  RESULT_IDS.getStates = ++msgId;
  ws.send(JSON.stringify({ id: RESULT_IDS.getStates, type: "get_states" }));

  RESULT_IDS.subscribeEvents = ++msgId;
  ws.send(
    JSON.stringify({
      id: RESULT_IDS.subscribeEvents,
      type: "subscribe_events",
      event_type: "state_changed",
    }),
  );
}

/* Public API */

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
  if (!ws || ws.readyState === WebSocket.CLOSED) connect();
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

/* Disconnect + reconnect with new config — call after the Settings drawer saves new credentials. */
export function reconnect() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  states.clear();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectDelay = 1000;
  connect();
}

/* Auto-connect on first import (only if configured). */
if (typeof window !== "undefined") connect();
