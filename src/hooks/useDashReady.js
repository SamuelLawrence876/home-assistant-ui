/* Dashboard is "ready" once the WS is connected AND the first entity
   snapshot has landed — at which point the boot animation can hand off. */
import { useState, useEffect } from "react";
import { useConnectionStatus } from "../ha/useEntity.js";
import { onSnapshotReady, hasSnapshot } from "../ha/socket.js";

export function useDashReady() {
  const status = useConnectionStatus();
  const [snap, setSnap] = useState(() => hasSnapshot());
  useEffect(() => {
    if (snap) return;
    return onSnapshotReady(() => setSnap(true));
  }, [snap]);
  return status === "ready" && snap;
}
