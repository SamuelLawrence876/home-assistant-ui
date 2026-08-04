/* Spotify Web API client + PKCE OAuth.

   This module is imported eagerly (main.jsx, and socket.js for signOut), so
   everything it does at load time must be cheap and must not throw: with no
   Spotify callback in the URL the handler at the bottom resolves `false` after
   two guarded localStorage reads, with no network and no rejection. */

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = typeof window !== "undefined" ? `${window.location.origin}/` : "";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-read-recently-played",
].join(" ");

const TOKEN_KEY = "gh_spotify_token";
const VERIFIER_KEY = "gh_spotify_verifier";
const STATE_KEY = "gh_spotify_state";     // per-request CSRF nonce
const PENDING_KEY = "gh_spotify_pending"; // authorization code captured, not yet exchanged

const SPOTIFY_KEYS = [TOKEN_KEY, VERIFIER_KEY, STATE_KEY, PENDING_KEY];

/* localStorage can throw (Safari private mode, quota, blocked storage) —
   every access goes through these so a storage failure never breaks a render. */
function readKey(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeKey(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn("[spotify] storage write failed", key, e); }
}

function dropKey(key) {
  try { localStorage.removeItem(key); } catch { /* nothing we can do */ }
}

function loadToken() {
  try { return JSON.parse(readKey(TOKEN_KEY)); } catch { return null; }
}

function saveToken(t) {
  writeKey(TOKEN_KEY, JSON.stringify(t));
}

/* Drops every Spotify credential this app owns — used by the Disconnect button
   and by socket.js signOut(). Spotify publishes no token-revocation endpoint,
   so removing the local copy is all we can do. */
export function clearSpotifyToken() {
  SPOTIFY_KEYS.forEach(dropKey);
}

export function isSpotifyConfigured() {
  return Boolean(CLIENT_ID);
}

export function isSpotifyConnected() {
  const t = loadToken();
  return Boolean(t?.access_token);
}

function sha256(plain) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr.buffer);
}

