import { useState, useEffect, useId, useMemo, useRef } from "react";
import { callService } from "../../ha/client.js";
import { toLocalISOWithOffset, ymd } from "../../cards/schedule/dateUtils.js";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/* Mounted on demand by the parent — initial values are read once on mount,
   so opening the dialog from a clicked time slot pre-fills date + time.
   `calendars` is [{ entity_id, label, dead?, creatable? }]: `dead` when the
   entity is unavailable/unknown, `creatable` true/false/null from its
   supported_features. `dead`, or `creatable === false`, rules a calendar out;
   null (the attribute wasn't there) is left for HA to judge. `loadingIds`:
   calendars HA may still be loading after a reconnect (useEntity.js) — not in
   `calendars`, but not known to be gone either. */
export function NewEventDialog({ onClose, calendars, loadingIds = [], defaultCalendarId, initial, onCreated }) {
  const today = useMemo(() => new Date(), []);
  /* Next whole hour, capped at 23:00, with the end always after the start.
     Clamping both ends to 23:00 (as a naive min did) pre-filled an
     unsubmittable form for anyone opening this after 22:00 — the common case
     on an evening wall dashboard. */
  const [defaultStart, defaultEnd] = useMemo(() => {
    const fmt = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
    const s = Math.min(today.getHours() + 1, 23);
    return [fmt(s), fmt(Math.min(s + 1, 23.5))];
  }, [today]);
  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState(defaultCalendarId || "");
  const [date, setDate] = useState(() => initial?.date || ymd(today));
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(() => initial?.startTime || defaultStart);
  const [endTime, setEndTime] = useState(() => initial?.endTime || defaultEnd);
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const headingId = useId();
  const formRef = useRef(null);

  useEffect(() => {
    if (!calendarId && defaultCalendarId) setCalendarId(defaultCalendarId);
  }, [defaultCalendarId, calendarId]);

  /* The chosen calendar can leave `calendars` while the dialog is open — HA
     removed it, or it hasn't loaded yet after an HA restart. A controlled
     select whose value has no option shows the first enabled one instead, so
     the dialog showed Personal while submit refused the gone iCloud, and
     picking the Personal it showed fired no change. So the chosen one stays,
     as a disabled option: the select shows what submit would send, any live
     calendar is a real change, and the choice is still there if the calendar
     comes back. "(loading…)" while HA may still be loading it, "(not found)"
     once it isn't. Labels are remembered so it keeps its name. */
  const labels = useRef({});
  useEffect(() => { for (const c of calendars) labels.current[c.entity_id] = c.label; }, [calendars]);
  const missing = Boolean(calendarId) && !calendars.some((c) => c.entity_id === calendarId);
  const nameOf = (id) => labels.current[id] || id.replace(/^calendar\./, "");

  /* Hand focus back to whatever opened the dialog when it unmounts, so the
     "+ Add event" button (or the clicked column) keeps the keyboard. */
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  /* Escape closes; Tab is trapped inside the form. Without the trap, tabbing
     past "Create event" walks into the calendar and topbar still sitting live
     behind the scrim. */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !formRef.current) return;
      const stops = [...formRef.current.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const inside = formRef.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = title.trim() && calendarId && !submitting;

  /* Why a create into this calendar can't work, or null if it can. HA drops
     a service call aimed at an unavailable entity and still answers success,
     so without this the dialog closed as if the event existed. The chosen
     calendar can die while the dialog is open, so this is asked at submit
     time — Create stays enabled (and focused) and says why instead. */
  function refusal(id) {
    const c = calendars.find((x) => x.entity_id === id);
    if (!c && loadingIds.includes(id)) return `${nameOf(id)} hasn't loaded yet. Try again in a moment, or pick another calendar.`;
    if (!c) return "That calendar is no longer in Home Assistant. Pick another one.";
    if (c.dead) return `${c.label} is unavailable in Home Assistant right now, so nothing can be added to it. Pick another calendar or try again later.`;
    if (c.creatable === false) return `${c.label} doesn't take new events. Pick another calendar.`;
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const refused = refusal(calendarId);
    if (refused) {
      setError(refused);
      return;
    }
    setSubmitting(true);
    setError(null);
    /* A cleared date or time field parses to an Invalid Date, and every
       comparison against NaN is false — so the end-after-start check waved it
       through and "NaN-NaN-NaN" went to HA. Refuse it here, in words. */
    const unreadable = () => {
      setError("Couldn't read that date or time. Check them and try again.");
      setSubmitting(false);
    };
    try {
      const data = { summary: title.trim() };
      if (location.trim()) data.location = location.trim();
      if (allDay) {
        const d = new Date(`${date}T00:00:00`);
        if (Number.isNaN(d.getTime())) return unreadable();
        data.start_date = date;
        d.setDate(d.getDate() + 1);
        data.end_date = ymd(d);
      } else {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const sd = new Date(`${date}T00:00:00`);
        sd.setHours(sh, sm, 0, 0);
        const ed = new Date(`${date}T00:00:00`);
        ed.setHours(eh, em, 0, 0);
        const startISO = toLocalISOWithOffset(sd);
        const endISO = toLocalISOWithOffset(ed);
        if (!startISO || !endISO) return unreadable();
        if (ed <= sd) {
          setError("End time must be after start time.");
          setSubmitting(false);
          return;
        }
        data.start_date_time = startISO;
        data.end_date_time = endISO;
      }
      await callService("calendar", "create_event", data, { entity_id: calendarId });
      setTitle("");
      setLocation("");
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <form
        ref={formRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id={headingId}>New event</h3>

        <div className="modal-row">
          <span className="lbl">Title</span>
          <input
            autoFocus
            type="text"
            aria-label="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Coffee with Alex"
            required
          />
        </div>

        <div className="modal-row">
          <span className="lbl">Calendar</span>
          <select aria-label="Calendar" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} required>
            {/* Only reachable when every calendar is dead or read-only: say
                so, rather than let the select show one it can't use — unless
                HA may still be loading one, which the default then picks up. */}
            {!calendarId && (
              <option value="" disabled>
                {loadingIds.length ? "Still loading calendars…" : "No calendar can take new events"}
              </option>
            )}
            {missing && (
              <option value={calendarId} disabled>
                {`${nameOf(calendarId)} (${loadingIds.includes(calendarId) ? "loading…" : "not found"})`}
              </option>
            )}
            {calendars.map((c) => (
              <option key={c.entity_id} value={c.entity_id} disabled={Boolean(c.dead) || c.creatable === false}>
                {`${c.label}${c.dead ? " (unavailable)" : c.creatable === false ? " (read-only)" : ""}`}
              </option>
            ))}
          </select>
        </div>

        <label className="modal-toggle-row">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All-day
        </label>

        <div className="modal-row">
          <span className="lbl">Date</span>
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        {!allDay && (
          <div className="modal-row two">
            <div>
              <span className="lbl">Start</span>
              <input type="time" aria-label="Start time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div>
              <span className="lbl">End</span>
              <input type="time" aria-label="End time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>
        )}

        <div className="modal-row">
          <span className="lbl">Location (optional)</span>
          <input type="text" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitting ? "Saving…" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}
