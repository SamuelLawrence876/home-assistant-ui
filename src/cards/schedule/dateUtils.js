/* "2026-05-22T14:30:00+01:00" style — HA accepts ISO with offset and
   stores the absolute instant correctly. Avoid bare local strings since
   HA's interpretation depends on the calendar's TZ. */
export function toLocalISOWithOffset(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const absOff = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`;
}

export function ymd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* The screenshot gates pin ?today=YYYY-MM-DD so the week grid's day numbers
   and highlighted column stop depending on which day CI ran — the same
   determinism ?clock= gives the sky (scripts/harness.mjs#tabURL). Without it
   the schedule baseline rotted a little every real day and failed the pixel
   gate on unrelated deploys. Live use never sets the param, so dateNow() is
   plain new Date() outside the gates. An unparseable value is rejected,
   never patched into a NaN date. */
export function parseTodayPin(search) {
  const v = new URLSearchParams(search).get("today");
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Midday local: immune to DST edges, and a later setHours(0,0,0,0)
  // still lands on the pinned day.
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TODAY_PIN = (() => {
  try {
    return parseTodayPin(window.location.search);
  } catch {
    return null; // no window — imported outside a browser/jsdom
  }
})();

export function dateNow() {
  return TODAY_PIN ? new Date(TODAY_PIN) : new Date();
}
