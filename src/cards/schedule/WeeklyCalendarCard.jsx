import { useState, useMemo } from "react";
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

/* HA event → { day, start, end } in the visible week's local time.
   `start`/`end` are floats (hours, e.g. 14.5 = 2:30pm).
   `day` is 0-6 where 0 = Monday. Events outside [0,6] are dropped. */
function haEventToGridPos(ev, weekStartLocal) {
  const isAllDay = !ev.start?.dateTime;
  const startStr = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
  const endStr = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00` : null);
  if (!startStr || !endStr) return null;
  const sd = new Date(startStr);
  const ed = new Date(endStr);
  if (isNaN(sd) || isNaN(ed)) return null;

  // Day index relative to Monday-of-week, in local time.
  const dayMs = 24 * 3600 * 1000;
  const sLocalMidnight = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
  const wsMidnight = weekStartLocal.getTime();
  const day = Math.round((sLocalMidnight - wsMidnight) / dayMs);
  if (day < 0 || day > 6) return null;

  if (isAllDay) {
    // Render all-day events as a thin top-of-day bar so they're visible
    // without dominating the column.
    return { day, start: 0, end: 0.5, allDay: true };
  }
  const start = sd.getHours() + sd.getMinutes() / 60;
  const sameDay =
    ed.getFullYear() === sd.getFullYear() &&
    ed.getMonth() === sd.getMonth() &&
    ed.getDate() === sd.getDate();
  const end = sameDay ? ed.getHours() + ed.getMinutes() / 60 : 24;
  return { day, start, end, allDay: false };
}

export function WeeklyCalendarCard({ index = 0 }) {
  const mock = GH_DATA.schedule;
  const startHour = 8;
  const endHour = 22;
  const slotsPerHour = 2;
  const slotPx = 26;

  /* Today / this-week boundaries, computed live (not from mock today_iso). */
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
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

  /* Transform HA events → grid-positioned events the renderer expects. */
  const events = useMemo(() => {
    if (!liveMode) return mock.events;
    const out = [];
    for (const ev of liveEventsRaw) {
      const pos = haEventToGridPos(ev, weekStart);
      if (!pos) continue;
      out.push({
        id: ev.uid || `${ev.cal_entity_id}-${ev.summary}-${ev.start?.dateTime || ev.start?.date}`,
        cal: ev.cal_entity_id,
        day: pos.day,
        start: pos.start,
        end: pos.end,
        allDay: pos.allDay,
        title: ev.summary || "(untitled)",
        where: ev.location || "",
      });
    }
    return out;
  }, [liveMode, liveEventsRaw, weekStart, mock.events]);

  const now = useNow();
  const nowOffset = (now - startHour) * 2 * slotPx;
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
      : `${events.length} events`
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
      <div className="weekcal">
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
                height: ((endHour - startHour) * slotsPerHour + 1) * slotPx,
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
