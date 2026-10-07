/* React hooks over the shared HA socket.

   useEntity("light.bedroom")        -> current state object, re-renders on changes
   useEntities(["light.a", "light.b"]) -> Record<entityId, state>
   useEntitiesByDomain("update")     -> array of state objects whose entity_id starts with "update.",
                                        plus `.loadingIds`: the domain's ids HA may still be loading
   useLoadingIds(["light.a", …])     -> the ones of those HA may still be loading
   useSnapshotReady(id?)             -> HA has sent its set on this connection (and isn't maybe
                                        still loading `id`)
   useConnectionStatus()             -> "connecting" | "authenticating" | "ready" | "disconnected"
   useEntityCounts()                 -> { available, unavailable, total, loading }
   useStatistics(ids, hours)         -> { data, loading } — hourly mean from recorder

   "May still be loading": after a reconnect, an entity this page had that
   HA's new set left out, for up to HELD_BACK_WAIT_MS (heldBack.js). It is
   absent from every list here, but it is not known to be gone — useEntityStatus
   says "loading" for it, and a reader of a whole domain or set says the same
   by checking these rather than claiming "none", "all current" or "offline". */

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  subscribe,
  onConnectionChange,
  onStatesChanged,
  hasSnapshot,
  getAllStates,
  getLoadingIds,
  getEntity,
  getConnectionStatus,
  sendWsMessage,
  waitForConnection,
} from "./socket.js";

export function useEntity(entityId) {
  const [state, setState] = useState(() => getEntity(entityId));
  useEffect(() => {
    if (!entityId) return;
    return subscribe(entityId, setState);
  }, [entityId]);
  return state;
}

export function useEntities(entityIds) {
  const key = entityIds.join(",");
  const [snapshot, setSnapshot] = useState(() =>
    Object.fromEntries(entityIds.map((id) => [id, getEntity(id)])),
  );
  // Callers almost always pass a fresh array literal, so `entityIds` is a new
  // object on every render and can't be a dependency — resubscribing 290
  // entities per render is exactly the storm LESSONS.md pattern 1 describes.
  // The joined string is the real identity, so the effect reads its ids back
  // out of it and depends on nothing else. Entity ids can't contain a comma.
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const unsubs = ids.map((id) =>
      subscribe(id, (s) => setSnapshot((prev) => ({ ...prev, [id]: s }))),
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return snapshot;
}

/* Re-renders once per states batch (and when a held-back wait runs out). */
function useStatesTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => onStatesChanged(() => setTick((t) => t + 1)), []);
  return tick;
}

/* `.loadingIds` rides on the array, rather than the hook returning a new
   shape, so every caller and test stand-in that only knows the array keeps
   working; one without it reads as nothing loading. */
export function useEntitiesByDomain(domain) {
  const prefix = `${domain}.`;
  const tick = useStatesTick();
  // `tick` is an invalidation token, not an input: getAllStates() reads a
  // module-level Map that React can't see change, so the counter is the only
  // thing that tells this memo the answer may have moved.
  return useMemo(() => {
    const list = getAllStates().filter((s) => s.entity_id.startsWith(prefix));
    list.loadingIds = getLoadingIds().filter((id) => id.startsWith(prefix)).sort();
    return list;
  }, [prefix, tick]);
}

/* The ids among `entityIds` HA may still be loading — see the top of the
   file. The same array until its contents change, keyed on the joined ids
   like useEntities, so a caller can't be handed a new one every batch. Held
   as a string so an unchanged answer re-renders nothing: every Scenes tile
   asks, and HA sends several batches a second. */
export function useLoadingIds(entityIds) {
  const key = entityIds.join(",");
  const read = useCallback(() => {
    const wanted = new Set(key ? key.split(",") : []);
    return getLoadingIds().filter((id) => wanted.has(id)).sort().join(",");
  }, [key]);
  const [joined, setJoined] = useState(read);
  useEffect(() => {
    const sync = () => setJoined(read());
    sync(); // catches a change since render, and a new key
    return onStatesChanged(sync);
  }, [read]);
  return useMemo(() => (joined ? joined.split(",") : []), [joined]);
}

export function useConnectionStatus() {
  const [status, setStatus] = useState(getConnectionStatus);
  useEffect(() => onConnectionChange(setStatus), []);
  return status;
}

/* `loading`: entities HA may still be loading, which `total` (HA's set as
   it stands) leaves out — add them back for a count that doesn't drop by
   every slow integration after each restart. */
export function useEntityCounts() {
  const status = useConnectionStatus();
  // Re-tick whenever the entity set changes so the count actually updates
  // after the WS delivers the initial 290-entity snapshot.
  const tick = useStatesTick();
  // As above: `status` and `tick` are invalidation tokens for a Map React
  // cannot observe, not values the count is computed from.
  return useMemo(() => {
    const all = getAllStates();
    let available = 0;
    let unavailable = 0;
    for (const s of all) {
      if (s.state === "unavailable" || s.state === "unknown") unavailable++;
      else available++;
    }
    return { available, unavailable, total: all.length, loading: getLoadingIds().length };
  }, [status, tick]);
}

