/* Calendar events hook.

   HA's calendar API is REST-only — events aren't streamed over the WS like
   entity state. We fetch the visible range per calendar entity and refetch
   when range / entity list changes (or when refresh() is called manually).

   Usage:
     const { events, loading, error, refresh } =
       useCalendarEvents(["calendar.icloud_personal"], startISO, endISO);

   Each event in the returned list is augmented with:
     - cal_entity_id  (which calendar it came from — for color mapping)

   Times in HA's response are either:
     - { dateTime: "2026-05-22T10:00:00-07:00" }  (timed event, with TZ offset)
     - { date: "2026-05-22" }                      (all-day event)
   We pass them through untouched; the consumer converts to local hours-of-day.

   `error` is non-null when we could not read the range — the last known events
   stay on screen behind it. Cards should say so: an empty `events` with an
   error set is "we don't know", not "nothing is scheduled".
*/

import { useEffect, useState, useRef, useCallback } from "react";
import { getHaUrl, getFreshAccessToken, getConnectionStatus, onConnectionChange } from "./socket.js";

/* A failed run leaves no "done" marker, so the next range change / reconnect /
   refresh() refetches for real. These are the safety net for a caller whose
   range doesn't move on its own (the week grid): two backoff attempts, then we
   stop and leave `error` standing. Bounded on purpose — the point of the marker
   is that one transient 502 can neither strand the week nor start a retry loop. */
const RETRY_DELAYS_MS = [8000, 20000];

