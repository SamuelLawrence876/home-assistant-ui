import { useMemo } from "react";
import { useEntitiesByDomain } from "../../ha/useEntity.js";
import { useCalendarEvents } from "../../ha/useCalendarEvents.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Next event — compact card for Overview
   ----------------------------------------------------------------*/
export function NextEventCard({ index = 0 }) {
  const calendarEntities = useEntitiesByDomain("calendar");
  const calendarIds = useMemo(
    () => calendarEntities.map((e) => e.entity_id).sort(),
    [calendarEntities.length, calendarEntities.map((e) => e.entity_id).join(",")],
  );

  const now = new Date();
  const startISO = now.toISOString();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  const endISO = end.toISOString();

  const { events, loading } = useCalendarEvents(calendarIds, startISO, endISO);

  const upcoming = useMemo(() => {
    if (!events.length) return [];
    return events
      .map((ev) => {
        const startRaw = ev.start?.dateTime || ev.start?.date;
        const allDay = !ev.start?.dateTime;
        const start = startRaw ? new Date(startRaw) : null;
        if (!start || start < now) return null;
        const calName = calendarEntities.find((e) => e.entity_id === ev.cal_entity_id)?.attributes?.friendly_name || "";
        return { summary: ev.summary, start, allDay, calName };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start)
      .slice(0, 3);
  }, [events]);

  function fmtDate(d, allDay) {
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const dayLabel = isToday ? "Today" : isTomorrow ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    if (allDay) return dayLabel;
    return `${dayLabel} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  return (
    <Card index={index} eyebrow="Calendar · Upcoming" meta={loading ? "Loading" : upcoming.length > 0 ? `${upcoming.length} events` : null}>
      {upcoming.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {upcoming.map((ev, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 4, height: 32, borderRadius: 2, flexShrink: 0,
                background: i === 0 ? "var(--accent)" : "color-mix(in oklch, var(--ink), transparent 80%)",
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.summary}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 1 }}>
                  {fmtDate(ev.start, ev.allDay)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
          {loading ? "Loading events..." : "Nothing scheduled this week"}
        </div>
      )}
    </Card>
  );
}
