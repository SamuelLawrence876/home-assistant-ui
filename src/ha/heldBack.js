/* The held-back set, for socket.js: entities the library still holds that
   Home Assistant hasn't sent on the current connection. Its own file because
   socket.js is at its size limit; nothing but socket.js uses it.

   HA answers every subscribe_entities — the first one, and the one the
   library re-sends after each reconnect — with its complete current set. The
   library merges that answer into the store it kept from before the drop,
   though, and only an explicit removal ever deletes from it. So after a drop
   an entity HA no longer has, or hasn't loaded yet (a restarting HA accepts
   connections minutes before slow integrations add their entities on a Pi),
   was still handed over with its pre-drop state, and read "ready".

   Identity tells them apart: the library builds a new object for every entity
   HA sends, and one HA didn't send keeps the very object it had. So in the
   first batch on a connection, anything still identical to the store as last
   handed over was not sent on this connection. It is held back as absent —
   what a page loaded right now would see — until HA sends it.

   Absent is not "not found" straight away, though. After Restart HA that
   first batch leaves out every slow integration for the minutes a Pi takes to
   load them, and "<id> not found" across the dashboard was a stronger claim
   than HA could back: those entities come back on their own. So for
   HELD_BACK_WAIT_MS from when it was first held back it is still waiting —
   socket.js's hasSnapshot(id) is false and useEntityStatus says "loading",
   and getLoadingIds() lists it for the readers of a whole domain or set —
   and after that it is "not_found", as for an entity deleted while the page
   was away. The bound is the one useReconnectNotice gives a restart to bring
   sensor.uptime back (VERIFY_WAIT_MS). The clock runs from the first hold,
   not from each reconnect, so a flapping connection can't keep a deleted
   entity "loading". A timer ends the wait, not a clock read: onExpire tells
   socket.js's listeners to look again, with no batch needed. */
export const HELD_BACK_WAIT_MS = 5 * 60_000;

export function createHeldBack(onExpire) {
  const held = new Map(); // id -> the ids first held back with it, or null once that wait ran out
  let lastStore = {};     // the library's store, as last handed over
  let batch = null;       // ids first held back in the batch being sorted

  return {
    /* Whether `state` is the library's leftover copy of `id` rather than
       something HA sent on this connection. `first`: the first batch on it. */
    holds(id, state, first) {
      if (lastStore[id] !== state || !(first || held.has(id))) {
        held.delete(id);
        return false;
      }
      if (!held.has(id)) {
        batch ||= [];
        batch.push(id);
        held.set(id, batch);
      }
      return true;
    },
    /* After each batch: remember the store, forget what the library dropped,
       and start the wait for whatever this batch held back for the first time. */
    handedOver(entities) {
      lastStore = entities;
      for (const id of held.keys()) if (!Object.hasOwn(entities, id)) held.delete(id);
      const started = batch;
      batch = null;
      if (!started) return;
      setTimeout(() => {
        // Only ids still held from this batch: one HA sent meanwhile, and held
        // again after a later drop, is on a later batch's clock.
        for (const id of started) if (held.get(id) === started) held.set(id, null);
        onExpire();
      }, HELD_BACK_WAIT_MS);
    },
    has: (id) => held.has(id),
    /* Held back for less than HELD_BACK_WAIT_MS: HA may still be loading it. */
    isWaiting: (id) => Boolean(held.get(id)),
    /* Every id isWaiting is true for — for the readers of a whole domain or
       set of entities, which can't ask about an id they no longer see. */
    waiting: () => [...held].filter(([, started]) => started).map(([id]) => id),
  };
}
