const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = `${window.location.origin}/`;
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

function loadToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}

function saveToken(t) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearSpotifyToken() {
  localStorage.removeItem(TOKEN_KEY);
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

async function generateChallenge() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  const verifier = base64url(arr.buffer);
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

export async function startSpotifyAuth() {
  if (!CLIENT_ID) return;
  const { verifier, challenge } = await generateChallenge();
  localStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: "spotify",
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function handleSpotifyCallback() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("state") !== "spotify") return false;
  const code = url.searchParams.get("code");
  if (!code) return false;

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) return false;
  localStorage.removeItem(VERIFIER_KEY);

  const res = await fetch("https://accounts.spotify.com/api/token", {
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

  if (!res.ok) return false;
  const data = await res.json();
  saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.set("tab", "media");
  window.history.replaceState(null, "", url.toString());
  return true;
}

async function refreshToken() {
  const t = loadToken();
  if (!t?.refresh_token) return null;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }),
  });
  if (!res.ok) { clearSpotifyToken(); return null; }
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

async function spotifyApi(path) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearSpotifyToken();
    throw new Error("Token expired");
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

async function spotifyPut(path, body) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearSpotifyToken(); throw new Error("Token expired"); }
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
  const token = await getToken();
  if (!token) return;
  await fetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
}

// Process Spotify OAuth callback at module load time (before React mounts).
export const callbackReady = handleSpotifyCallback();
