/* React hooks over the shared HA socket.

   useEntity("light.bedroom")        -> current state object, re-renders on changes
   useEntities(["light.a", "light.b"]) -> Record<entityId, state>
   useEntitiesByDomain("update")     -> array of state objects whose entity_id starts with "update."
   useConnectionStatus()             -> "connecting" | "authenticating" | "ready" | "disconnected"
   useEntityCounts()                 -> { available, unavailable, total } */

import { useEffect, useState, useMemo } from "react";
import {
  subscribe,
  onConnectionChange,
  onStatesChanged,
  onSnapshotReady,
  hasSnapshot,
  getAllStates,
  getEntity,
  getConnectionStatus,
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
