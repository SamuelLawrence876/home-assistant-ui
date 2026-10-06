/* Login-page round trips for socket.js: the once-a-minute redirect limit, the
   event ErrorBoundary listens for to keep the open tab, and cleaning HA's OAuth
   callback params out of the URL. No module state; nothing here talks to HA. */

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
