/* Pure layout maths + formatting for the weekly calendar grid.

   No React and no JSX in here on purpose: WeeklyCalendarCard.jsx (which owns
   the week range and the HA fetch) and WeekGrid.jsx (which owns the DOM) both
   read from this file, so the geometry lives in exactly one place. */

export const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* 4-var palette defined in schedule.css — cycled per live calendar entity */
export const CAL_PALETTE = [
  "var(--cal-work)",
  "var(--cal-personal)",
  "var(--cal-home)",
  "var(--cal-family)",
];

/* First-paint value only, until the real one is read off the DOM. Matches the
   desktop `--col-h` so the pre-measurement frame is already correct there. */
export const SLOT_PX_FALLBACK = 26;

/* Greedy lane layout for one day's in-grid events. Each event gets a
   `lane` index and a `totalLanes` count for its overlap group so that
   events sharing a time slot render side-by-side instead of stacking. */
export function layoutEventsInDay(events) {
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

/* HA event → one { day, start, end } per day of the visible week it covers.
   `start`/`end` are floats (hours, e.g. 14.5 = 2:30pm).
   `day` is 0-6 where 0 = Monday. Returns [] if the span misses the week.

   HA returns a single object per event even when it runs over several days
   (all-day events carry an *exclusive* end.date), so a Mon–Wed trip has to be
   exploded into one entry per covered day. The span is clipped to the visible
   week, which also keeps events that started before Monday on the board. */
export function haEventToGridPositions(ev, weekStartLocal) {
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

/* HA's calendar payload → grid-positioned events the renderer expects.
   A multi-day event yields one entry per day, all sharing an `evId` so the
   header count still reads as events rather than day-slices. */
export function toGridEvents(haEvents, weekStart) {
  const out = [];
  for (const ev of haEvents) {
    const evId =
      ev.uid || `${ev.cal_entity_id}-${ev.summary}-${ev.start?.dateTime || ev.start?.date}`;
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
}

/* Fractional hour (14.5) → "14:30". */
export function hhmm(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function hourLabel(h) {
  return `${String(Math.floor(h)).padStart(2, "0")}:00`;
}

export function eventTimeLabel(start, end, allDay) {
  if (allDay) return "All day";
  return `${hhmm(start)}–${hhmm(end)}`;
}
