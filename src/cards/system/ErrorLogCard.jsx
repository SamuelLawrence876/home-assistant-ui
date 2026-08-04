/* ----------------------------------------------------------------
   Error log card — the "go and look afterwards" half of lib/errorLog.js.

   Nothing here interrupts. The log fills up silently while you use the
   dashboard; this card is where you read it back. Newest first, relative
   times, stacks folded away until you ask for one.
   ----------------------------------------------------------------*/

import { useState, useEffect, useSyncExternalStore } from "react";
import {
  subscribe,
  getEntries,
  clearErrors,
  formatEntries,
  MAX_ENTRIES,
} from "../../lib/errorLog.js";
import { Card } from "../../components/Card.jsx";

/* A deliberate 30-second tick, not a clock read during render.
   LESSONS.md pattern 1: "now" is either pinned or ticked, never incidental. */
function useTick(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function relativeTime(ts, now) {
  const diff = now - ts;
  if (!Number.isFinite(diff)) return "—";
  if (diff < 45_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(diff / 86_400_000);
  return `${days}d ago`;
}

function absoluteTime(ts) {
  const d = new Date(ts);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })
    : "unknown time";
}

const SOURCE_TONE = {
  connection: "var(--warn)",
  service: "var(--bad)",
  rest: "var(--bad)",
};

function toneFor(source) {
  if (typeof source !== "string") return "var(--ink-3)";
  if (source.startsWith("render")) return "var(--bad)";
  return SOURCE_TONE[source] || "var(--ink-3)";
}

function ErrorRow({ entry, now }) {
  const expandable = Boolean(entry.stack || entry.detail);
  const head = (
    <>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: toneFor(entry.source),
          flexShrink: 0,
        }}
      >
        {entry.source}
      </span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--ink)", wordBreak: "break-word" }}>
        {entry.message}
      </span>
      <span
        style={{ fontSize: 11, color: "var(--ink-4)", flexShrink: 0, whiteSpace: "nowrap" }}
        title={absoluteTime(entry.ts)}
      >
        {relativeTime(entry.ts, now)}
      </span>
    </>
  );

  if (!expandable) {
    return (
      <li className="errlog-row">
        <div className="errlog-head errlog-head-static">{head}</div>
      </li>
    );
  }

  return (
    <li className="errlog-row">
      <details>
        <summary className="errlog-head">{head}</summary>
        <div className="errlog-body">
          {entry.detail && <p className="errlog-detail">{entry.detail}</p>}
          {entry.stack && <pre className="errlog-stack">{entry.stack}</pre>}
        </div>
      </details>
    </li>
  );
}

export function ErrorLogCard({ index = 0 }) {
  const entries = useSyncExternalStore(subscribe, getEntries, getEntries);
  const now = useTick();
  const [copied, setCopied] = useState(null); // null | "ok" | "failed"
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset the transient copy notice whenever the log changes underneath us.
  useEffect(() => setCopied(null), [entries]);

  async function copyAll() {
    const text = formatEntries(entries);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded webviews. Say so rather than pretending it worked.
      setCopied("failed");
    }
  }

  function doClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearErrors();
  }

  const count = entries.length;

  return (
    <Card
      index={index}
      eyebrow="System · diagnostics"
      title="Error log"
      meta={count === 0 ? "nothing recorded" : `${count} recorded`}
    >
      {count === 0 ? (
        <div className="errlog-empty">
          <div className="errlog-empty-mark" aria-hidden>
            ✓
          </div>
          <div>
            <div style={{ color: "var(--ink)", fontSize: 14, marginBottom: 4 }}>
              Nothing has gone wrong.
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              Failed service calls, dropped connections and view crashes are recorded here
              as they happen, so you can look afterwards. The last {MAX_ENTRIES} are kept,
              on this device only, and are cleared when you sign out. A failed button press
              also shows a brief toast at the time; nothing else interrupts you.
            </div>
          </div>
        </div>
      ) : (
        <ul className="errlog-list">
          {entries.map((e) => (
            <ErrorRow key={e.id} entry={e} now={now} />
          ))}
        </ul>
      )}

      <div className="errlog-actions">
        <button className="btn" onClick={copyAll} disabled={count === 0}>
          {copied === "ok" ? "Copied" : copied === "failed" ? "Copy blocked" : "Copy all"}
        </button>
        <button className="btn" onClick={doClear} disabled={count === 0}>
          {confirmClear ? "Confirm clear" : "Clear"}
        </button>
        {confirmClear && (
          <button className="btn" onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
        )}
        <span className="errlog-note">
          {copied === "failed"
            ? "The browser refused clipboard access — select the text instead."
            : "Kept in this browser. Never leaves the device."}
        </span>
      </div>
    </Card>
  );
}
