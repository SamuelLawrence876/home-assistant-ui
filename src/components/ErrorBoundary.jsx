/* ----------------------------------------------------------------
   Error boundary — keeps one broken tab from blanking the dashboard

   React has no hook form of this, so it stays a class. Without a boundary,
   anything that throws while rendering (a card reading an attribute off a
   null entity, a lazy view chunk that 404s) unmounts the entire root: no
   topbar, no nav, white page, no way back except a guessed reload.

   Chunk-load failures are the common case and they are self-healing. CI runs
   `aws s3 sync dist/ --delete`, which deletes the previous build's hashed
   chunks, so a PWA session parked on a phone for a day asks for a file that
   is gone. Reloading picks up the new index.html. A sessionStorage timestamp
   stops a genuinely broken build from reloading forever — timestamped rather
   than a once-per-session flag so a *second* deploy hours later still gets
   its own free reload instead of being suppressed by the first one.

   The reload also hands the open tab across to App (App strips ?tab= on
   mount), so the self-heal is invisible rather than bouncing the user back to
   Overview with no explanation.

   Entity-agnostic by rule (components/ must not import ha/ or data.js).
   ----------------------------------------------------------------*/

import { Component } from "react";
import { Card } from "./Card.jsx";

const RELOAD_FLAG = "gh-chunk-reload";
const RELOAD_TAB_KEY = "gh-chunk-reload-tab";
/* Long enough that a build which is broken for everyone can't loop (a reload
   cycle is a second or two), short enough that a later deploy re-arms. */
const RELOAD_WINDOW_MS = 60_000;

/* Read-and-clear the tab the auto-reload died on, so it only ever steers the
   very next mount. App calls this while computing its initial tab. */
export function takePendingTab() {
  try {
    const t = sessionStorage.getItem(RELOAD_TAB_KEY);
    if (t) sessionStorage.removeItem(RELOAD_TAB_KEY);
    return t || null;
  } catch {
    return null;
  }
}

/* Browsers and bundlers disagree on the shape of a failed dynamic import —
   there is no shared error class to instanceof against, so match the text. */
function isChunkLoadError(err) {
  const msg = `${err?.name || ""} ${err?.message || ""}`;
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|Loading chunk/i.test(
    msg,
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[glasshouse] view crashed", error, info?.componentStack);
    if (!isChunkLoadError(error)) return;
    try {
      // Already tried in the last minute — show the card instead of looping.
      const last = Number(sessionStorage.getItem(RELOAD_FLAG));
      if (last > 0 && Date.now() - last < RELOAD_WINDOW_MS) return;
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
      this.stashTab();
    } catch {
      return; // storage blocked (private mode); a silent loop is worse
    }
    window.location.reload();
  }

  /* The active tab lives only in App's state and the URL has already had
     ?tab= stripped, so nothing survives a reload without this. */
  stashTab() {
    if (this.props.tab) sessionStorage.setItem(RELOAD_TAB_KEY, this.props.tab);
  }

  reload() {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
      this.stashTab();
    } catch {}
    window.location.reload();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid">
        <div className="col-12">
          <Card eyebrow="Glasshouse" title={this.props.title || "Couldn't load this tab"} meta="error">
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-3)" }}>
              Something in this tab failed to render. The rest of the dashboard is fine — pick
              another tab, or reload to pull the latest build.
            </p>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-4)",
                marginBottom: 14,
                wordBreak: "break-word",
              }}
            >
              {String(error?.message || error)}
            </div>
            <button className="btn" onClick={this.reload}>
              Reload Glasshouse
            </button>
          </Card>
        </div>
      </div>
    );
  }
}
