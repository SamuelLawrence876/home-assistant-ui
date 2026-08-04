/* ----------------------------------------------------------------
   Error log — a quiet, capped, persistent record of things that went wrong.

   Deliberately silent. Nothing here shows a toast, a banner or a dialog:
   the whole point is that you go and look afterwards, on the System tab,
   rather than being interrupted while an error is happening.

   Shape of an entry: { id, ts, source, message, detail, stack }.
   Newest first, at most MAX_ENTRIES, persisted to localStorage.

   Three rules this file exists to keep:

   1. It can never throw. Every export swallows its own failures. A logger
      that crashes the thing it is logging is worse than no logger.
   2. It can never brick the app. Whatever comes back out of localStorage is
      hostile input and is validated field by field before anything trusts it
      (LESSONS.md pattern 3 — a poisoned stored value that survived reloads).
   3. It can never store a credential. Every string is redacted on the way in
      (LESSONS.md pattern 5 — seven of the 2026-08 findings were tokens).
   ----------------------------------------------------------------*/

const STORAGE_KEY = "gh_error_log";
export const MAX_ENTRIES = 100;
const MAX_FIELD = 600; // message / detail
const MAX_STACK = 4000;
/* An identical entry repeated inside this window is dropped, so a socket
   flapping every second can't flush a genuine crash out of the buffer.
   Deliberately short: a fault that keeps recurring should still show up
   repeatedly, because "it happened all night" is the useful signal. */
const DEDUPE_MS = 10_000;

/* ---------------------------- redaction ---------------------------- */

/* Query/JSON keys whose value is a secret, whatever it looks like. */
const SECRET_KEYS =
  "access_token|refresh_token|id_token|client_secret|authSig|signature|api_key|apikey|password|passwd|secret|token|code";

const REDACTIONS = [
  // Authorization: Bearer <jwt>  /  "Bearer eyJ..."
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  // JWTs anywhere — HA access tokens and Spotify tokens are both this shape.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  // key=value in a URL or form body.
  [new RegExp(`\\b(${SECRET_KEYS})=[^&\\s"'<>]+`, "gi"), "$1=[redacted]"],
  // "key": "value" in JSON.
  [new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, "gi"), '$1"[redacted]"'],
  // Long hex runs — HA refresh tokens and Spotify PKCE verifiers look like this.
  [/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]"],
];

/* Redact, then clamp. Returns "" for anything that isn't a usable string, so
   callers never have to think about null. */
export function redact(value, max = MAX_FIELD) {
  let s;
  try {
    s = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  } catch {
    return "";
  }
  if (!s) return "";
  try {
    for (const [pattern, replacement] of REDACTIONS) s = s.replace(pattern, replacement);
  } catch {
    return "[unprintable]";
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* ---------------------------- storage ------------------------------ */

let seq = 0;
function makeId(ts) {
  seq = (seq + 1) % 1_000_000;
  return `${ts}-${seq}`;
}

/* Validate BEFORE trusting. Anything that fails is dropped, not repaired:
   a half-understood entry in a debugging tool is worse than a missing one. */
function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ts = Number(raw.ts);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const message = redact(raw.message);
  if (!message) return null;
  const detail = redact(raw.detail);
  const stack = redact(raw.stack, MAX_STACK);
  const source = redact(raw.source, 40) || "unknown";
  const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 60) : makeId(ts);
  return { id, ts, source, message, detail: detail || null, stack: stack || null };
}

function readStored() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return []; // private mode / storage disabled
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    const entry = sanitize(item);
    if (entry) out.push(entry);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

function writeStored(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return;
  } catch {
    // Almost certainly quota. Drop the oldest half and try once more; if that
    // fails too, the log stays in memory for this session and that is fine.
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, Math.floor(list.length / 2))));
  } catch {}
}

/* ---------------------------- store -------------------------------- */

/* Newest first. Replaced wholesale on every change so useSyncExternalStore
   can compare by identity. */
let entries = readStored();
const listeners = new Set();
/* Re-entrancy guard: if anything inside this module throws and that throw is
   itself routed back here (a console hook, an error boundary catching a
   render triggered by our own notify), the second call is dropped. */
let inLogError = false;

function notify() {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch {}
  }
}

/* Subscribe to changes. Returns an unsubscribe function.
   Signature matches useSyncExternalStore's first argument. */
export function subscribe(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* Stable snapshot — same array identity until something actually changes. */
export function getEntries() {
  return entries;
}

export function getEntryCount() {
  return entries.length;
}

/* Record one problem. Never throws, never returns a value worth checking.
   `source` is a short label ("service", "connection", "render · lights"). */
export function logError({ source, message, detail, stack } = {}) {
  if (inLogError) return;
  inLogError = true;
  try {
    const ts = Date.now();
    const entry = sanitize({ id: makeId(ts), ts, source, message, detail, stack });
    if (!entry) return;

    const newest = entries[0];
    if (
      newest &&
      newest.source === entry.source &&
      newest.message === entry.message &&
      newest.detail === entry.detail &&
      ts - newest.ts < DEDUPE_MS
    ) {
      return;
    }

    entries = [entry, ...entries].slice(0, MAX_ENTRIES);
    writeStored(entries);
    notify();
  } catch {
    // Swallowed on purpose. See rule 1 at the top of this file.
  } finally {
    inLogError = false;
  }
}

export function clearErrors() {
  try {
    entries = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    notify();
  } catch {}
}

/* Plain-text dump for the card's copy button. Already redacted, because the
   entries were redacted on the way in. */
export function formatEntries(list = entries) {
  try {
    if (!Array.isArray(list) || list.length === 0) return "Glasshouse error log — empty.";
    const lines = [`Glasshouse error log — ${list.length} entr${list.length === 1 ? "y" : "ies"}, newest first.`];
    for (const e of list) {
      const when = new Date(e.ts);
      const stamp = Number.isFinite(when.getTime()) ? when.toISOString() : String(e.ts);
      lines.push("", `[${stamp}] ${e.source}: ${e.message}`);
      if (e.detail) lines.push(`  ${e.detail}`);
      if (e.stack) lines.push(e.stack.replace(/^/gm, "  "));
    }
    return lines.join("\n");
  } catch {
    return "Glasshouse error log — could not be formatted.";
  }
}
