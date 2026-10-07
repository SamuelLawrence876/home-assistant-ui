/* A stand-in for src/ha/socket.js — and for the two useEntity.js hooks the
   System cards read — driven by the test: the connection status, the entity
   states, and the "states changed" batch the real socket fires after every
   snapshot (the first one after a reconnect is the fresh one).

   Not a test file itself. Use it from a vi.mock factory:
     vi.mock("../../src/ha/socket.js", async () => (await import("./fakeHa.js")).socketMock);
   and import the same module in the test to drive it. */
import { useEffect, useState } from "react";
import { act } from "@testing-library/react";

export const ha = {
  status: "ready",
  entities: {},
  statusListeners: new Set(),
  statesListeners: new Set(),
};

export const socketMock = {
  getConnectionStatus: () => ha.status,
  getEntity: (id) => ha.entities[id],
  onConnectionChange(cb) {
    ha.statusListeners.add(cb);
    cb(ha.status);
    return () => ha.statusListeners.delete(cb);
  },
  onStatesChanged(cb) {
    ha.statesListeners.add(cb);
    return () => ha.statesListeners.delete(cb);
  },
};

export function useConnectionStatus() {
  const [s, set] = useState(ha.status);
  useEffect(() => {
    ha.statusListeners.add(set);
    return () => ha.statusListeners.delete(set);
  }, []);
  return s;
}

export function useEntitiesByDomain(domain) {
  const [, tick] = useState(0);
  useEffect(() => {
    const cb = () => tick((t) => t + 1);
    ha.statesListeners.add(cb);
    return () => ha.statesListeners.delete(cb);
  }, []);
  return Object.values(ha.entities).filter((e) => e.entity_id.startsWith(`${domain}.`));
}

export function setStatus(s) {
  ha.status = s;
  act(() => [...ha.statusListeners].forEach((cb) => cb(s)));
}

/* One batch from Home Assistant: these entities as it now reports them. */
export function report(...entities) {
  for (const e of entities) ha.entities[e.entity_id] = e;
  act(() => [...ha.statesListeners].forEach((cb) => cb()));
}

/* The first batch on a new connection, as the real socket.js keeps it: HA's
   complete set, so an entity it didn't send this time is gone, not left over
   from before the drop. */
export function snapshot(...entities) {
  ha.entities = Object.fromEntries(entities.map((e) => [e.entity_id, e]));
  act(() => [...ha.statesListeners].forEach((cb) => cb()));
}

/* What callService resolves with when HA drops the socket mid-call: the
   library has already announced the drop (client.js#sentBeforeDrop). Use as
   callService.mockImplementationOnce(async () => dropMidCall()). */
export function dropMidCall() {
  ha.status = "disconnected";
  [...ha.statusListeners].forEach((cb) => cb("disconnected"));
  return { connectionLost: true };
}

export const uptime = (iso) => ({ entity_id: "sensor.uptime", state: iso, attributes: {}, last_updated: iso });

export function resetHa() {
  ha.status = "ready";
  ha.entities = {};
  ha.statusListeners.clear();
  ha.statesListeners.clear();
}
