/* Todo lists hook.

   HA exposes todo lists as `todo.*` entities. The state of the entity
   is the count; the items themselves come from a service call:

     POST /api/services/todo/get_items?return_response
       body: { entity_id: "todo.foo" }
       response.service_response[entity_id].items: [{uid, summary, status, description?}]

   Mutations:
     POST /api/services/todo/add_item     { entity_id, item: "summary" }
     POST /api/services/todo/update_item  { entity_id, item: <uid>, rename?: "...", status?: "needs_action" | "completed" }
     POST /api/services/todo/remove_item  { entity_id, item: <uid> }

   useTodoLists(entityIds) returns:
     {
       lists: Record<entity_id, { items, loading, error }>,
       add(entity_id, summary)            -> Promise
       move(uid, summary, fromId, toId)   -> Promise   // remove + add
       remove(entity_id, uid)             -> Promise
       refresh(entity_id?)                -> Promise
     }

   Items are re-fetched when the entity's state (item count) changes,
   so changes from the iPhone propagate without polling. */

import { useEffect, useState, useRef, useCallback } from "react";
import { getHaUrl, getAccessToken, getConnectionStatus, onConnectionChange, subscribe } from "./socket.js";

async function fetchItems(entityId) {
  const url = getHaUrl();
  const token = getAccessToken();
  if (!url || !token) throw new Error("HA not configured");
  const res = await fetch(`${url}/api/services/todo/get_items?return_response`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity_id: entityId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA todo.get_items ${entityId} → ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json?.service_response?.[entityId]?.items || [];
}

async function callTodoService(service, entityId, extraData = {}) {
  const url = getHaUrl();
  const token = getAccessToken();
  if (!url || !token) throw new Error("HA not configured");
  const res = await fetch(`${url}/api/services/todo/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity_id: entityId, ...extraData }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA todo.${service} ${entityId} → ${res.status} ${body.slice(0, 200)}`);
  }
}

export function useTodoLists(entityIds) {
  const [lists, setLists] = useState(() =>
    Object.fromEntries((entityIds || []).map((id) => [id, { items: [], loading: false, error: null }])),
  );
  const reqIdsRef = useRef({});
  const key = (entityIds || []).join(",");

  const refresh = useCallback(
    async (entityId) => {
      const ids = entityId ? [entityId] : entityIds || [];
      if (ids.length === 0 || getConnectionStatus() !== "ready") return;
      await Promise.all(
        ids.map(async (id) => {
          const reqId = (reqIdsRef.current[id] || 0) + 1;
          reqIdsRef.current[id] = reqId;
          setLists((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), loading: true, error: null } }));
          try {
            const items = await fetchItems(id);
            if (reqIdsRef.current[id] !== reqId) return;
            setLists((prev) => ({ ...prev, [id]: { items, loading: false, error: null } }));
          } catch (e) {
            if (reqIdsRef.current[id] !== reqId) return;
            console.warn("[useTodoLists] refresh failed", id, e);
            setLists((prev) => ({ ...prev, [id]: { ...(prev[id] || { items: [] }), loading: false, error: e } }));
          }
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  /* Refetch all on first ready, and on entity-set changes. */
  const [connectionTick, setConnectionTick] = useState(0);
  useEffect(() => {
    return onConnectionChange((s) => {
      if (s === "ready") setConnectionTick((t) => t + 1);
    });
  }, []);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connectionTick]);

  /* Each entity's state attribute changes when items are added/removed
     (state = count). Subscribe per-entity so iPhone-side changes flow in. */
  useEffect(() => {
    const unsubs = (entityIds || []).map((id) =>
      subscribe(id, () => {
        refresh(id);
      }),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const add = useCallback(
    async (entityId, summary) => {
      const text = (summary || "").trim();
      if (!text) return;
      await callTodoService("add_item", entityId, { item: text });
      await refresh(entityId);
    },
    [refresh],
  );

  const remove = useCallback(
    async (entityId, uid) => {
      await callTodoService("remove_item", entityId, { item: uid });
      await refresh(entityId);
    },
    [refresh],
  );

  /* Cross-list move: HA's todo API has no "move" service. Best we can do
     is remove from source + add to target. UIDs are not preserved across
     the move (target gets a new UID from iCloud). */
  const move = useCallback(
    async (uid, summary, fromId, toId) => {
      if (fromId === toId) return;
      await callTodoService("add_item", toId, { item: summary });
      try {
        await callTodoService("remove_item", fromId, { item: uid });
      } catch (e) {
        console.warn("[useTodoLists] remove after add failed; the item may now exist in both lists", e);
        throw e;
      }
      await Promise.all([refresh(fromId), refresh(toId)]);
    },
    [refresh],
  );

  return { lists, add, remove, move, refresh };
}
