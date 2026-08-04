/* Optimistic on/off toggle bound to an HA entity.
   Owns the canonical card pattern: local `on` state seeded from the entity,
   re-synced on every entity state change, flipped optimistically on toggle
   and reverted if the service call fails.

   const { entity, status, on, setOn, toggle } = useOptimisticToggle("light.desk", "light");

   `setOn` is the escape hatch for flows that imply a state change without
   toggling (e.g. picking a preset turns the light on). */
import { useState, useEffect, useCallback, useRef } from "react";
import { useEntityStatus } from "../ha/useEntity.js";
import { callService } from "../ha/client.js";

export function useOptimisticToggle(entityId, domain = entityId.split(".")[0]) {
  const { entity, status } = useEntityStatus(entityId);
  const [on, setOn] = useState(entity?.state === "on");
  useEffect(() => {
    if (entity) setOn(entity.state === "on");
  }, [entity?.state]);

  // Revert to HA's truth at failure time, not to the boolean captured at click
  // time. The entity can move under an in-flight call (an automation beats us
  // to it), and the resync effect above only fires when the state *string*
  // changes — so a stale revert would stick until the entity moved again.
  const entityRef = useRef(entity);
  entityRef.current = entity;

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    callService(domain, next ? "turn_on" : "turn_off", { entity_id: entityId })
      .catch(() => setOn(entityRef.current?.state === "on"));
  }, [on, domain, entityId]);

  return { entity, status, on, setOn, toggle };
}
