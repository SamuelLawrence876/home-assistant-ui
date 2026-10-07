import { useState, useEffect, useMemo } from "react";
import { useNow } from "../../hooks/useNow.js";
import { useDashReady } from "../../hooks/useDashReady.js";
import { useEntitiesByDomain, useConnectionStatus } from "../../ha/useEntity.js";
import { useCalendarEvents } from "../../ha/useCalendarEvents.js";
import { Card } from "../../components/Card.jsx";
import { ymd, dateNow } from "./dateUtils.js";
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

/* HA's CalendarEntityFeature.CREATE_EVENT. */
const CREATE_EVENT = 1;
const NONE = [];

/* Whether calendar.create_event can land in this calendar: true / false when
   supported_features says, null when the attribute isn't there to ask. */
function canCreate(attributes) {
  const f = attributes?.supported_features;
  if (typeof f !== "number" || !Number.isFinite(f)) return null;
  return (f & CREATE_EVENT) === CREATE_EVENT;
}

/* The dialog's starting calendar: the first live one that says it takes new
   events, else the first live one that doesn't say either way. Never a dead
   one — HA skips an unavailable target and still reports success, so the
   old `calendarIds[0]` default could "create" an event nowhere. "" when no
   calendar qualifies; the dialog then can't submit. */
function pickDefaultCalendar(list) {
  const live = list.filter((c) => !c.dead);
  return (live.find((c) => c.creatable === true) || live.find((c) => c.creatable !== false))?.entity_id || "";
}

/* Which of the honest states we're in, as the card's meta line plus an
   optional notice drawn over the (still full-size) week grid.

   The distinction the old mock fallback blurred: "we could not read this
   week" and "this week is empty" are different facts and get different
   words. Neither one gets filled in with invented events.

   `failedLabels` is set when only some calendars could be read. Then the
   gap is one named calendar, not the whole week, and saying "may be out of
   date" left a dead Work calendar reading as a quiet one.

   `waiting`: HA may still be loading a calendar this page had before a
   reconnect (useEntity.js). After every Restart HA it read "No calendars",
   or a plain count without that calendar's events. With none listed at all,
   `error` and `loading` can only be about calendars that aren't: first. */
function weekState({ connStatus, dashReady, liveMode, loading, error, eventCount, failedLabels = [], calendarCount = 0, waiting = false }) {
  const connecting =
    connStatus === "connecting" ||
    connStatus === "authenticating" ||
    (connStatus === "ready" && !dashReady);
  const offline = connStatus !== "ready";
  const partial = error && failedLabels.length > 0 && failedLabels.length < calendarCount;
  const failedList = failedLabels.join(", ");

  /* Real events already on screen — a dropped socket doesn't make them
     untrue, so keep them visible and put the caveat in the meta line
     rather than covering the week with a notice. */
  if (eventCount > 0) {
    if (offline) return { meta: `${eventCount} events · not connected`, notice: null };
    if (partial) return { meta: `${eventCount} events · ${failedList} unavailable`, notice: null };
    if (error) return { meta: `${eventCount} events · may be out of date`, notice: null };
    if (waiting) return { meta: `${eventCount} events · some calendars loading`, notice: null };
    return { meta: `${eventCount} events`, notice: null };
  }
  const loadingWeek = { meta: "loading…", notice: { title: "Loading this week…", detail: null } };

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
    if (waiting) return loadingWeek;
    return {
      meta: "no calendars",
      notice: {
        title: "No calendars",
        detail: "Home Assistant isn't exposing any calendar entities to this dashboard.",
      },
    };
  }
  if (loading) return loadingWeek;
  if (error) {
    return {
      meta: partial ? `${failedList} unavailable` : "unavailable",
      notice: {
        title: "Calendar unavailable",
        detail: partial
          ? `Couldn't read ${failedList}, so this week may not be as empty as it looks.`
          : "Home Assistant didn't answer for this week, so we don't know what's on.",
      },
    };
  }
  if (waiting) return loadingWeek; // "no events" would leave that calendar out
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
  const [dayKey, setDayKey] = useState(() => ymd(dateNow()));
  useEffect(() => {
    const k = ymd(dateNow());
    setDayKey((cur) => (cur === k ? cur : k));
  }, [now]);
  /* Deliberately keyed on `dayKey` and nothing else: dateNow() is not a
     dependency the linter can see, and re-reading the clock on any other
     render is exactly the bug this shape exists to prevent. (dateNow, not
     new Date(): the screenshot gates pin ?today= through it.) */
  const today = useMemo(() => {
    const d = dateNow();
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
  const loadingIds = calendarEntities.loadingIds || NONE;
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
  const { events: liveEventsRaw, loading, error, failedIds = [], refresh } = useCalendarEvents(
    liveMode ? calendarIds : [],
    weekStart.toISOString(),
    weekEnd.toISOString(),
  );
  // Only calendars still on the board: one HA just removed can sit in
  // failedIds until the next run lands, and naming it would be noise.
  const failedLabels = failedIds.filter((id) => calendars[id]).map((id) => calendars[id].label);

  /* Only calendars HA lists now: one it removed, or hasn't sent back since a
     reconnect, keeps its events in the hook until the new list's run lands. */
  const events = useMemo(() => {
    const listed = new Set(calendarIds);
    return toGridEvents(liveEventsRaw.filter((ev) => listed.has(ev.cal_entity_id)), weekStart);
  }, [calendarIds, liveEventsRaw, weekStart]);
  const eventCount = useMemo(() => new Set(events.map((e) => e.evId)).size, [events]);

  /* Dialog uses mount/unmount: `dialog === null` means closed.
     `{ initial: { date, startTime, endTime } | null }` means open with
     those pre-fills (null = today + next hour defaults). */
  const [dialog, setDialog] = useState(null);
  /* Each calendar's current liveness travels with it, so the dialog can grey
     out a dead one and refuse a create into it rather than report success. */
  const dialogCalendars = useMemo(
    () =>
      calendarEntities
        .slice()
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
        .map((e) => ({
          entity_id: e.entity_id,
          label: calendars[e.entity_id]?.label || e.entity_id.replace(/^calendar\./, ""),
          dead: e.state === "unavailable" || e.state === "unknown",
          creatable: canCreate(e.attributes),
        })),
    [calendarEntities, calendars],
  );

  const { meta, notice } = weekState({
    connStatus,
    dashReady,
    liveMode,
    loading,
    error,
    eventCount,
    failedLabels,
    calendarCount: calendarIds.length,
    waiting: loadingIds.length > 0,
  });
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
          loadingIds={loadingIds}
          defaultCalendarId={pickDefaultCalendar(dialogCalendars)}
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
          {/* A calendar we couldn't read says so where its colour is
              explained, so none of the grid reads as "nothing on" for it.
              Text rather than a style: schedule.css is not ours here. */}
          {legend.map(([id, c]) => {
            const failed = error && failedIds.includes(id);
            return (
              <span
                key={id}
                className="item"
                title={failed ? "Couldn't read this calendar just now. Any of its events shown are the last ones we saw." : undefined}
              >
                <span className="sw" style={{ "--cal-color": c.color }} />
                {c.label}
                {failed ? " · unavailable" : ""}
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}
