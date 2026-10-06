/* Pure helpers for the Kanban board — tag encoding, due-date handling and item
   references for HA's `todo.*` service payloads, plus the board's honest read
   states. No React in here. */

/* A tag is letters, combining marks, digits, `_` and `-`, starting with a
   letter, digit or `_`. Unicode-aware on purpose: the ASCII-only `\w` this used
   to be cut "#café" to a "caf" chip and left the "é" in the hidden prose. Marks
   (\p{M}) matter as much as letters: Devanagari vowel signs and anything typed
   decomposed (NFD) are marks, and without them "#हिंदी" read back as "हद" and an
   NFD "#café" as "cafe". NFC first, so the same tag typed on two devices is the
   same chip. normaliseTag() writes only what this reads back, so a tag
   round-trips through Home Assistant. */
export function parseTags(description) {
  if (!description) return { tags: [], text: "" };
  const tags = [];
  const text = String(description)
    .normalize("NFC")
    .replace(/#([\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*)/gu, (_, t) => { tags.push(t); return ""; })
    .trim();
  return { tags, text };
}

/* Spacing, case and a leading # — the changes to a typed tag nobody needs
   telling about. */
const formatTag = (raw) => String(raw ?? "")
  .trim()
  .replace(/^#+/, "")
  .toLowerCase()
  .normalize("NFC") // after lowercasing, which can itself decompose ("İ" → "i̇")
  .replace(/\s+/g, "-");
/* A tag can't start with a mark or a hyphen (parseTags wouldn't see it) or end
   with a hyphen, and runs of hyphens collapse. */
const tidyTag = (s) => s.replace(/-{2,}/g, "-").replace(/^[-\p{M}]+|-+$/gu, "");

/* What a typed custom tag is stored as, or "" if nothing usable is left.
   Trim before anything else: whitespace became "-" first, so "urgent " was
   stored as "#urgent-" and " urgent" as "#-urgent", which parseTags can't read
   at all. Characters parseTags would stop at ("q&a", "C++", emoji) are dropped
   here rather than written to Home Assistant and silently cut off on the way
   back — and tagDropsCharacters() lets the form say so. */
export function normaliseTag(raw) {
  return tidyTag(formatTag(raw).replace(/[^\p{L}\p{M}\p{N}_-]/gu, ""));
}

/* True when normaliseTag() threw away characters that were typed, rather than
   just tidying spacing, case or a leading #: "C++" is stored as "c", which is
   a different tag, and the person who typed it should be told. */
export function tagDropsCharacters(raw) {
  return normaliseTag(raw) !== tidyTag(formatTag(raw));
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

/* A list Home Assistant won't act on: its entity is unavailable/unknown, or
   gone. `status` is useEntityStatus()'s. HA skips such an entity and still
   reports success, so nothing may be added to, moved into or out of it. */
export const isDeadList = (status) => status === "unavailable" || status === "not_found";

/* The board's honest states, after weekState() in WeeklyCalendarCard.jsx.

   `reads` is { [columnId]: "unread" | "ok" | "error" | "partial" } — whether
   the last attempt to read that column worked. "partial" is Done only: some
   list's completed items have never been read, so the cards on screen are a
   subset and their number is not the column's count. `counts` is how many
   cards each column has on screen. `lists` is { [listId]: useEntityStatus
   status } for the columns that are a Home Assistant list. "We could not read
   this column" and "this column is empty" are different facts, so an unread or
   failed column shows "—" and says why instead of a 0 nobody measured. Cards
   already on screen stay visible when a refresh fails, a list goes unavailable
   or the socket drops — that doesn't make them untrue — and the caveat is said
   instead.

   Returns { meta, total, columns: { [id]: { count, note, tone } } }. `total`
   is null unless every column read cleanly; a sum with a hole in it is a
   plausible-looking wrong number. */
export function boardState({ connStatus, reads, counts, lists = {} }) {
  const connecting = connStatus === "connecting" || connStatus === "authenticating";
  const offline = connStatus !== "ready";
  const ids = Object.keys(reads);
  /* A list's entity state only means something over a live socket; offline,
     the connection is the explanation and the list status is just "loading". */
  const dead = (id) => !offline && isDeadList(lists[id]);
  const anyDeadList = Object.keys(lists).some(dead);
  const everRead = ids.some((id) => reads[id] !== "unread");
  const anyUnread = ids.some((id) => reads[id] === "unread");
  const unreadable = (id) => reads[id] === "error" || reads[id] === "partial" || dead(id);
  const anyUnreadable = anyDeadList || ids.some(unreadable);

  const columns = {};
  for (const id of ids) {
    const n = counts[id] || 0;
    if (dead(id)) {
      const what = lists[id] === "not_found" ? "List not found" : "List unavailable";
      columns[id] = n > 0
        ? { count: n, note: `${what} · may be out of date`, tone: "stale" }
        : { count: "—", note: what, tone: "error" };
    } else if (reads[id] === "ok") {
      /* Done holds every list's completed items, so a dead list leaves a hole
         in it even though the last read worked. */
      columns[id] = anyDeadList && !(id in lists)
        ? { count: n, note: "A list is unavailable · may be out of date", tone: "stale" }
        : { count: n, note: null, tone: null };
    } else if (reads[id] === "partial") {
      columns[id] = { count: "—", note: n > 0 ? "Couldn't read all of this column" : "Couldn't read this column", tone: "error" };
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
  else if (ids.every(unreadable)) {
    meta = ids.some((id) => counts[id] > 0) ? "board couldn't be refreshed · may be out of date" : "board couldn't be read";
  }
  else if (anyUnreadable) meta = "some columns couldn't be read";
  else meta = "drag cards between columns";

  const total = anyUnread || anyUnreadable ? null : ids.reduce((n, id) => n + (counts[id] || 0), 0);
  return { meta, total, columns };
}