/* Whether HA has sent its complete set on the current connection, and isn't
   maybe still loading this entity (held back — see below). It used to
   latch true at the first snapshot, so after a drop every cached pre-drop
   state read "ready" again the moment the socket was back, before HA had
   re-sent anything. socket.js shuts it just before announcing a drop and
   opens it just before the first states batch after the reconnect, and fires
   the states listeners again when a held-back wait runs out, so those are
   the ones to re-read it on. Plain state rather than useSyncExternalStore on
   purpose: this way it lands in the same render as the entity updates from
   that batch, never one render ahead of them. With no id it is the whole
   set's answer, for a card that speaks for many entities at once. */
export function useSnapshotReady(entityId) {
  const [ready, setReady] = useState(() => hasSnapshot(entityId));
  useEffect(() => {
    const sync = () => setReady(hasSnapshot(entityId));
    const offStatus = onConnectionChange(sync); // answers at once: catches a flip since render
    const offStates = onStatesChanged(sync);
    return () => {
      offStatus();
      offStates();
    };
  }, [entityId]);
  return ready;
}

/* status: "loading" | "not_found" | "unavailable" | "ready".
   - "ready": HA sent this state on the current connection.
   - "loading": not connected yet, HA hasn't answered the (re)subscribe yet,
     or the entity is held back — the page had it before a drop and HA's
     answer on the new connection left it out, less than HELD_BACK_WAIT_MS
     (5 min, ha/heldBack.js) ago. After Restart HA a Pi takes minutes to
     load slow integrations, and "not found" was a stronger claim than HA
     could back for entities about to come back. `entity` is undefined
     meanwhile: the pre-drop state isn't live.
   - "not_found": HA's set doesn't have it — this page never saw it, HA
     removed it, or it has been held back past that bound (deleted while the
     page was away).
   - "unavailable": HA has it, as "unavailable" or "unknown". */
export function useEntityStatus(entityId) {
  const entity = useEntity(entityId);
  const connStatus = useConnectionStatus();
  const snapshotReady = useSnapshotReady(entityId);

  let status;
  if (connStatus !== "ready" || !snapshotReady) {
    status = "loading";
  } else if (!entity) {
    status = "not_found";
  } else if (entity.state === "unavailable" || entity.state === "unknown") {
    status = "unavailable";
  } else {
    status = "ready";
  }

  return { entity, status };
}

export function combineStatuses(...statuses) {
  if (statuses.includes("loading")) return "loading";
  if (statuses.includes("not_found")) return "not_found";
  if (statuses.includes("unavailable")) return "unavailable";
  return "ready";
}

/**
 * Fetch hourly statistics from HA's recorder for the last N hours.
 * Returns { data: { [statistic_id]: { mean: number[], min: number[], max: number[] } }, loading: boolean }
 * `loading` is true until a fetch made over a ready socket has settled. Once
 * it is false, `data` null (or an empty series) means the recorder really had
 * nothing, or the fetch failed — say "no history", not "loading".
 */
export function useStatistics(statisticIds, hours = 24) {
  const key = statisticIds.join(",");
  const ready = useConnectionStatus() === "ready";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Same identity trick as useEntities: `statisticIds` is a fresh array on
  // every render, so the ids are recovered from the joined key instead. That
  // keeps `fetch` stable, which keeps the effect below from being torn down
  // and re-fetching on every render.
  const fetch = useCallback(async () => {
    const ids = key ? key.split(",") : [];
    const startTime = new Date(Date.now() - hours * 3600_000).toISOString();
    try {
      // Inside the try: waitForConnection() now rejects on timeout, and this
      // used to sit outside it — with HA unreachable the charts hung on
      // `loading` forever because setLoading(false) was never reached.
      await waitForConnection();
      const result = await sendWsMessage({
        type: "recorder/statistics_during_period",
        start_time: startTime,
        statistic_ids: ids,
        period: "hour",
        types: ["mean", "min", "max"],
      });
      const parsed = {};
      for (const id of ids) {
        const points = result[id] || [];
        parsed[id] = {
          mean: points.map((p) => p.mean ?? null).filter((v) => v !== null),
          min: points.map((p) => p.min ?? null).filter((v) => v !== null),
          max: points.map((p) => p.max ?? null).filter((v) => v !== null),
        };
      }
      setData(parsed);
    } catch (e) {
      console.warn("[useStatistics] fetch failed", e);
    }
    setLoading(false);
  }, [key, hours]);

  // Keyed on "is the socket ready", the way useForecast is: fetch as soon as
  // it is, again on every reconnect, and every 10 minutes while it stays up.
  // This used to fetch once at mount and then only on the interval, so a first
  // connect slower than waitForConnection's 15 s timeout — or any reconnect —
  // left the climate cards without history for up to 10 minutes. Nothing
  // fetches while disconnected; it could only time out.
  useEffect(() => {
    if (!ready) return undefined;
    setLoading(true);
    fetch();
    const id = setInterval(fetch, 10 * 60_000);
    return () => clearInterval(id);
  }, [ready, fetch]);

  return { data, loading };
}
