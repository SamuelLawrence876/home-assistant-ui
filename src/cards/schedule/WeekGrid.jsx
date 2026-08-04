import { useState, useLayoutEffect, useRef } from "react";
import { ymd } from "./dateUtils.js";
import {
  DOWS,
  CAL_PALETTE,
  SLOT_PX_FALLBACK,
  layoutEventsInDay,
  eventTimeLabel,
  hourLabel,
  hhmm,
} from "./weekcalLayout.js";

/* The Mon–Sun grid itself: day headers, the off-grid pill row, the hour
   gutter, the seven columns, the now-line and the positioned events.

   It owns the `--col-h` measurement because that number is only meaningful
   against this DOM, and the slot-click maths that depends on it. Everything
   about *which* events exist stays with WeeklyCalendarCard.jsx. */

/* Shown in place of events when there is nothing truthful to draw: an empty
   week and a week we could not read are different sentences, and the caller
   picks which. Rendered over the grid rather than instead of it so the week
   keeps its shape either way. Inline styles because src/styles/ is not ours
   to extend here. */
function WeekcalNotice({ title, detail }) {
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <div
        style={{
          maxWidth: "min(340px, 80%)",
          textAlign: "center",
          padding: "14px 18px",
          borderRadius: "12px",
          border: "1px solid var(--rule)",
          /* The more opaque of the two glass tokens: the gridlines run
             straight under this and the thinner one leaves them legible
             through the text. */
          background: "var(--glass-bg-2)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--ink)" }}>{title}</div>
        {detail && (
          <div style={{ marginTop: "4px", fontSize: "11px", lineHeight: 1.5, color: "var(--ink-3)" }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function WeekGrid({
  weekStart,
  todayDow,
  events,
  calendars,
  startHour,
  endHour,
  slotsPerHour,
  now,
  clickable,
  onSlotClick,
  notice,
}) {
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

  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const nowOffset = (now - startHour) * slotsPerHour * slotPx;
  const showNow = now >= startHour && now <= endHour;

  /* Click anywhere in a day column → snap to nearest 30-min slot and hand the
     caller a pre-fill for the new-event dialog. */
  function onColClick(ev, day) {
    if (!clickable) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const hourFloat = startHour + y / (slotsPerHour * slotPx);
    const snapped = Math.floor(hourFloat * slotsPerHour) / slotsPerHour; // round down to 30 min
    const start = Math.max(startHour, Math.min(snapped, endHour));
    const end = Math.min(start + 1, 23.5);
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + day);
    onSlotClick?.({ date: ymd(dayDate), startTime: hhmm(start), endTime: hhmm(end) });
  }

  return (
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
            className={`weekcal-col ${day === todayDow ? "today" : ""} ${clickable ? "clickable" : ""}`}
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
            {laidOut.map((e) => (
              <WeekGridEvent key={e.id} e={e} calendars={calendars} startHour={startHour} endHour={endHour} slotsPerHour={slotsPerHour} slotPx={slotPx} />
            ))}
          </div>
        );
      })}

      {notice && <WeekcalNotice title={notice.title} detail={notice.detail} />}
    </div>
  );
}

function WeekGridEvent({ e, calendars, startHour, endHour, slotsPerHour, slotPx }) {
  const calVar = calendars[e.cal]?.color || CAL_PALETTE[0];
  const tooltip = `${e.title}\n${eventTimeLabel(e.start, e.end, e.allDay)}${e.where ? `\n${e.where}` : ""}`;
  const visibleStart = Math.max(e.start, startHour);
  const visibleEnd = Math.min(e.end, endHour + 1);
  const top = (visibleStart - startHour) * slotsPerHour * slotPx;
  const h = (visibleEnd - visibleStart) * slotsPerHour * slotPx;
  const short = h < 36;
  /* Lane-based horizontal split. Inline left + width override the CSS
     defaults of left:4px right:4px so overlapping events sit next to each
     other with a small gutter. */
  const widthPct = 100 / e._totalLanes;
  const leftPct = e._lane * widthPct;
  const positioning =
    e._totalLanes > 1
      ? {
          left: `calc(${leftPct}% + 2px)`,
          width: `calc(${widthPct}% - 4px)`,
          right: "auto",
        }
      : null;
  return (
    <div
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
}
