/* Daily/hourly forecast for a Home Assistant weather entity.

   Home Assistant emptied `weather.*` `attributes.forecast` in 2024. The numbers
   now come back only from the `weather.get_forecasts` service, which answers
   with a response body (`return_response: true`) instead of pushing state. So
   this is a fetch on a schedule, not a subscription, and it needs an explicit
   refresh policy rather than an incidental one.

   The policy, deliberately:
     - fetch once as soon as the socket is ready
     - fetch again whenever the socket comes back, because the effect is keyed
       on "is the connection ready" and a drop/reconnect re-runs it
     - otherwise re-fetch on a fixed hourly timer

   No clock value ever reaches the dependency array here, and nothing re-fetches
   because a render happened. See LESSONS.md pattern 1: a card on this same tab
   read `new Date()` during render, fed it into a dependency array, and hammered
   the Pi 5-20 times a second forever.

   Returns { forecast, status } with status "loading" | "unavailable" | "ready".
   There is no stale mode on purpose. A refresh that fails reports unavailable
   rather than leaving an old strip on screen looking current. */

import { useEffect, useState } from "react";
import { getForecast } from "./client.js";
import { useConnectionStatus } from "./useEntity.js";

const REFRESH_MS = 60 * 60 * 1000; // hourly — the met.no integration publishes far less often
const RETRY_MS = 5 * 60 * 1000; // a failed call retries sooner than the next scheduled hour

const LOADING = { forecast: [], status: "loading" };
const UNAVAILABLE = { forecast: [], status: "unavailable" };

export function useForecast(entityId, type = "daily") {
  const connStatus = useConnectionStatus();
  const ready = connStatus === "ready";
  const [state, setState] = useState(LOADING);

  useEffect(() => {
    if (!entityId) return undefined;

    // Not connected (yet, or any more). Don't keep asserting a forecast we have
    // no way to refresh; the caller renders its own "loading" treatment.
    if (!ready) {
      setState((prev) => (prev.status === "loading" ? prev : LOADING));
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    const run = async () => {
      let ok = false;
      try {
        const fc = await getForecast(entityId, type);
        if (cancelled) return;
        ok = Array.isArray(fc) && fc.length > 0;
        setState(ok ? { forecast: fc, status: "ready" } : UNAVAILABLE);
      } catch (e) {
        if (cancelled) return;
        console.warn("[useForecast] weather.get_forecasts failed", entityId, e);
        setState(UNAVAILABLE);
      }
      if (!cancelled) timer = setTimeout(run, ok ? REFRESH_MS : RETRY_MS);
    };

    run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [entityId, type, ready]);

  return state;
}
