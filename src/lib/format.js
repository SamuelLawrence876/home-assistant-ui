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

export function formatMiB(mib) {
  const n = Number(mib);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GiB`;
  return `${n.toFixed(0)} MiB`;
}
