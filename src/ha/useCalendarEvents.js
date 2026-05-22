/* Calendar events hook.

   HA's calendar API is REST-only — events aren't streamed over the WS like
   entity state. We fetch the visible range per calendar entity and refetch
   when range / entity list changes (or when refresh() is called manually).

   Usage:
     const { events, loading, error, refresh } =
       useCalendarEvents(["calendar.icloud_personal"], startISO, endISO);

   Each event in the returned list is augmented with:
     - cal_entity_id  (which calendar it came from — for color mapping)

   Times in HA's response are either:
     - { dateTime: "2026-05-22T10:00:00-07:00" }  (timed event, with TZ offset)
     - { date: "2026-05-22" }                      (all-day event)
   We pass them through untouched; the consumer converts to local hours-of-day.
*/

import { useEffect, useState, useRef, useCallback } from "react";
import { getHaUrl, getAccessToken, getConnectionStatus, onConnectionChange } from "./socket.js";

async function fetchOne(entityId, startISO, endISO) {
  const url = getHaUrl();
  const token = getAccessToken();
  if (!url || !token) throw new Error("HA not configured");
  const path = `/api/calendars/${encodeURIComponent(entityId)}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA GET ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  const arr = await res.json();
  return arr.map((ev) => ({ ...ev, cal_entity_id: entityId }));
}

export function useCalendarEvents(entityIds, startISO, endISO) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const key = `${(entityIds || []).join(",")}|${startISO}|${endISO}`;
  const [connectionTick, setConnectionTick] = useState(0);

  // Re-fetch once the WS becomes ready (we may have rendered before tokens existed).
  useEffect(() => {
    return onConnectionChange((s) => {
      if (s === "ready") setConnectionTick((t) => t + 1);
    });
  }, []);

  const run = useCallback(async () => {
    if (!entityIds || entityIds.length === 0 || !startISO || !endISO) {
      setEvents([]);
      return;
    }
    if (getConnectionStatus() !== "ready") return; // wait for socket-ready tick
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const lists = await Promise.all(
        entityIds.map((eid) =>
          fetchOne(eid, startISO, endISO).catch((e) => {
            console.warn(`[useCalendarEvents] ${eid} failed`, e);
            return [];
          }),
        ),
      );
      if (id !== reqIdRef.current) return; // a newer call superseded us
      setEvents(lists.flat());
    } catch (e) {
      if (id !== reqIdRef.current) return;
      setError(e);
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connectionTick]);

  return { events, loading, error, refresh: run };
}
