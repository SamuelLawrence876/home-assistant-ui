/* Login-page round trips for socket.js: the once-a-minute redirect limit, the
   event ErrorBoundary listens for to keep the open tab, cleaning HA's OAuth
   callback params out of the URL — and the way out: the reload that starts a
   page over, and Sign out's bounded revoke (the one request made here). No
   module state. */

/* ---- Login redirects, rate-limited ----------------------------------
   An invalid session sends the browser back to HA's login page, as HA's own
   frontend does. What must not happen is a loop: tokens that fail the moment
   they are issued (or an auth provider that signs straight back in) would
   bounce between the two origins forever. So at most one *automatic*
   redirect per minute per tab; past that the chip says "Signed out" and
   offers a button. sessionStorage, because it survives the round trip to
   HA and back within a tab and is gone when the tab is. */
const LOGIN_REDIRECT_KEY = "gh_ha_login_redirect_at";
const LOGIN_REDIRECT_WINDOW_MS = 60_000;

export function mayRedirectToLogin() {
  const now = Date.now();
  let last = NaN;
  try {
    last = Number(sessionStorage.getItem(LOGIN_REDIRECT_KEY));
  } catch {}
  // Read back as hostile input: only a real, past timestamp can block.
  if (Number.isFinite(last) && last > 0 && last <= now && now - last < LOGIN_REDIRECT_WINDOW_MS) {
    return false;
  }
  try {
    sessionStorage.setItem(LOGIN_REDIRECT_KEY, String(now));
  } catch {}
  return true;
}

export function clearLoginRedirectStamp() {
  try {
    sessionStorage.removeItem(LOGIN_REDIRECT_KEY);
  } catch {}
}

/* Fired just before the page leaves for HA's login. App strips ?tab= on
   mount, so a trip to the login page from anywhere but a first load (a dead
   session mid-use, the "Sign in" button, a second try after a failed code
   exchange) used to come back on Overview. components/ErrorBoundary.jsx knows
   the open tab and already hands it across a chunk reload; it listens for
   this and does the same. An event rather than an import: components/ may
   not import ha/. Keep the name in step with ErrorBoundary.jsx. */
const LOGIN_REDIRECT_EVENT = "glasshouse:login-redirect";

export function announceLoginRedirect() {
  try {
    window.dispatchEvent(new Event(LOGIN_REDIRECT_EVENT));
  } catch {}
}

/* Remove the last occurrence of a repeated query param, keeping the earlier ones. */
function dropLastParam(params, name) {
  const all = params.getAll(name);
  if (all.length === 0) return;
  params.delete(name);
  all.slice(0, -1).forEach((v) => params.append(name, v));
}

/* Sign out, and a page Back restored mid-trip to the login page, both end in a
   reload. Its own export so a test can see it: jsdom can't reload, and its
   location.reload can't be spied on. */
export function reloadPage() {
  window.location.reload();
}

/* Sign out's revoke. Best effort and bounded: resolves when HA answers or
   after REVOKE_WAIT_MS, whichever comes first, and never rejects — socket.js
   has already cleared this device and reloads either way. keepalive lets the
   request itself outlive that reload, so a slow HA still gets it. */
export const REVOKE_WAIT_MS = 3000;

export function revokeRefreshToken(hassUrl, refreshToken) {
  if (!hassUrl || !refreshToken) return Promise.resolve();
  let timer;
  const gaveUp = new Promise((resolve) => {
    timer = setTimeout(resolve, REVOKE_WAIT_MS);
  });
  const sent = (async () => {
    const body = new FormData();
    body.append("token", refreshToken);
    await fetch(`${hassUrl}/auth/revoke`, { method: "POST", body, keepalive: true });
  })().catch((e) => console.warn("[ha-ws] revoke failed (signed out locally anyway)", e));
  return Promise.race([sent, gaveUp]).finally(() => clearTimeout(timer));
}

export const hasAuthCallback = () => new URLSearchParams(window.location.search).has("auth_callback");

/* Clean HA OAuth callback params only. A Spotify callback that lands while we
   have no HA tokens gets carried through HA's login round trip (the library
   builds its redirect URI from the current query string), so the URL can hold
   two code/state pairs — and `delete` removes every occurrence. HA appends its
   own last, so drop only the last of each and leave Spotify's alone. */
export function stripAuthCallback() {
  if (!hasAuthCallback()) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_callback");
  dropLastParam(url.searchParams, "code");
  dropLastParam(url.searchParams, "state");
  window.history.replaceState(null, "", url.toString());
}
