/* Thin HTTP client for Home Assistant REST API.
   Reads are usually better served by the WebSocket (live state),
   but service calls + image URLs + bootstrap go through here.

   URL + token now come from the WebSocket layer, which owns the OAuth
   flow via home-assistant-js-websocket. The library refreshes access
   tokens automatically — callers always get a fresh one. */

import { getEntity, getFreshAccessToken, getHaUrl, sendWsMessage, waitForConnection } from "./socket.js";

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
    throw new Error(`HA ${init.method || "GET"} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const getState = (entityId) => req(`/api/states/${entityId}`);
export const getAllStates = () => req(`/api/states`);

const errorListeners = new Set();
export function onServiceError(cb) { errorListeners.add(cb); return () => errorListeners.delete(cb); }

export const callService = async (domain, service, data = {}, target = undefined) => {
  try {
    const serviceData = target ? { ...data, ...target } : data;
    return await sendWsMessage({
      type: "call_service",
      domain,
      service,
      service_data: serviceData,
    });
  } catch (e) {
    errorListeners.forEach((cb) => cb({ domain, service, data, error: e }));
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
  return res?.response?.[entityId]?.items || [];
}

export async function browseMedia(entityId, mediaContentType, mediaContentId) {
  await waitForConnection();
  const msg = { type: "media_player/browse_media", entity_id: entityId };
  if (mediaContentType) msg.media_content_type = mediaContentType;
  if (mediaContentId) msg.media_content_id = mediaContentId;
  return sendWsMessage(msg);
}

export const haUrl = () => getHaUrl();
