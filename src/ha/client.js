/* Thin HTTP client for Home Assistant REST API.
   Reads are usually better served by the WebSocket (live state),
   but service calls + image URLs + bootstrap go through here.

   URL + token now come from the WebSocket layer, which owns the OAuth
   flow via home-assistant-js-websocket. The library refreshes access
   tokens automatically — callers always get a fresh one. */

import { ERR_CONNECTION_LOST } from "home-assistant-js-websocket";
import {
  getConnectionStatus,
  getEntity,
  getFreshAccessToken,
  getHaUrl,
  sendWsMessage,
  waitForConnection,
} from "./socket.js";
import { describeHaError } from "./errors.js";
import { logError } from "../lib/errorLog.js";

/* Is the app pointed at a real HA instance? (mock-mode builds set VITE_HA_URL="") */
export const haConfigured = () => Boolean(getHaUrl());

async function req(path, init = {}) {
  const url = getHaUrl();
  if (!url) throw new Error("HA URL not configured");
  const token = await getFreshAccessToken();
  const hdrs = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) };
  const res = await fetch(`${url}${path}`, { ...init, headers: hdrs });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Recorded, then thrown exactly as before — logging observes, it does not
    // change what the caller sees. The path is logged, never `hdrs`, which
    // holds the bearer token.
    logError({
      source: "rest",
      message: `HA ${init.method || "GET"} ${path} → ${res.status}`,
      detail: body.slice(0, 300),
    });
    throw new Error(`HA ${init.method || "GET"} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const getState = (entityId) => req(`/api/states/${entityId}`);
export const getAllStates = () => req(`/api/states`);

const errorListeners = new Set();
export function onServiceError(cb) { errorListeners.add(cb); return () => errorListeners.delete(cb); }

/* Did a call that failed with "connection lost" actually go out first?

   The library rejects with ERR_CONNECTION_LOST in two situations that mean
   opposite things: as a bare `3` when it refused to send because the socket
   was already down, and as a failed result frame for a command that was in
   flight when the socket closed. sendWsMessage folds both into one
   Error{code: 3} (errors.js#toHaError), so for that shape the connection
   status stands in: an in-flight command is rejected in the same tick the
   library announces the drop, so the status has already left "ready" by the
   time we get here, whereas a send refused into a socket that is closing but
   not yet closed happens before that announcement. `wasReady` rules out a
   call made while the socket was plainly down. When in doubt this answers
   no: a false "failed" toast is the old behaviour, a false "restarting" is a
   lie. */
function sentBeforeDrop(e, wasReady) {
  if (!wasReady || e === ERR_CONNECTION_LOST) return false;
  if (e?.type === "result" && e.error?.code === ERR_CONNECTION_LOST) return true;
  return e?.code === ERR_CONNECTION_LOST && getConnectionStatus() !== "ready";
}

/* `options.expectDisconnect`: for the calls whose job is to take Home
   Assistant down — homeassistant.restart, hassio.host_reboot, and the Core /
   OS / Supervisor update.install. HA drops the WebSocket before it answers,
   so the call is rejected with "connection lost" when it almost certainly
   worked; it used to land in the error log and toast "failed". With the
   option, that one rejection resolves to `{ connectionLost: true }` instead
   — sent, and Home Assistant went away — and is neither logged nor
   broadcast (socket.js logs the disconnect itself). Every other failure,
   including a call that never left because the socket was already down, is
   logged and thrown exactly as without it. Never a default: on any other
   call a dropped connection is a real failure. */
export const callService = async (domain, service, data = {}, target = undefined, options = {}) => {
  const wasReady = Boolean(options?.expectDisconnect) && getConnectionStatus() === "ready";
  try {
    const serviceData = target ? { ...data, ...target } : data;
    return await sendWsMessage({
      type: "call_service",
      domain,
      service,
      service_data: serviceData,
    });
  } catch (e) {
    if (sentBeforeDrop(e, wasReady)) return { connectionLost: true };
    /* Only the entity id goes in, not the whole service_data payload —
       service data is arbitrary and a caller could put anything in it.
       describeHaError, not `e.message || String(e)`: with the socket down
       that read "3", or "[object Object]" (ha/errors.js). */
    const message = describeHaError(e);
    logError({
      source: "service",
      message: `${domain}.${service} failed`,
      detail: [data?.entity_id, message].filter(Boolean).join(" · "),
      stack: e?.stack || null,
    });
    errorListeners.forEach((cb) => cb({ domain, service, data, error: e, message }));
    throw e;
  }
};

/* HA proxies images (for entities of type `image`). Use this for the Bambu cover.

   HA publishes the signed path on the entity itself — `entity_picture` already
   carries that entity's own short-lived, single-path token, which is what
   HA's ImageView actually checks. We used to paste the OAuth *bearer* into the
   query string instead: full API access, written into CloudFront's and HA's
   access logs, readable from the DOM, and dead after 30 minutes.

   Returns null when the entity isn't in the state map yet; both callers already
   render a placeholder for that. `ts` (the entity's last_updated) busts the
   browser cache when the picture changes. */
export const imageUrl = (entityId, ts) => {
  const base = getHaUrl();
  const picture = getEntity(entityId)?.attributes?.entity_picture;
  if (!base || !picture) return null;
  const bust = ts ? `${picture.includes("?") ? "&" : "?"}t=${encodeURIComponent(ts)}` : "";
  return picture.startsWith("http") ? `${picture}${bust}` : `${base}${picture}${bust}`;
};

/* Get forecasts via the modern service (HA changed this in 2024 — legacy `forecast` attribute is gone). */
export async function getForecast(entityId, type = "daily") {
  const res = await sendWsMessage({
    type: "call_service",
    domain: "weather",
    service: "get_forecasts",
    service_data: { entity_id: entityId, type },
    return_response: true,
  });
  return res?.response?.[entityId]?.forecast || [];
}

/* Rejects unless Home Assistant really answered for this list. HA skips an
   unavailable entity instead of failing the call, so a list that is
   unavailable or gone comes back missing from the response — and that used to
   read as `[]`. "Empty" is a claim nobody checked: the Kanban showed a dead
   list as a 0 column and offered it as a move target. Missing is a failed
   read. */
export async function getTodoItems(entityId, status) {
  const data = { entity_id: entityId };
  if (status) data.status = status;
  const res = await sendWsMessage({
    type: "call_service",
    domain: "todo",
    service: "get_items",
    service_data: data,
    return_response: true,
  });
  const items = res?.response?.[entityId]?.items;
  if (!Array.isArray(items)) throw new Error(`todo.get_items: no answer for ${entityId}`);
  return items;
}

export async function browseMedia(entityId, mediaContentType, mediaContentId) {
  await waitForConnection();
  const msg = { type: "media_player/browse_media", entity_id: entityId };
  if (mediaContentType) msg.media_content_type = mediaContentType;
  if (mediaContentId) msg.media_content_id = mediaContentId;
  return sendWsMessage(msg);
}

export const haUrl = () => getHaUrl();