async function generateChallenge() {
  const verifier = randomToken(64);
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

export async function startSpotifyAuth() {
  if (!CLIENT_ID) return;
  const { verifier, challenge } = await generateChallenge();
  // `state` is a fresh nonce per request, not the old fixed "spotify" literal:
  // it binds this response to this request, and lets the callback tell our
  // params apart from HA's (which are also called code/state).
  const state = randomToken(16);
  writeKey(VERIFIER_KEY, verifier);
  writeKey(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

/* Remove one occurrence of a repeated query param, keeping the others. */
function removeParamAt(params, name, idx) {
  const all = params.getAll(name);
  params.delete(name);
  all.forEach((v, i) => { if (i !== idx) params.append(name, v); });
}

/* Pull our own `code` out of the URL and clean the URL immediately.

   Runs synchronously at module load so the tab is already "media" by the time
   App reads the query string, and so HA's OAuth flow — which carries the whole
   query string through its own redirect — can't sweep our params away with its
   own. The code is parked in localStorage until the exchange succeeds, so a
   network blip retries on the next load instead of dead-ending. */
function captureCallback() {
  const expected = readKey(STATE_KEY);
  if (!expected) return null;
  const url = new URL(window.location.href);
  const idx = url.searchParams.getAll("state").indexOf(expected);
  if (idx === -1) return null;

  const code = url.searchParams.getAll("code")[idx];
  dropKey(STATE_KEY);
  removeParamAt(url.searchParams, "code", idx);
  removeParamAt(url.searchParams, "state", idx);
  url.searchParams.set("tab", "media");
  window.history.replaceState(null, "", url.toString());

  if (!code) {
    // Spotify bounced us back without a code (user hit Cancel) — the verifier
    // is spent either way.
    console.warn("[spotify] authorize returned no code", url.searchParams.get("error") || "");
    dropKey(VERIFIER_KEY);
    return null;
  }
  writeKey(PENDING_KEY, code);
  return code;
}

let callbackError = null;

/* null | "network" (retryable, we keep the code) | "rejected" (start over). */
export function getSpotifyCallbackError() {
  return callbackError;
}

async function exchangeCode(code) {
  const verifier = readKey(VERIFIER_KEY);
  if (!verifier) {
    console.warn("[spotify] callback has no PKCE verifier — connect again");
    callbackError = "rejected";
    dropKey(PENDING_KEY);
    return false;
  }

  let res;
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
  } catch (e) {
    // Offline / DNS: the code is still good, keep it for the next load.
    console.warn("[spotify] token exchange failed (network) — will retry on next load", e);
    callbackError = "network";
    return false;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[spotify] token exchange failed ${res.status} ${body.slice(0, 200)}`);
    callbackError = res.status >= 500 ? "network" : "rejected";
    if (res.status < 500) { dropKey(PENDING_KEY); dropKey(VERIFIER_KEY); }
    return false;
  }

  const data = await res.json().catch(() => null);
  if (!data?.access_token) {
    console.warn("[spotify] token exchange returned no access_token");
    callbackError = "rejected";
    dropKey(PENDING_KEY);
    dropKey(VERIFIER_KEY);
    return false;
  }
  saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
  callbackError = null;
  dropKey(PENDING_KEY);
  dropKey(VERIFIER_KEY);
  return true;
}

export async function handleSpotifyCallback() {
  if (typeof window === "undefined" || !CLIENT_ID) return false;
  const code = captureCallback() || readKey(PENDING_KEY);
  if (!code) return false;
  return exchangeCode(code);
}

let refreshInflight = null;

/* One shared refresh for all callers. Three Spotify cards mount together and
   each used to POST the same refresh token; Spotify rotates refresh tokens on
   PKCE, so the losers got a 400 and wiped the winner's brand-new token. */
function refreshToken() {
  if (!refreshInflight) {
    refreshInflight = doRefresh().finally(() => { refreshInflight = null; });
  }
  return refreshInflight;
}

async function doRefresh() {
  const t = loadToken();
  if (!t?.refresh_token) return null;
  let res;
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
      }),
    });
  } catch (e) {
    // Transient — dropping the refresh token here would force a full re-login
    // just because the wifi blinked.
    console.warn("[spotify] refresh failed (network), keeping credentials", e);
    return null;
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) clearSpotifyToken();
    else console.warn(`[spotify] refresh failed ${res.status}, keeping credentials`);
    return null;
  }
  const data = await res.json();
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || t.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveToken(next);
  return next.access_token;
}

async function getToken() {
  const t = loadToken();
  if (!t) return null;
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  return refreshToken();
}

/* One 401 means the access token lapsed, not that the account is gone — refresh
   and retry once before treating it as a disconnect. */
async function spotifyFetch(path, init = {}, allowRetry = true) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (res.status !== 401) return res;
  if (allowRetry && (await refreshToken())) return spotifyFetch(path, init, false);
  clearSpotifyToken();
  throw new Error("Token expired");
}

async function spotifyApi(path) {
  const res = await spotifyFetch(path);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

async function spotifyPut(path, body) {
  const res = await spotifyFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) throw new Error(`Spotify ${res.status}`);
}

export async function getPlaylists(limit = 20) {
  const data = await spotifyApi(`/me/playlists?limit=${limit}`);
  return (data?.items || []).map((p) => ({
    id: p.id,
    name: p.name,
    uri: p.uri,
    image: p.images?.[0]?.url || null,
    tracks: p.tracks?.total || 0,
    owner: p.owner?.display_name || "",
  }));
}

export async function getCurrentPlayback() {
  return spotifyApi("/me/player");
}

export async function getRecentlyPlayed(limit = 10) {
  const data = await spotifyApi(`/me/player/recently-played?limit=${limit}`);
  return (data?.items || []).map((i) => ({
    name: i.track.name,
    artist: i.track.artists?.map((a) => a.name).join(", ") || "",
    album: i.track.album?.name || "",
    image: i.track.album?.images?.[0]?.url || null,
    uri: i.track.uri,
    contextUri: i.context?.uri || null,
  }));
}

export async function getDevices() {
  const data = await spotifyApi("/me/player/devices");
  return data?.devices || [];
}

export async function playUri(uri, deviceId) {
  const isTrack = uri.startsWith("spotify:track:");
  const body = isTrack ? { uris: [uri] } : { context_uri: uri };
  const qs = deviceId ? `?device_id=${deviceId}` : "";
  await spotifyPut(`/me/player/play${qs}`, body);
}

export async function searchTracks(query, limit = 15) {
  if (!query.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const data = await spotifyApi(`/search?q=${q}&type=track&limit=${limit}`);
  return (data?.tracks?.items || []).map((t) => ({
    name: t.name,
    artist: t.artists?.map((a) => a.name).join(", ") || "",
    album: t.album?.name || "",
    image: t.album?.images?.[0]?.url || null,
    uri: t.uri,
  }));
}

export async function getQueue() {
  const data = await spotifyApi("/me/player/queue");
  if (!data) return { current: null, queue: [] };
  const mapTrack = (t) => ({
    name: t.name,
    artist: t.artists?.map((a) => a.name).join(", ") || "",
    album: t.album?.name || "",
    image: t.album?.images?.[0]?.url || null,
    uri: t.uri,
  });
  return {
    current: data.currently_playing ? mapTrack(data.currently_playing) : null,
    queue: (data.queue || []).slice(0, 20).map(mapTrack),
  };
}

export async function transferPlayback(deviceId) {
  await spotifyPut("/me/player", { device_ids: [deviceId], play: false });
}

/* Process the Spotify OAuth callback at module load, before React mounts.
   main.jsx imports this module eagerly — it used to live only in the lazily
   loaded Media chunk, and Spotify redirects to "/" (Overview), so the exchange
   never ran. Resolves boolean; the `.catch` keeps a module-scope promise from
   ever becoming an unhandled rejection. */
export const callbackReady = handleSpotifyCallback().catch((e) => {
  console.warn("[spotify] callback handler crashed", e);
  callbackError = "rejected";
  return false;
});