async function fetchOne(entityId, startISO, endISO) {
  const url = getHaUrl();
  // Must be the refreshing getter: the WS library only rotates the access token
  // at connect time, so a cached one 401s ~30 minutes in while the socket is
  // still happily live — and the per-calendar catch below renders that as an
  // empty week rather than an error.
  const token = await getFreshAccessToken();
  if (!url || !token) throw new Error("HA not configured");
  const path = `/api/calendars/${encodeURIComponent(entityId)}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA GET ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  const arr = await res.json();
  return arr.map((ev) => ({ ...ev, cal_entity_id: entityId }));
}

/* Same events in the same order? Then the caller keeps its existing array. A
   fresh array identity re-renders every consumer, and a consumer that derives
   its range while rendering hands us a new key and starts the fetch over.

   Every field a card can render has to be listed here: a field this misses is a
   field you can edit in HA and never see change on the dashboard, because the
   fresh array gets thrown away as "identical". That's the whole of HA's calendar
   payload minus recurrence plumbing we don't surface. */
function sameEvents(a, b) {
  if (a.length !== b.length) return false;
  const at = (t) => t?.dateTime || t?.date;
  return a.every((ev, i) =>
    ev.cal_entity_id === b[i].cal_entity_id &&
    ev.uid === b[i].uid &&
    ev.recurrence_id === b[i].recurrence_id &&
    ev.summary === b[i].summary &&
    ev.location === b[i].location &&
    ev.description === b[i].description &&
    at(ev.start) === at(b[i].start) &&
    at(ev.end) === at(b[i].end),
  );
}

export function useCalendarEvents(entityIds, startISO, endISO) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const doneRef = useRef(null);      // runKey of the last run that SUCCEEDED
  const inFlightRef = useRef(null);  // runKey being fetched right now
  const attemptRef = useRef(0);      // failures so far against this range
  const retryRef = useRef(null);
  const key = `${(entityIds || []).join(",")}|${startISO}|${endISO}`;
  const [connectionTick, setConnectionTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  // What a run is "for": the range plus which connection it was fetched over,
  // so a reconnect still refetches the same range. A retry bumps it too, which
  // is how a failed run re-enters the effect below.
  const rangeKey = `${key}|${connectionTick}`;
  const runKey = `${rangeKey}|${retryTick}`;

  // Re-fetch once the WS becomes ready (we may have rendered before tokens existed).
  useEffect(() => {
    return onConnectionChange((s) => {
      if (s === "ready") setConnectionTick((t) => t + 1);
    });
  }, []);

  // Fresh retry budget per range; drop any pending timer on unmount.
  useEffect(() => { attemptRef.current = 0; }, [rangeKey]);
  useEffect(() => () => clearTimeout(retryRef.current), []);

  /* A run that didn't finish must not look finished. Committing the marker
     up-front meant one 502 / reconnect blip / expired token left the week
     reading "nothing scheduled" for good, with the guard blocking every retry
     and nothing on screen admitting it. */
  const fail = useCallback((e) => {
    inFlightRef.current = null;
    doneRef.current = null;
    // Identity-preserving, like setEvents: a new Error object per attempt
    // re-renders the caller, and a caller that derives its range while
    // rendering would hand us a new key and start the cycle over.
    setError((prev) => (prev && prev.message === e.message ? prev : e));
    const delay = RETRY_DELAYS_MS[attemptRef.current];
    attemptRef.current += 1;
    if (delay != null) retryRef.current = setTimeout(() => setRetryTick((t) => t + 1), delay);
  }, []);

  /* `force` is what refresh() passes — an explicit refresh must refetch even
     though nothing about the range changed. */
  const run = useCallback(async (force = false) => {
    clearTimeout(retryRef.current);
    if (!entityIds || entityIds.length === 0 || !startISO || !endISO) {
      doneRef.current = runKey;
      inFlightRef.current = null;
      // Identity-preserving: a plain setEvents([]) hands React a new array on
      // every call, which re-renders the caller, which recomputes its range,
      // which calls us again — a synchronous loop with no network to slow it.
      setEvents((prev) => (prev.length ? [] : prev));
      setError(null);
      setLoading(false);
      return;
    }
    if (getConnectionStatus() !== "ready") return; // wait for socket-ready tick
    // A caller with an unstable range (a fresh `new Date()` per render) would
    // otherwise hit every calendar on every render. No caller gets to storm the
    // Pi — but only a run that actually came back counts as done.
    if (!force && (doneRef.current === runKey || inFlightRef.current === runKey)) return;
    inFlightRef.current = runKey;
    const id = ++reqIdRef.current;
    setLoading(true);
    try {
      const results = await Promise.all(
        entityIds.map((eid) =>
          fetchOne(eid, startISO, endISO).then(
            (list) => ({ list }),
            (e) => {
              console.warn(`[useCalendarEvents] ${eid} failed`, e);
              return { err: e };
            },
          ),
        ),
      );
      if (id !== reqIdRef.current) return; // a newer call superseded us
      const failed = results.filter((r) => r.err);
      // Whatever did come back is still worth showing. All of them failing is
      // not an empty week, though — keep the last known events under the error.
      if (failed.length < results.length) {
        const next = results.flatMap((r) => r.list || []);
        setEvents((prev) => (sameEvents(prev, next) ? prev : next));
      }
      if (failed.length) {
        fail(failed[0].err);
        return;
      }
      doneRef.current = runKey;
      inFlightRef.current = null;
      attemptRef.current = 0;
      setError(null);
    } catch (e) {
      if (id !== reqIdRef.current) return;
      fail(e);
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
    // `runKey` is the joined entity-ids + range string, not the ids array. The
    // caller builds a fresh array literal every render, so depending on the
    // array itself would refetch on every render — the request-storm bug.
    // The ids are recovered from the key inside the body.
  }, [runKey, fail]);

  useEffect(() => {
    run();
    // `run` is intentionally omitted: it is recreated whenever `fail` changes,
    // and re-running the fetch on that is exactly the loop this key guards.
  }, [runKey]);

  /* Wrapped rather than handed out raw: callers pass it straight to onClick /
     onCreated, and the event object would land in `force`. A hand-driven
     refresh also earns back the automatic retries. */
  const refresh = useCallback(() => {
    attemptRef.current = 0;
    return run(true);
  }, [run]);

  return { events, loading, error, refresh };
}
