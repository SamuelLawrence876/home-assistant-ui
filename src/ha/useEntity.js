/* React hooks over the shared HA socket.

   useEntity("light.bedroom")        -> current state object, re-renders on changes
   useEntities(["light.a", "light.b"]) -> Record<entityId, state>
   useEntitiesByDomain("update")     -> array of state objects whose entity_id starts with "update."
   useConnectionStatus()             -> "connecting" | "authenticating" | "ready" | "disconnected"
   useEntityCounts()                 -> { available, unavailable, total }
   useStatistics(ids, hours)         -> { data, loading } — hourly mean from recorder */

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  subscribe,
  onConnectionChange,
  onStatesChanged,
  onSnapshotReady,
  hasSnapshot,
  getAllStates,
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
  useEffect(() => {
    const unsubs = entityIds.map((id) =>
      subscribe(id, (s) => setSnapshot((prev) => ({ ...prev, [id]: s }))),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return snapshot;
}

export function useEntitiesByDomain(domain) {
  const prefix = `${domain}.`;
  const [tick, setTick] = useState(0);
  useEffect(() => onStatesChanged(() => setTick((t) => t + 1)), []);
  return useMemo(() => {
    return getAllStates().filter((s) => s.entity_id.startsWith(prefix));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, tick]);
}

export function useConnectionStatus() {
  const [status, setStatus] = useState(getConnectionStatus);
  useEffect(() => onConnectionChange(setStatus), []);
  return status;
}

export function useEntityCounts() {
  const status = useConnectionStatus();
  // Re-tick whenever the entity set changes so the count actually updates
  // after the WS delivers the initial 290-entity snapshot.
  const [tick, setTick] = useState(0);
  useEffect(() => onStatesChanged(() => setTick((t) => t + 1)), []);
  return useMemo(() => {
    const all = getAllStates();
    let available = 0;
    let unavailable = 0;
    for (const s of all) {
      if (s.state === "unavailable" || s.state === "unknown") unavailable++;
      else available++;
    }
    return { available, unavailable, total: all.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tick]);
}

/* status: "loading" | "not_found" | "unavailable" | "ready" */
export function useEntityStatus(entityId) {
  const entity = useEntity(entityId);
  const connStatus = useConnectionStatus();
  const [snapshotReady, setSnapshotReady] = useState(() => hasSnapshot());

  useEffect(() => {
    if (snapshotReady) return;
    return onSnapshotReady(() => setSnapshotReady(true));
  }, [snapshotReady]);

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
 */
export function useStatistics(statisticIds, hours = 24) {
  const key = statisticIds.join(",");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastKey = useRef("");

  const fetch = useCallback(async () => {
    await waitForConnection();
    const startTime = new Date(Date.now() - hours * 3600_000).toISOString();
    try {
      const result = await sendWsMessage({
        type: "recorder/statistics_during_period",
        start_time: startTime,
        statistic_ids: statisticIds,
        period: "hour",
        types: ["mean", "min", "max"],
      });
      const parsed = {};
      for (const id of statisticIds) {
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

  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    setLoading(true);
    fetch();
  }, [key, fetch]);

  // Refresh every 10 minutes
  useEffect(() => {
    const id = setInterval(fetch, 10 * 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { data, loading };
}
