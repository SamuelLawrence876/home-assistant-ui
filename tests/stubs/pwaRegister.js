/* Test-only stand-in for `virtual:pwa-register/react`.

   vite-plugin-pwa emits that module at BUILD time (vite.config.js), and
   vitest.config.js deliberately does not load the plugin — so UpdatePrompt's
   import cannot resolve under vitest. A `vi.mock` is too late: Vite's import
   analysis fails before any mock applies. Wired via a resolve alias in
   vitest.config.js instead.

   Unlike a plain "always false" stub, this one is drivable, because the whole
   point of UpdatePrompt is what happens when an update DOES arrive: tests call
   __arriveUpdate() to fire the real hook's state change, and read __updateCalls
   to assert the Refresh button asked for a reloading swap. */

import { useState, useEffect } from "react";

const state = {
  registration: null,
  registerError: null,
  updateCalls: [],
};

const setters = new Set();

/** Configure the next mount. Call in beforeEach. */
export function __reset({ registration = null, registerError = null } = {}) {
  state.registration = registration;
  state.registerError = registerError;
  state.updateCalls = [];
  setters.clear();
}

/** Arguments the component passed to updateServiceWorker(), in order. */
export function __updateCalls() {
  return state.updateCalls;
}

/** Simulate the service worker finding a newer build. Wrap in act(). */
export function __arriveUpdate() {
  setters.forEach((set) => set(true));
}

export function useRegisterSW(opts = {}) {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    setters.add(setNeedRefresh);
    if (state.registerError) opts.onRegisterError?.(state.registerError);
    else opts.onRegisteredSW?.("/sw.js", state.registration);
    return () => setters.delete(setNeedRefresh);
  }, []);

  return {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker: (reloadPage) => {
      state.updateCalls.push(reloadPage);
      return Promise.resolve();
    },
  };
}
