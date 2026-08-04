import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { GH_DATA } from "../../data.js";
import { useNow } from "../../hooks/useNow.js";
import { useEntitiesByDomain } from "../../ha/useEntity.js";
import { useCalendarEvents } from "../../ha/useCalendarEvents.js";
import { Card } from "../../components/Card.jsx";
import { ymd } from "../../cards/schedule/dateUtils.js";
import { NewEventDialog } from "../../cards/schedule/NewEventDialog.jsx";

/* ================================================================
   SCHEDULE — weekly calendar + kanban board
   ================================================================*/
const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* Greedy lane layout for one day's in-grid events. Each event gets a
   `lane` index and a `totalLanes` count for its overlap group so that
   events sharing a time slot render side-by-side instead of stacking. */
function layoutEventsInDay(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds = []; // last `end` per lane
  const out = [];
  for (const ev of sorted) {
    let lane = laneEnds.findIndex((end) => end <= ev.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.end);
    } else {
      laneEnds[lane] = ev.end;
    }
    out.push({ ...ev, _lane: lane });
  }
  /* totalLanes for each event = (max lane index of any directly-overlapping
     event in the same day) + 1. Direct overlaps only — but because lanes
     are reused greedily, this correctly handles disjoint overlap groups. */
  for (const ev of out) {
    let maxLane = ev._lane;
    for (const other of out) {
      if (other === ev) continue;
      if (other.start < ev.end && other.end > ev.start) {
        if (other._lane > maxLane) maxLane = other._lane;
      }
    }
    ev._totalLanes = maxLane + 1;
  }
  return out;
}

/* 4-var palette defined in styles.css — cycled per live calendar entity */
const CAL_PALETTE = [
  "var(--cal-work)",
  "var(--cal-personal)",
  "var(--cal-home)",
  "var(--cal-family)",
];

/* HA event → one { day, start, end } per day of the visible week it covers.
   `start`/`end` are floats (hours, e.g. 14.5 = 2:30pm).
   `day` is 0-6 where 0 = Monday. Returns [] if the span misses the week.

   HA returns a single object per event even when it runs over several days
   (all-day events carry an *exclusive* end.date), so a Mon–Wed trip has to be
   exploded into one entry per covered day. The span is clipped to the visible
   week, which also keeps events that started before Monday on the board. */
