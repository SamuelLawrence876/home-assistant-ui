/* "Update ready — Refresh" bar.

   Presentational + the service-worker plumbing, nothing entity-aware: it takes
   no props and imports no ha/ or data.js (CLAUDE.md's components/ rule).

   main.jsx decides whether to mount it at all, and only does so on a real
   deployment — see the note there on why a mock-mode build must never register
   a service worker.

   WHY THE INTERVAL: a service worker only checks for a new version on page load
   and navigation. Glasshouse is a wall dashboard that is never reloaded and
   never navigates, so without an explicit poll a tab open for a week would sit
   on the old build forever and this bar would never appear — the exact failure
   it exists to fix. `registration.update()` on a timer is what actually makes a
   deploy reach the screen. It is a conditional GET against sw.js; when nothing
   changed the answer is a 304 and no update fires. */
import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/* Long enough to be free (one 304 every half hour), short enough that a deploy
   shows up while you are still near the thing you deployed. */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function UpdatePrompt() {
  const timerRef = useRef(null);
  const registrationRef = useRef(null);
  const [failed, setFailed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;
      // Skip the poll while the tab is hidden or the box is offline — a phone
      // in a background tab would otherwise wake up to check nothing. The
      // visibilitychange handler below covers coming back.
      timerRef.current = setInterval(() => {
        if (document.visibilityState === "visible" && navigator.onLine) {
          registration.update().catch(() => {});
        }
      }, UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(err) {
      // Registration failing means this bar can never appear. Say so once,
      // rather than leaving a silently dead update path.
      console.warn("[pwa] service worker did not register — updates will not be offered", err);
      setFailed(true);
    },
  });

  useEffect(() => {
    // A phone tab returning to the foreground gets an immediate check, so you
    // don't wait out the rest of the interval to be told about a deploy.
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        registrationRef.current?.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Lift the service-error toasts clear while this bar is up: both are anchored
  // bottom-centre, both are rare, so they would only ever collide by surprise.
  useEffect(() => {
    document.body.classList.toggle("has-update-prompt", needRefresh);
    return () => document.body.classList.remove("has-update-prompt");
  }, [needRefresh]);

  // The live region is always mounted, even empty — same reason as Toast.jsx: a
  // region that arrives in the same DOM mutation as its first message is never
  // announced, because screen readers only report changes to a region already
  // in the tree. It collapses to nothing and ignores pointers when idle.
  return (
    <div className="update-prompt-slot" role="status" aria-live="polite">
      {needRefresh && !failed && (
        <div className="update-prompt">
          <span className="update-prompt-dot" aria-hidden="true" />
          <span className="update-prompt-label">A new version of Glasshouse is ready</span>
          <button
            type="button"
            className="update-prompt-btn"
            onClick={() => void updateServiceWorker(true)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="update-prompt-x"
            onClick={() => setNeedRefresh(false)}
            aria-label="Dismiss update notice"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
