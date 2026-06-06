/* useCurrentUser — who is logged into this HA session.
 *
 * Sends `auth/current_user` once the shared WS connection is ready and
 * caches the result at module level (one fetch per page load, shared by
 * all subscribers). Returns null until resolved or when disconnected.
 *
 * Shape: { id, name, is_owner, is_admin, credentials, mfa_modules } */

import { useSyncExternalStore } from "react";
import { sendWsMessage, waitForConnection } from "./socket.js";

let currentUser = null;
let fetchStarted = false;
const listeners = new Set();

function fetchCurrentUser() {
  if (fetchStarted) return;
  fetchStarted = true;
  waitForConnection()
    .then(() => sendWsMessage({ type: "auth/current_user" }))
    .then((user) => {
      currentUser = user;
      listeners.forEach((cb) => cb());
    })
    .catch((err) => {
      console.warn("[ha-user] auth/current_user failed", err);
      fetchStarted = false; // allow retry on next subscriber
    });
}

function subscribeUser(callback) {
  listeners.add(callback);
  fetchCurrentUser();
  return () => listeners.delete(callback);
}

export function useCurrentUser() {
  return useSyncExternalStore(subscribeUser, () => currentUser);
}
