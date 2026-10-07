// Fractional hour (13.5 -> "13:30") for the topbar and the weather meta line.
// Rounds on total minutes, not on the fraction alone: rounding the fraction
// produced a 60th minute, so the clock read "13:60" for the last ~30 seconds of
// every hour and "23:60" at midnight. Wraps at 24h — both callers pass a
// time of day, never a duration.
export const fmtTime = (h) => {
  if (!Number.isFinite(h)) return "—";
  const total = Math.round(h * 60);
  const hh = ((Math.floor(total / 60) % 24) + 24) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

export function formatRelativeIso(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / (24 * 3600 * 1000));
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  let day;
  if (diffDays === 0) day = "today";
  else if (diffDays === -1) day = "yesterday";
  else if (diffDays === 1) day = "tomorrow";
  else if (diffDays < 0) day = `${-diffDays} days ago`;
  else day = `in ${diffDays} days`;
  return `${day} · ${time}`;
}

/* A sensor state as a number, or `fallback` when it isn't one. HA states are
   strings, and "unavailable", "unknown" and "" all have to land on the
   fallback. Number() alone gets two cases wrong: Number("") and Number(null)
   are both 0, which is how a sensor with nothing to say renders as a confident
   zero. Pass `null` as the fallback and render an em-dash for it. */
export function numOr(v, fallback) {
  if (v == null || typeof v === "boolean") return fallback;
  if (typeof v === "string" && v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* A duration sensor's state in minutes, read in the entity's own
   unit_of_measurement. The unit is not a property of the integration: HA
   stores a suggested unit once, at first registration, and the user can
   override it — so Roborock's cleaning_time reads seconds on an install that
   predates HA 2025.11 and minutes on a newer one, and ha-bambulab's
   remaining_time reads minutes or hours depending on when the printer was
   added. Assuming either is a 60x error shown as fact. An unread state, a
   negative one, or a unit not listed here is null — the caller's em-dash.
   The units are every one HA's DurationConverter converts (UnitOfTime):
   μs (U+03BC, which HA writes) and µs (U+00B5, the micro sign a template
   sensor may use), ms, s, min, h, d and w. Not "m" or "y" (months, years):
   HA doesn't convert those, a month is no fixed number of minutes, and "m"
   is metres as often as not. */
export function durationToMinutes(state, unit) {
  const n = numOr(state, null);
  if (n == null || n < 0) return null;
  switch (unit) {
    case "μs":
    case "µs": return n / 6e7;
    case "ms": return n / 60000;
    case "s": return n / 60;
    case "min": return n;
    case "h": return n * 60;
    case "d": return n * 1440;
    case "w": return n * 10080;
    default: return null;
  }
}

/* WHO / EPA-ish PM2.5 bands (µg/m³), so a readout can't call 90 "excellent".
   null in, null out: the caller decides how to say "unknown". */
export function pmBand(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return v <= 12 ? "excellent" : v <= 35 ? "good" : v <= 55 ? "moderate" : "poor";
}

// null and "" are "no reading", not zero bytes (roadmap I16).
export function formatMiB(mib) {
  const n = numOr(mib, null);
  if (n == null) return "—";
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GiB`;
  return `${n.toFixed(0)} MiB`;
}
