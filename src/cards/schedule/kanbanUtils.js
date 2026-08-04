/* Pure helpers for the Kanban board — tag encoding and due-date handling for
   HA's `todo.*` service payloads. No React in here. */

export function parseTags(description) {
  if (!description) return { tags: [], text: "" };
  const tags = [];
  const text = description.replace(/#(\w[\w-]*)/g, (_, t) => { tags.push(t); return ""; }).trim();
  return { tags, text };
}

export function buildDescription(tags, text) {
  const parts = [];
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(" "));
  if (text) parts.push(text);
  return parts.join(" ") || undefined;
}

/* HA to-do items carry either a bare date ("2026-06-10") or a full datetime
   ("2026-06-10T14:30:00+01:00"). Only the bare form needs the midnight suffix
   to parse as local time — appending it to a datetime yields Invalid Date. */
export function fmtDue(dateStr) {
  if (!dateStr) return null;
  const hasTime = dateStr.length > 10;
  const d = new Date(hasTime ? dateStr : dateStr + "T00:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  if (hasTime && d < now) return "overdue";
  const dueMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dueMidnight - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
}

/* `todo.add_item` has two mutually exclusive due fields: `due_date` is validated
   as a bare date and `due_datetime` as a timestamp. Passing an item's raw due
   value into the wrong one throws, so route it by the same shape test fmtDue
   uses — otherwise moving a card that carries a due *time* fails outright. */
export function dueFields(due) {
  if (!due) return {};
  return due.length > 10 ? { due_datetime: due } : { due_date: due };
}