function haEventToGridPositions(ev, weekStartLocal) {
  const isAllDay = !ev.start?.dateTime;
  const startStr = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
  const endStr = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00` : null);
  if (!startStr || !endStr) return [];
  const sd = new Date(startStr);
  const ed = new Date(endStr);
  if (isNaN(sd) || isNaN(ed)) return [];

  // Day indices relative to Monday-of-week, in local time. Rounding absorbs
  // the 23h/25h gap between local midnights across a DST change.
  const dayMs = 24 * 3600 * 1000;
  const wsMidnight = weekStartLocal.getTime();
  const midnightOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayIndex = (ms) => Math.round((ms - wsMidnight) / dayMs);

  const firstDay = dayIndex(midnightOf(sd));
  /* An end that lands exactly on midnight belongs to the previous day —
     that's how all-day end.date is defined, and a 22:00–00:00 meeting
     shouldn't paint the next morning either. */
  const endsAtMidnight = ed.getTime() === midnightOf(ed);
  let lastDay = dayIndex(midnightOf(ed)) - (endsAtMidnight ? 1 : 0);
  // Single-day all-day events from feeds that send a non-exclusive end.
  if (isAllDay && lastDay < firstDay) lastDay = firstDay;
  if (lastDay < firstDay) return [];

  const from = Math.max(firstDay, 0);
  const to = Math.min(lastDay, 6);
  if (to < from) return []; // whole span sits outside the visible week

  const spanStart = sd.getHours() + sd.getMinutes() / 60;
  const spanEnd = endsAtMidnight ? 24 : ed.getHours() + ed.getMinutes() / 60;

  const out = [];
  for (let day = from; day <= to; day++) {
    if (isAllDay) {
      // Render all-day events as a thin top-of-day bar so they're visible
      // without dominating the column.
      out.push({ day, start: 0, end: 0.5, allDay: true });
      continue;
    }
    const start = day === firstDay ? spanStart : 0;
    const end = day === lastDay ? spanEnd : 24;
    // Zero-length events would otherwise render as an invisible sliver.
    out.push({ day, start, end: Math.max(end, start + 0.25), allDay: false });
  }
  return out;
}

/* First-paint value only, until the real one is read off the DOM. Matches the
   desktop `--col-h` so the pre-measurement frame is already correct there. */
const SLOT_PX_FALLBACK = 26;

export function WeeklyCalendarCard({ index = 0 }) {
  const mock = GH_DATA.schedule;
  const startHour = 8;
  const endHour = 22;
  const slotsPerHour = 2;

  /* The 30-minute row height is owned by schedule.css (`--col-h`: 26px, 22px
     under body.viewport-phone) because it draws the hour gutter and the column
     gridlines. Read it back rather than keeping a second copy of the number
     here — the two disagreeing is what pushed every phone event progressively
     further down the day (~2h late by evening) and dragged the now-line with
     it. CSS stays the single source of truth. */
  const gridRef = useRef(null);
  const [slotPx, setSlotPx] = useState(SLOT_PX_FALLBACK);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const px = parseFloat(getComputedStyle(el).getPropertyValue("--col-h"));
      if (px > 0) setSlotPx((cur) => (cur === px ? cur : px));
    };
    measure();
    /* Re-measure on resize: crossing the phone breakpoint swaps `--col-h`
       and always changes the grid's width along with it. */
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Today / this-week boundaries, computed live (not from mock today_iso).
     This is a wall dashboard that stays open for days, so the date has to
     roll over on its own: `now` already ticks every 30s, and `dayKey` only
     changes when the local calendar date does — which then re-derives
     `today`, the week range fetched from HA and the highlighted column. */
  const now = useNow();
  const [dayKey, setDayKey] = useState(() => ymd(new Date()));
  useEffect(() => {
    const k = ymd(new Date());
    setDayKey((cur) => (cur === k ? cur : k));
  }, [now]);
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
  const weekStartISO = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;

  /* Discover live calendar entities (HA's calendar.* domain). */
  const calendarEntities = useEntitiesByDomain("calendar");
  const calendarIds = useMemo(
    () => calendarEntities.map((e) => e.entity_id).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarEntities.length, calendarEntities.map((e) => e.entity_id).join(",")],
  );
  const liveMode = calendarIds.length > 0;

  /* Color + label map: cycle the 4-var palette across whatever calendars exist. */
  const calendars = useMemo(() => {
    if (!liveMode) return mock.calendars;
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
  }, [liveMode, calendarEntities, mock.calendars]);

  /* Fetch this week's events from HA's REST calendar API. */
  const { events: liveEventsRaw, loading, refresh } = useCalendarEvents(
    liveMode ? calendarIds : [],
    weekStart.toISOString(),
    weekEnd.toISOString(),
  );

  /* Dialog uses mount/unmount: `dialog === null` means closed.
     `{ initial: { date, startTime, endTime } | null }` means open with
     those pre-fills (null = today + next hour defaults). */
  const [dialog, setDialog] = useState(null);
  const dialogCalendars = useMemo(
    () =>
      Object.entries(calendars).map(([entity_id, c]) => ({
        entity_id,
        label: c.label,
      })),
    [calendars],
  );

  /* Click anywhere in a day column → snap to nearest 30-min slot and
     open the new-event dialog pre-filled with that day/time. */
  function onColClick(ev, day) {
    if (!liveMode) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const hourFloat = startHour + y / (slotsPerHour * slotPx);
    const snapped = Math.floor(hourFloat * slotsPerHour) / slotsPerHour; // round down to 30 min
    const start = Math.max(startHour, Math.min(snapped, endHour));
    const end = Math.min(start + 1, 23.5);
    const fmt = (h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + day);
    setDialog({
      initial: { date: ymd(dayDate), startTime: fmt(start), endTime: fmt(end) },
    });
  }

  /* Transform HA events → grid-positioned events the renderer expects.
     A multi-day event yields one entry per day, all sharing an `evId` so the
     header count still reads as events rather than day-slices. */
  const events = useMemo(() => {
    if (!liveMode) return mock.events;
    const out = [];
    for (const ev of liveEventsRaw) {
      const evId = ev.uid || `${ev.cal_entity_id}-${ev.summary}-${ev.start?.dateTime || ev.start?.date}`;
      for (const pos of haEventToGridPositions(ev, weekStart)) {
        out.push({
          id: `${evId}-d${pos.day}`,
          evId,
          cal: ev.cal_entity_id,
          day: pos.day,
          start: pos.start,
          end: pos.end,
          allDay: pos.allDay,
          title: ev.summary || "(untitled)",
          where: ev.location || "",
        });
      }
    }
    return out;
  }, [liveMode, liveEventsRaw, weekStart, mock.events]);

  const eventCount = useMemo(
    () => (liveMode ? new Set(events.map((e) => e.evId)).size : events.length),
    [liveMode, events],
  );

  const nowOffset = (now - startHour) * slotsPerHour * slotPx;
  const showNow = now >= startHour && now <= endHour;

  function hourLabel(h) {
    const hh = Math.floor(h);
    return `${String(hh).padStart(2, "0")}:00`;
  }

  function eventTimeLabel(start, end, allDay) {
    if (allDay) return "All day";
    const fmt = (h) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    return `${fmt(start)}–${fmt(end)}`;
  }

  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const metaText = liveMode
    ? loading && events.length === 0
      ? "loading…"
      : `${eventCount} events`
    : `${mock.events.length} events · mock`;

  return (
    <Card
      index={index}
      eyebrow={`Calendar · week of ${weekStartISO}`}
      title="This week"
      meta={metaText}
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
      <div className="weekcal" ref={gridRef}>
        <div className="weekcal-head">
          <div className="corner" />
          {DOWS.map((d, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            return (
              <div key={d} className={`dow ${i === todayDow ? "today" : ""}`}>
                {d}
                <span className="num">{date.getDate()}</span>
              </div>
            );
          })}
        </div>

        {/* Dedicated off-grid row sits between the day header and the
            timed grid — holds all-day, before-grid, and after-grid pills
            so they don't render inside the column where they'd read as
            floating in the day-header strip. */}
        <div className="weekcal-offgrid-row">
          <div className="corner" />
          {DOWS.map((_, day) => {
            const dayOffgrid = events.filter(
              (e) => e.day === day && (e.allDay || e.end <= startHour || e.start >= endHour + 1),
            );
            return (
              <div key={day} className={`cell ${day === todayDow ? "today" : ""}`}>
                {dayOffgrid.map((e) => {
                  const calVar = calendars[e.cal]?.color || CAL_PALETTE[0];
                  const tooltip = `${e.title}\n${eventTimeLabel(e.start, e.end, e.allDay)}${e.where ? `\n${e.where}` : ""}`;
                  const prefix = e.allDay ? "⛶" : e.end <= startHour ? "↑" : "↓";
                  const timeBit = e.allDay ? "" : ` ${eventTimeLabel(e.start, e.end)} ·`;
                  return (
                    <div
                      key={e.id}
                      className="weekcal-offgrid"
                      style={{ "--cal-color": calVar }}
                      title={tooltip}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {prefix}{timeBit} {e.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="weekcal-times">
          {hours.map((h) => (
            <div key={h} className="h">
              {hourLabel(h)}
            </div>
          ))}
        </div>

        {DOWS.map((_, day) => {
          const dayInGrid = events.filter(
            (e) => e.day === day && !e.allDay && e.end > startHour && e.start < endHour + 1,
          );
          const laidOut = layoutEventsInDay(dayInGrid);
          return (
            <div
              key={day}
              className={`weekcal-col ${day === todayDow ? "today" : ""} ${liveMode ? "clickable" : ""}`}
              style={{
                /* Exactly as tall as the hour gutter beside it — one row per
                   label in `hours`, the last of which runs to endHour + 1.
                   That is also where in-grid events are clipped, so nothing
                   is cut off and no ruled grid hangs past the last label. */
                height: (endHour + 1 - startHour) * slotsPerHour * slotPx,
              }}
              onClick={(ev) => onColClick(ev, day)}
            >
              {day === todayDow && showNow && <div className="weekcal-now" style={{ top: nowOffset }} />}
              {laidOut.map((e) => {
                const calVar = calendars[e.cal]?.color || CAL_PALETTE[0];
                const tooltip = `${e.title}\n${eventTimeLabel(e.start, e.end, e.allDay)}${e.where ? `\n${e.where}` : ""}`;
                const visibleStart = Math.max(e.start, startHour);
                const visibleEnd = Math.min(e.end, endHour + 1);
                const top = (visibleStart - startHour) * slotsPerHour * slotPx;
                const h = (visibleEnd - visibleStart) * slotsPerHour * slotPx;
                const short = h < 36;
                /* Lane-based horizontal split. Inline left + width override
                   the CSS defaults of left:4px right:4px so overlapping
                   events sit next to each other with a small gutter. */
                const widthPct = 100 / e._totalLanes;
                const leftPct = e._lane * widthPct;
                const positioning = e._totalLanes > 1
                  ? {
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      right: "auto",
                    }
                  : null;
                return (
                  <div
                    key={e.id}
                    className={`weekcal-event ${short ? "short" : ""}`}
                    style={{ top, height: h, "--cal-color": calVar, ...positioning }}
                    title={tooltip}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="t">{e.title}</div>
                    <div className="w">
                      {eventTimeLabel(e.start, e.end, e.allDay)}
                      {e.where ? ` · ${e.where}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {Object.entries(calendars).map(([id, c]) => (
          <span key={id} className="item">
            <span className="sw" style={{ "--cal-color": c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </Card>
  );
}
