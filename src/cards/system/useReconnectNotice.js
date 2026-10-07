/* What the System tab says after it has asked Home Assistant to go away —
   Restart HA, Reboot Pi, the Core / OS / Supervisor installs — and how it
   finds out whether that actually happened.

   Shared by SystemActionsCard and AddonsCard. Lives beside useArmedConfirm.js
   for the same reason: only this tab takes the house down on purpose.

   A reconnect is not proof. The dashboard's own connection can drop and come
   back while the call is in flight (a phone moving from Wi-Fi to cellular, a
   Funnel blip), and callService then resolves `{ connectionLost: true }` for
   a command Home Assistant never received. The notice used to clear on that
   reconnect, so a restart that never happened looked exactly like one that
   worked. So each notice checks something on Home Assistant's side:

   - "restart" — everything that ends with Home Assistant starting again. Its
     start time (sensor.uptime's state; see UptimeCard) is read before the
     call. Once the dashboard has dropped, come back and HA has sent
     sensor.uptime again, a start time that moved means it restarted and the
     notice clears; one that didn't means it never went down, and the card
     says so and it is logged — though not before RESTART_GRACE_MS:
     homeassistant.restart checks the configuration before it stops, and a
     blip in that window reconnects to the same instance. No start time to
     compare says "couldn't confirm", never "done". A later start time clears
     even a "didn't restart".
     "Sent again" is checked by object identity. From the drop until Home
     Assistant's first batch on the new connection, socket.js still holds the
     pre-drop sensor.uptime object, pre-drop start time and all — judged, that
     would read as "didn't restart". That batch is HA's complete set: after it
     sensor.uptime is either an object HA has just sent, or gone (socket.js
     drops whatever the batch left out — a restarting HA that hasn't loaded
     the uptime integration yet). Neither is the object held at "ready".
   - "report" — the Supervisor install, which restarts only the Supervisor
     and leaves the dashboard connected, so there is no drop to wait for. The
     notice lasts until Home Assistant reports the update entity again
     (in_progress going false, a new installed_version — anything), or
     REPORT_CAP_MS; then the row shows whatever HA says.

   The notices live here, at module level, not in the card: the System view is
   lazy and unmounts on every tab change, and a notice in component state was
   gone by the time you came back to check on the reboot. For the same reason
   the connection is watched from here, not through a hook — a drop that
   happens while the card is unmounted still has to count. */
import { useSyncExternalStore } from "react";
import { getConnectionStatus, getEntity, onConnectionChange, onStatesChanged } from "../../ha/socket.js";
import { logError } from "../../lib/errorLog.js";

export const UPTIME_ID = "sensor.uptime";
/* No drop by then, and HA isn't reporting an install still running: it isn't going to. */
export const NOTICE_CAP_MS = 10 * 60_000;
export const RESTART_GRACE_MS = 30_000;
/* Back, but no fresh start time to compare by then: "couldn't confirm". HA
   accepts connections early in its start-up, before every integration loads. */
export const VERIFY_WAIT_MS = 5 * 60_000;
export const REPORT_CAP_MS = 3 * 60_000;
/* How long "didn't restart" / "couldn't confirm" stay up. */
export const OUTCOME_MS = 10 * 60_000;
/* Browser vs Pi clock, for the one comparison that needs both (no start time
   was readable before the call). */
const CLOCK_SKEW_MS = 60_000;

/* An install HA says is running. Older HA sent a percentage here. */
export const installRunning = (attrs) =>
  attrs?.in_progress === true || typeof attrs?.in_progress === "number";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
