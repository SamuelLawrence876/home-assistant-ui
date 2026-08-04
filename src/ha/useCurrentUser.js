/* useCurrentUser — who is logged into this HA session.
 *
 * Sends `auth/current_user` once the shared WS connection is ready and
 * caches the result at module level (one fetch per page load, shared by
 * all subscribers). Returns null until resolved or when disconnected.
 *
 * Shape: { id, name, is_owner, is_admin, credentials, mfa_modules } */

import { useSyncExternalStore } from "react";
import { onConnectionChange, sendWsMessage, waitForConnection } from "./socket.js";

let currentUser = null;
let fetchStarted = false;
const listeners = new Set();

function fetchCurrentUser(force = false) {
  if (fetchStarted && !force) return;
  fetchStarted = true;
  waitForConnection()
    .then(() => sendWsMessage({ type: "auth/current_user" }))
    .then((user) => {
      currentUser = user;
      listeners.forEach((cb) => cb());
    })
    .catch((err) => {
      console.warn("[ha-user] auth/current_user failed", err);
      fetchStarted = false; // allow retry on the next subscriber or reconnect
    });
}

/* Re-resolve on every reconnect. The retry above could never actually fire:
   the only caller is a React subscription, and App — the sole consumer —
   mounts once per page load. So one blown `auth/current_user` (an HA restart
   or a Funnel blip mid-handshake) left `currentUser` null for the life of the
   page, and roles.js fails closed to `guest` — the owner lost every tab but
   Overview until he reloaded.

   The previous user is deliberately kept until the new answer lands, so a
   reconnect doesn't flash the nav down to a single tab. */
onConnectionChange((status) => {
  if (status === "ready") fetchCurrentUser(true);
});

function subscribeUser(callback) {
  listeners.add(callback);
  fetchCurrentUser();
  return () => listeners.delete(callback);
}

export function useCurrentUser() {
  return useSyncExternalStore(subscribeUser, () => currentUser);
}
