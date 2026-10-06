/* Optimistic on/off toggle bound to an HA entity.
   Owns the canonical card pattern: local `on` state seeded from the entity,
   re-synced on every entity state change, flipped optimistically on toggle
   and reverted if the service call fails — or if it "succeeds" and nothing
   happens (see SETTLE_MS).

   const { entity, status, on, setOn, toggle } = useOptimisticToggle("light.desk", "light");

   `setOn` is the escape hatch for flows that imply a state change without
   toggling (e.g. picking a preset turns the light on). */
import { useState, useEffect, useCallback, useRef } from "react";
import { useEntityStatus } from "../ha/useEntity.js";
import { callService } from "../ha/client.js";

/* How long a resolved call gets to show up as a state change before the
   switch goes back to what HA says. A resolve is not proof anything moved:
   HA skips an unavailable target and still reports success, a command_line
   switch (switch.sambox) accepts a command whose shell step failed, and a
   cloud device can drop one. Without this the optimistic value stuck until
   the entity next changed for some other reason. */
export const SETTLE_MS = 8000;

export function useOptimisticToggle(entityId, domain = entityId.split(".")[0]) {
  const { entity, status } = useEntityStatus(entityId);
  const [on, setOn] = useState(entity?.state === "on");

  const settleRef = useRef(null);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const clearSettle = () => {
    clearTimeout(settleRef.current);
    settleRef.current = null;
  };

  useEffect(() => {
    // A real state event is the answer the settle timer was waiting for.
    clearSettle();
    if (entity) setOn(entity.state === "on");
  }, [entity?.state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSettle();
    };
  }, []);

  // Revert to HA's truth at failure time, not to the boolean captured at click
  // time. The entity can move under an in-flight call (an automation beats us
  // to it), and the resync effect above only fires when the state *string*
  // changes — so a stale revert would stick until the entity moved again.
  const entityRef = useRef(entity);
  entityRef.current = entity;

  const toggle = useCallback(() => {
    const next = !on;
    const seq = ++seqRef.current;
    setOn(next);
    clearSettle();
    callService(domain, next ? "turn_on" : "turn_off", { entity_id: entityId })
      .then(() => {
        // Only the latest press settles, and never after unmount. No entity
        // means mock mode or a socket that hasn't delivered yet: there is no
        // truth to settle to, and "settling" to null would flip every switch off.
        if (seq !== seqRef.current || !mountedRef.current || !entityRef.current) return;
        clearSettle();
        settleRef.current = setTimeout(() => {
          settleRef.current = null;
          if (entityRef.current) setOn(entityRef.current.state === "on");
        }, SETTLE_MS);
      })
      .catch(() => setOn(entityRef.current?.state === "on"));
  }, [on, domain, entityId]);

  return { entity, status, on, setOn, toggle };
}