function startedAt() {
  const s = getEntity(UPTIME_ID)?.state;
  if (typeof s !== "string" || !ISO.test(s)) return null; // "unavailable", "unknown", missing
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/* Anything HA says about the entity. A reconnect re-sends the same values,
   so it doesn't count as a report. */
function reportOf(entityId) {
  const e = entityId ? getEntity(entityId) : undefined;
  if (!e) return "";
  try {
    return JSON.stringify([e.state, e.last_updated, e.attributes]);
  } catch {
    return String(e.last_updated);
  }
}

const notices = new Map(); // scope -> notice
const listeners = new Set();
let unwatch = null;
let timer = null;

const emit = () => listeners.forEach((cb) => cb());

/* checkText once the dashboard is back but nothing is decided yet: "the
   dashboard will reconnect" has stopped being news, and "restarting" may be
   about to turn out false. */
function messageOf(n) {
  if (n.outcome === "failed") return n.failText;
  if (n.outcome === "unsure") return n.unsureText;
  return n.readyAt !== null && n.checkText ? n.checkText : n.text;
}
function put(scope, n) {
  if (n) notices.set(scope, { ...n, message: messageOf(n), pending: !n.outcome });
  else notices.delete(scope);
}

/* The windows below run from the last thing that showed Home Assistant was
   busy with the request — the call coming back, an install it still called
   running, the dashboard reconnecting — never from the press. An OS update
   holds the call open for minutes while it writes the image and reboots only
   after that: timed from the press, both windows were gone before the
   reboot even started, and a good update was reported as "didn't restart". */
const settledAt = (n) => Math.max(n.begunAt, n.lastRunningAt ?? 0, n.readyAt ?? 0);

function assess(n, now) {
  if (n.kind === "report") {
    return reportOf(n.entityId) !== n.before || now - n.sentAt >= REPORT_CAP_MS ? null : n;
  }
  const start = startedAt();
  const restarted = start !== null && (n.before !== null ? start !== n.before : start > n.sentAt - CLOCK_SKEW_MS);
  if (restarted) return null;
  if (n.outcome) return now - n.outcomeAt >= OUTCOME_MS ? null : n;
  if (installRunning(getEntity(n.entityId)?.attributes)) {
    // Nothing to judge yet. Bookkeeping, not display: updated in place so a
    // long install doesn't re-render the tab on every state batch.
    n.lastRunningAt = now;
    return n;
  }
  if (!n.dropped) {
    return now - Math.max(n.begunAt, n.lastRunningAt ?? 0) >= NOTICE_CAP_MS
      ? { ...n, outcome: "failed", outcomeAt: now, why: "Home Assistant never dropped the connection" }
      : n;
  }
  if (n.readyAt === null) return n; // still down
  const resent = getEntity(UPTIME_ID) !== n.staleUptime;
  if (!resent || start === null) {
    return now - n.readyAt >= VERIFY_WAIT_MS ? { ...n, outcome: "unsure", outcomeAt: now } : n;
  }
  if (now - settledAt(n) < RESTART_GRACE_MS) return n;
  return {
    ...n,
    outcome: "failed",
    outcomeAt: now,
    why: "The dashboard reconnected and Home Assistant's start time (sensor.uptime) hadn't moved",
  };
}

function wakeTimes(n) {
  if (n.kind === "report") return [n.sentAt + REPORT_CAP_MS];
  if (n.outcome) return [n.outcomeAt + OUTCOME_MS];
  if (!n.dropped) return [Math.max(n.begunAt, n.lastRunningAt ?? 0) + NOTICE_CAP_MS];
  if (n.readyAt === null) return [];
  return [n.readyAt + VERIFY_WAIT_MS, settledAt(n) + RESTART_GRACE_MS];
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  const now = Date.now();
  let next = Infinity;
  for (const n of notices.values()) for (const t of wakeTimes(n)) if (t > now && t < next) next = t;
  // Past times are left to events: an install HA still calls running.
  if (next !== Infinity) timer = setTimeout(() => refresh(), next - now);
}

function stopWatching() {
  unwatch?.();
  unwatch = null;
}

/* Re-judge every notice, after `change` has folded in what just happened. */
function refresh(change = (n) => n) {
  const now = Date.now();
  let changed = false;
  for (const [scope, n] of notices) {
    const next = assess(change(n, now), now);
    if (next === n) continue;
    changed = true;
    if (next?.outcome === "failed" && n.outcome !== "failed") {
      logError({
        source: "service",
        // True either way: the command may never have reached Home Assistant.
        message: `${next.logAs}: Home Assistant didn't restart (the command may not have reached it)`,
        detail: [next.entityId, next.why].filter(Boolean).join(" · "),
      });
    }
    put(scope, next);
  }
  if (!notices.size) stopWatching();
  schedule();
  if (changed) emit();
}

/* On "ready" the cache still holds what HA sent before the drop (the library
   re-subscribes, and the answer comes later), so the sensor.uptime object it
   holds then is the stale one. Kept even if it is gone after the answer:
   undefined is not that object, and "gone" is judged as no start time. */
function onStatus(s) {
  refresh((n, now) => {
    if (s !== "ready") {
      return n.dropped && n.readyAt === null ? n : { ...n, dropped: true, readyAt: null, staleUptime: undefined };
    }
    return n.dropped && n.readyAt === null ? { ...n, readyAt: now, staleUptime: getEntity(UPTIME_ID) } : n;
  });
}

const onStates = () => refresh();

function watch() {
  if (unwatch) return;
  // onConnectionChange answers at once with the current status; begin() has
  // already folded that in, so the first call is skipped.
  let primed = false;
  const offStatus = onConnectionChange((s) => primed && onStatus(s));
  const offStates = onStatesChanged(onStates);
  primed = true;
  unwatch = () => {
    offStatus();
    offStates();
  };
}

/* Call before the service call goes out; call what it returns once the call
   has resolved (with its result). A call that rejected starts nothing —
   callService has already logged and toasted it.

   spec: { kind: "restart" | "report", text, checkText, failText,
           unsureText, logAs, label, entityId } — entityId is the update
           entity, if any. */
export function prepareNotice(scope, key, spec) {
  const sentAt = Date.now();
  const before = spec.kind === "restart" ? startedAt() : null;
  const uptimeThen = getEntity(UPTIME_ID);
  return function begin(result) {
    const now = Date.now();
    const status = getConnectionStatus();
    const dropped = result?.connectionLost === true || status !== "ready";
    put(scope, {
      ...spec,
      key,
      // A report is anything after the call came back: HA writes the entity
      // (in_progress on, then off) while the call is still running.
      sentAt: spec.kind === "report" ? now : sentAt,
      begunAt: now,
      lastRunningAt: null,
      before: spec.kind === "report" ? reportOf(spec.entityId) : before,
      dropped,
      // Already back (the drop and the reconnect both beat this line): only
      // what HA sent after the call counts.
      readyAt: dropped && status === "ready" ? now : null,
      staleUptime: dropped && status === "ready" ? uptimeThen : undefined,
      outcome: null,
      outcomeAt: null,
      why: null,
    });
    watch();
    refresh();
    emit();
  };
}

const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/* The scope's notice — { key, label, message, pending, outcome } — or null. */
export function useReconnectNotice(scope) {
  return useSyncExternalStore(subscribe, () => notices.get(scope) ?? null);
}

/* Forget everything. For tests; nothing in the app needs it. */
export function clearNotices() {
  notices.clear();
  stopWatching();
  clearTimeout(timer);
  timer = null;
  emit();
}
