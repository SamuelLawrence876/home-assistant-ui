/* This device's Home Assistant session, for socket.js: whether HA still
   honours it, and what ending it clears — here, and when another tab ends it.
   Its own file because socket.js is at its size limit; nothing but socket.js
   uses it. No module state: socket.js keeps the session itself. */
import { ERR_INVALID_AUTH } from "home-assistant-js-websocket";
import { clearSpotifyToken, lockSpotify } from "./spotify.js";
import { clearErrors, lockErrorLog } from "../lib/errorLog.js";

/* Where the session lives: one copy, shared by every Glasshouse tab on this
   browser. */
export const TOKENS_KEY = "ha_tokens";

/* The stored session, as getAuth's loadTokens option takes it (async;
   undefined for none or unreadable). */
export const loadTokens = async () => storedSession() ?? undefined;

function storedSession() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY));
  } catch {
    return null;
  }
}

/* ERR_INVALID_AUTH from createConnection only means the socket refused the
   access token it was handed — not that the session is dead. When that token
   has expired, the library starts a refresh before the socket opens and, if
   the refresh fails for any reason at all (a Funnel 502, a timeout), swallows
   the failure and sends the stale token anyway. Dropping the tokens on that
   put a wall tablet back on HA's password page after a refresh blip
   (LESSONS.md pattern 5). Only /auth/token answering 400/403 — which the
   library, and only the library, turns into ERR_INVALID_AUTH — says the
   refresh token itself is gone. So ask it, once, before forgetting anything. */
const REFRESH_TIMEOUT_MS = 15_000;

export async function checkSession(a) {
  /* Bounded: unlike createConnection — which HA ends by closing a socket that
     never authenticates — this fetch has nothing to stop it, and setupRunning
     would hold every retry off until a reload. A timeout is "couldn't tell". */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Token refresh timed out")), REFRESH_TIMEOUT_MS);
  });
  try {
    await Promise.race([a.refreshAccessToken(), timeout]);
    return { alive: true };
  } catch (err) {
    // Stored tokens with no refresh token can never be renewed, whatever HA says.
    return { dead: err === ERR_INVALID_AUTH || !a.data?.refresh_token, err };
  } finally {
    clearTimeout(timer);
  }
}

/* Set by a Sign out just before it removes the tokens, so another tab can
   tell a Sign out (clear the device) from HA ending the session in some tab's
   dropSession (keep the error log: it holds the "session expired" entry that
   says why). A tab with one window keeps the log in that case too. */
const SIGNED_OUT_KEY = "gh_signed_out_at";
const SIGNED_OUT_FRESH_MS = 60_000;

function signedOutJustNow() {
  try {
    // Hostile input, like everything read back from storage: only a real,
    // recent, past timestamp counts.
    const t = Number(localStorage.getItem(SIGNED_OUT_KEY));
    const age = Date.now() - t;
    return Number.isFinite(t) && t > 0 && age >= 0 && age < SIGNED_OUT_FRESH_MS;
  } catch {
    return false;
  }
}

/* Every credential this app owns, not just HA's — on a shared tablet the next
   person used to inherit a working Spotify refresh token. And the error log:
   no credential can reach it (errorLog redacts on the way in and again on the
   way out), but it holds entity ids, HA's own error text and stack traces from
   the previous session, and the card promises "kept in this browser", which
   reads as a session guarantee. Each step fenced so one can't stop the rest. */
export function clearDevice() {
  try { localStorage.setItem(SIGNED_OUT_KEY, String(Date.now())); } catch {}
  try { localStorage.removeItem(TOKENS_KEY); } catch {}
  try { clearSpotifyToken(); } catch {}
  try { clearErrors(); } catch {}
}

/* Sign out's second pass, once HA has answered the revoke or the wait ran
   out. This tab can't have written since (latched); this is for what another
   tab wrote meanwhile — but only while the stored session is still the one
   signed out, or none. A tab that heard the Sign out can reload and sign in
   again inside the wait, and the second clear used to remove that newer
   session (never revoked), re-stamp the marker and so sign that tab out a
   second time, onto a rate-limited "Signed out". That session, its Spotify
   token and its log are left alone (D11). */
export function clearDeviceAgain(refreshToken) {
  const stored = storedSession();
  if (stored && stored.refresh_token !== refreshToken) return;
  clearDevice();
}

/* Spotify's token writes and the error log stand down until the reload (the
   HA tokens' own writes are socket.js's signingOut). A Spotify refresh in
   flight, or a call the closing socket rejects, could otherwise land after the
   last clear and write itself back for the next person on the device
   (LESSONS.md pattern 5). */
export function lockDevice() {
  try { lockSpotify(); } catch {}
  try { lockErrorLog(); } catch {}
}

/* A `storage` event saying another tab took the session away: removed the
   tokens (its Sign out, or its dropSession for a session HA ended), or
   cleared the whole of localStorage. Storage events fire in every tab but the
   one that made the change. */
const sessionRemovedElsewhere = (e) => e.newValue === null && (e.key === TOKENS_KEY || e.key === null);

/* Whether this tab follows that event. One that holds a session ends it
   either way. One that doesn't — on "Signed out · sign in", or still signing
   in — follows a Sign out only (a session HA ended keeps the log): it used to
   ignore both, and its next error log entry wrote the previous session's log
   back, entry for entry, from memory (D8). */
export const followsElsewhere = (e, hasSession) => sessionRemovedElsewhere(e) && (hasSession || signedOutJustNow());

/* For a tab that hears another tab took the session away — a Sign out, or HA
   ending it. A Sign out has cleared everything already; this catches what this
   tab wrote back before the event arrived (the error log only for a Sign out). Except a session that isn't this tab's own: an event can
   reach a frozen background tab late, after someone has signed in again, and
   removing their tokens would sign them out. */
export function clearAfterSignOutElsewhere(refreshToken) {
  try {
    if (refreshToken && storedSession()?.refresh_token === refreshToken) localStorage.removeItem(TOKENS_KEY);
  } catch {}
  try { clearSpotifyToken(); } catch {}
  // Only a Sign out clears the log. A session HA ended (another tab's
  // dropSession) keeps it, as it would in a single tab.
  if (signedOutJustNow()) {
    try { clearErrors(); } catch {}
  }
}
