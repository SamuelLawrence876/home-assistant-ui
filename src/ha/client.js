/* Thin HTTP client for Home Assistant REST API.
   Reads are usually better served by the WebSocket (live state),
   but service calls + image URLs + bootstrap go through here. */

/* Resolution order: localStorage overrides → Vite env vars → empty.
   localStorage wins so users of the deployed app can paste their own
   URL + token without a rebuild. */
export const getHAConfig = () => ({
  url:
    (typeof localStorage !== "undefined" && localStorage.getItem("ha_url")) ||
    import.meta.env.VITE_HA_URL ||
    "",
  token:
    (typeof localStorage !== "undefined" && localStorage.getItem("ha_token")) ||
    import.meta.env.VITE_HA_TOKEN ||
    "",
});

export const haConfigured = () => {
  const { url, token } = getHAConfig();
  return Boolean(url && token);
};

const headers = () => ({
  Authorization: `Bearer ${getHAConfig().token}`,
  "Content-Type": "application/json",
});

async function req(path, init = {}) {
  const { url: URL } = getHAConfig();
  if (!URL) throw new Error("HA URL not configured");
  const res = await fetch(`${URL}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
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
    return await req(`/api/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(target ? { ...data, ...target } : data),
    });
  } catch (e) {
    errorListeners.forEach((cb) => cb({ domain, service, data, error: e }));
    throw e;
  }
};

/* HA proxies images (for entities of type `image`). Use this for the Bambu cover. */
export const imageUrl = (entityId, ts) => {
  const { url, token } = getHAConfig();
  return `${url}/api/image_proxy/${entityId}${ts ? `?t=${encodeURIComponent(ts)}` : ""}&token=${encodeURIComponent(token)}`;
};

/* Get forecasts via the modern service (HA changed this in 2024 — legacy `forecast` attribute is gone). */
export async function getForecast(entityId, type = "daily") {
  const res = await req(`/api/services/weather/get_forecasts?return_response`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId, type }),
  });
  return res?.service_response?.[entityId]?.forecast || [];
}

export const haUrl = () => getHAConfig().url;
export const haToken = () => getHAConfig().token;
