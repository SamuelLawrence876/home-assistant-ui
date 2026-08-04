import { useState, useEffect, useMemo } from "react";
import { useNow } from "../../hooks/useNow.js";
import { useDashReady } from "../../hooks/useDashReady.js";
import { useEntitiesByDomain, useConnectionStatus } from "../../ha/useEntity.js";
import { useCalendarEvents } from "../../ha/useCalendarEvents.js";
import { Card } from "../../components/Card.jsx";
import { ymd } from "./dateUtils.js";
import { NewEventDialog } from "./NewEventDialog.jsx";
import { WeekGrid } from "./WeekGrid.jsx";
import { CAL_PALETTE, toGridEvents } from "./weekcalLayout.js";

/* ================================================================
   SCHEDULE — weekly calendar (Mon–Sun) over HA's calendar.* entities

   There is no mock fallback here by design. A week we cannot read and a
   week with nothing in it are different facts, and inventing events for
   either one is the failure mode this card used to have. See `weekState`.
   ================================================================*/

const START_HOUR = 8;
const END_HOUR = 22;
const SLOTS_PER_HOUR = 2;

/* Which of the honest states we're in, as the card's meta line plus an
   optional notice drawn over the (still full-size) week grid.

   The distinction the old mock fallback blurred: "we could not read this
   week" and "this week is empty" are different facts and get different
   words. Neither one gets filled in with invented events. */
function weekState({ connStatus, dashReady, liveMode, loading, error, eventCount }) {
  const connecting =
    connStatus === "connecting" ||
    connStatus === "authenticating" ||
    (connStatus === "ready" && !dashReady);
  const offline = connStatus !== "ready";

  /* Real events already on screen — a dropped socket doesn't make them
     untrue, so keep them visible and put the caveat in the meta line
     rather than covering the week with a notice. */
  if (eventCount > 0) {
    if (offline) return { meta: `${eventCount} events · not connected`, notice: null };
    if (error) return { meta: `${eventCount} events · may be out of date`, notice: null };
    return { meta: `${eventCount} events`, notice: null };
  }

  if (connecting) {
    return {
      meta: "connecting…",
      notice: {
        title: "Connecting to Home Assistant…",
        detail: "This week fills in as soon as the connection is up.",
      },
    };
  }
  if (offline) {
    return {
      meta: "not connected",
      notice: {
        title: "Calendar unavailable",
        detail: "Not connected to Home Assistant, so this week's events can't be read.",
      },
    };
  }
  if (!liveMode) {
    return {
      meta: "no calendars",
      notice: {
        title: "No calendars",
        detail: "Home Assistant isn't exposing any calendar entities to this dashboard.",
      },
    };
  }
  if (loading) {
    return { meta: "loading…", notice: { title: "Loading this week…", detail: null } };
  }
  if (error) {
    return {
      meta: "unavailable",
      notice: {
        title: "Calendar unavailable",
        detail: "Home Assistant didn't answer for this week, so we don't know what's on.",
      },
    };
  }
  return {
    meta: "no events",
    notice: { title: "No events this week", detail: "Nothing scheduled between Monday and Sunday." },
  };
}

export function WeeklyCalendarCard({ index = 0 }) {
  /* Today / this-week boundaries, computed live. This is a wall dashboard
     that stays open for days, so the date has to roll over on its own:
     `now` already ticks every 30s, and `dayKey` only changes when the local
     calendar date does — which then re-derives `today`, the week range
     fetched from HA and the highlighted column. */
  const now = useNow();
  const [dayKey, setDayKey] = useState(() => ymd(new Date()));
  useEffect(() => {
    const k = ymd(new Date());
    setDayKey((cur) => (cur === k ? cur : k));
  }, [now]);
  /* Deliberately keyed on `dayKey` and nothing else: `new Date()` is not a
     dependency the linter can see, and re-reading the clock on any other
     render is exactly the bug this shape exists to prevent. */
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dayKey]);
  const weekStart = useMemo(() => {
    const d = new Date(today);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow);
    return d;
  }, [today]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);
  const todayDow = (today.getDay() + 6) % 7;
  /* Display label only — must be local-time YYYY-MM-DD, not toISOString()
     which would shift positive-UTC-offset locales to the previous day. */
  const weekStartISO = ymd(weekStart);

  /* Discover live calendar entities (HA's calendar.* domain). */
  const connStatus = useConnectionStatus();
  const dashReady = useDashReady();
  const calendarEntities = useEntitiesByDomain("calendar");
  /* Keyed on the *contents* of the entity list, not the array identity:
     `useEntitiesByDomain` hands back a fresh array on every state batch, and
     a new `calendarIds` array is a new fetch key downstream. */
  const calendarIds = useMemo(
    () => calendarEntities.map((e) => e.entity_id).sort(),
    [calendarEntities.length, calendarEntities.map((e) => e.entity_id).join(",")],
  );
  const liveMode = calendarIds.length > 0;

  /* Color + label map: cycle the 4-var palette across whatever calendars exist. */
  const calendars = useMemo(() => {
    const out = {};
    calendarEntities
      .slice()
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .forEach((e, i) => {
        out[e.entity_id] = {
          color: CAL_PALETTE[i % CAL_PALETTE.length],
          label: e.attributes?.friendly_name || e.entity_id.replace(/^calendar\./, ""),
        };
      });
    return out;
  }, [calendarEntities]);

  /* Fetch this week's events from HA's REST calendar API. */
  const { events: liveEventsRaw, loading, error, refresh } = useCalendarEvents(
    liveMode ? calendarIds : [],
    weekStart.toISOString(),
    weekEnd.toISOString(),
  );

  const events = useMemo(
    () => (liveMode ? toGridEvents(liveEventsRaw, weekStart) : []),
    [liveMode, liveEventsRaw, weekStart],
  );
  const eventCount = useMemo(() => new Set(events.map((e) => e.evId)).size, [events]);

  /* Dialog uses mount/unmount: `dialog === null` means closed.
     `{ initial: { date, startTime, endTime } | null }` means open with
     those pre-fills (null = today + next hour defaults). */
  const [dialog, setDialog] = useState(null);
  const dialogCalendars = useMemo(
    () => Object.entries(calendars).map(([entity_id, c]) => ({ entity_id, label: c.label })),
    [calendars],
  );

  const { meta, notice } = weekState({ connStatus, dashReady, liveMode, loading, error, eventCount });
  const legend = Object.entries(calendars);

  return (
    <Card
      index={index}
      eyebrow={`Calendar · week of ${weekStartISO}`}
      title="This week"
      meta={meta}
      headRight={
        liveMode ? (
          <button
            className="add-btn-mini"
            onClick={() => setDialog({ initial: null })}
            aria-label="Add event"
          >
            + Add event
          </button>
        ) : null
      }
    >
      {dialog && (
        <NewEventDialog
          onClose={() => setDialog(null)}
          calendars={dialogCalendars}
          defaultCalendarId={calendarIds[0]}
          initial={dialog.initial}
          onCreated={refresh}
        />
      )}

      <WeekGrid
        weekStart={weekStart}
        todayDow={todayDow}
        events={events}
        calendars={calendars}
        startHour={START_HOUR}
        endHour={END_HOUR}
        slotsPerHour={SLOTS_PER_HOUR}
        now={now}
        clickable={liveMode}
        onSlotClick={(initial) => setDialog({ initial })}
        notice={notice}
      />

      {legend.length > 0 && (
        <div className="cal-legend">
          {legend.map(([id, c]) => (
            <span key={id} className="item">
              <span className="sw" style={{ "--cal-color": c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
