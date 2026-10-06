/* Pure helpers for the Kanban board — tag encoding, due-date handling and item
   references for HA's `todo.*` service payloads, plus the board's honest read
   states. No React in here. */

/* A tag is letters, digits, `_` and `-`, starting with a letter, digit or `_`.
   Unicode-aware on purpose: the ASCII-only `\w` this used to be cut "#café" to
   a "caf" chip and left the "é" in the hidden prose. normaliseTag() writes
   only what this reads back, so a tag round-trips through Home Assistant. */
export function parseTags(description) {
  if (!description) return { tags: [], text: "" };
  const tags = [];
  const text = description.replace(/#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu, (_, t) => { tags.push(t); return ""; }).trim();
  return { tags, text };
}

/* What a typed custom tag is stored as, or "" if nothing usable is left.
   Trim before anything else: whitespace became "-" first, so "urgent " was
   stored as "#urgent-" and " urgent" as "#-urgent", which parseTags can't read
   at all. Characters parseTags would stop at ("q&a") are dropped here rather
   than written to Home Assistant and silently cut off on the way back. */
export function normaliseTag(raw) {
  return String(raw ?? "")
    .normalize("NFC")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
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

/* A card added from this board shows straight away under a made-up uid, until
   the next read hands back Home Assistant's real one. */
export const TEMP_UID_PREFIX = "temp-";
export const isTempCard = (card) => String(card?.uid ?? "").startsWith(TEMP_UID_PREFIX);

/* The board's own identity for a card: drag payloads, React keys, pending
   deletes. Not what gets sent to Home Assistant — that is itemRef(). */
export const cardKey = (card) => card?.uid || card?.summary;

export function omit(obj, key) {
  const { [key]: _gone, ...rest } = obj;
  return rest;
}

/* What goes in the `item` field of `todo.update_item` / `todo.remove_item`.
   HA accepts a uid OR a summary there and acts on the FIRST item in list order
   that matches either, and local_todo appends — so with an old completed
   "Water plants" ahead of an active one, sending the summary deleted or
   completed the history item instead of the card that was pressed. The uid is
   unique; the summary is only a fallback for a card that has no real uid yet. */
export function itemRef(card) {
  return card?.uid && !isTempCard(card) ? card.uid : card?.summary;
}

/* The board's honest states, after weekState() in WeeklyCalendarCard.jsx.

   `reads` is { [columnId]: "unread" | "ok" | "error" } — whether the last
   attempt to read that column worked. `counts` is how many cards each column
   has on screen. "We could not read this column" and "this column is empty"
   are different facts, so an unread or failed column shows "—" and says why
   instead of a 0 nobody measured. Cards already on screen stay visible when a
   refresh fails or the socket drops — that doesn't make them untrue — and the
   caveat is said instead.

   Returns { meta, total, columns: { [id]: { count, note, tone } } }. `total`
   is null unless every column read cleanly; a sum with a hole in it is a
   plausible-looking wrong number. */
export function boardState({ connStatus, reads, counts }) {
  const connecting = connStatus === "connecting" || connStatus === "authenticating";
  const offline = connStatus !== "ready";
  const ids = Object.keys(reads);
  const everRead = ids.some((id) => reads[id] !== "unread");
  const anyUnread = ids.some((id) => reads[id] === "unread");
  const anyError = ids.some((id) => reads[id] === "error");

  const columns = {};
  for (const id of ids) {
    const n = counts[id] || 0;
    if (reads[id] === "ok") {
      columns[id] = { count: n, note: null, tone: null };
    } else if (reads[id] === "error") {
      columns[id] = n > 0
        ? { count: n, note: "Couldn't refresh · may be out of date", tone: "stale" }
        : { count: "—", note: "Couldn't read this column", tone: "error" };
    } else {
      const note = connecting ? "Connecting…" : offline ? "Not connected" : "Loading…";
      columns[id] = { count: "—", note, tone: "wait" };
    }
  }

  let meta;
  if (offline && everRead) meta = "not connected · may be out of date";
  else if (connecting) meta = "connecting…";
  else if (offline) meta = "not connected";
  else if (anyUnread) meta = "loading…";
  else if (anyError) meta = "some columns couldn't be read";
  else meta = "drag cards between columns";

  const total = anyUnread || anyError ? null : ids.reduce((n, id) => n + (counts[id] || 0), 0);
  return { meta, total, columns };
}
