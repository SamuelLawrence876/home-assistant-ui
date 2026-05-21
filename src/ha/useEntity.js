/* React hooks over the shared HA socket.

   useEntity("light.bedroom")        -> current state object, re-renders on changes
   useEntities(["light.a", "light.b"]) -> Record<entityId, state>
   useConnectionStatus()             -> "connecting" | "authenticating" | "ready" | "disconnected"
   useEntityCounts()                 -> { available, unavailable, total } */

import { useEffect, useState, useMemo } from "react";
import {
  subscribe,
  onConnectionChange,
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

export function useConnectionStatus() {
  const [status, setStatus] = useState(getConnectionStatus);
  useEffect(() => onConnectionChange(setStatus), []);
  return status;
}

export function useEntityCounts() {
  const status = useConnectionStatus();
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
  }, [status]);
}
