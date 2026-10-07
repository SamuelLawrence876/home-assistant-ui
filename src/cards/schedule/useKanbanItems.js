import { useState, useEffect, useRef } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";
import { getTodoItems } from "../../ha/client.js";
import { DONE, listsMoved, listsBack, withTimeout } from "./kanbanUtils.js";

/* The Kanban board's reads of its lists, and how they stay out of the way of
   its own writes. Private to KanbanBoardCard.jsx; its own file only because
   the card is at its size limit. */

/* After a read that failed for a list Home Assistant says is there, read again
   — twice, then leave it to the column's Retry button and the heartbeat. The
   same delays as useCalendarEvents: one transient failure shouldn't strand a
   column on "Couldn't read" until something unrelated re-reads it, and a list
   that keeps failing mustn't become a loop at the Pi. A reconnect, Retry, or a
   read that comes back clean starts the budget over. */
const RETRY_DELAYS_MS = [8000, 20000];

/* Home Assistant doesn't push a list's items to the board, so a task added,
   completed or deleted on another device used to stay out of sight for as long
   as the tab was open. The board reads again ~1 s after a list's entity moves
   (listStamp) — debounced, and held off while the board's own write is in
   flight (`writes`, below), so its own writes, which re-read 500 ms after they
   land, don't read twice — and HEARTBEAT_MS after its last read regardless,
   for the changes that don't move the entity (a rename, a completed item
   deleted). Every read is the same six get_items calls; nothing reads while
   the socket is down. */
const CHANGE_DEBOUNCE_MS = 1000;
const HEARTBEAT_MS = 5 * 60_000;

/* Upper bounds, so nothing that never answers can stop the board reading. A
   todo call HA accepted but never answered, over a socket that stayed up, held
   the write fence — or the read in flight — for good: no change read, no
   heartbeat, and a Retry that did nothing. A write older than WRITE_FENCE_MS
   no longer holds automatic reads back, and a get_items with no answer in
   READ_TIMEOUT_MS counts as a failed read, so the read settles and the retries
   and heartbeat carry on. Both are far past any round trip that still works. */
const WRITE_FENCE_MS = 30_000;
const READ_TIMEOUT_MS = 30_000;

export function useKanbanItems(entityIds, { deadKey, changeKey, readyKey }) {
  const connStatus = useConnectionStatus();
  const [columns, setColumns] = useState(() => Object.fromEntries([...entityIds, DONE].map((id) => [id, []])));
  /* Per column: "unread" | "ok" | "error" | "partial". Done is "ok" only if
     every list's completed items came back. See boardState() for what each
     one says. */
  const [reads, setReads] = useState(() => Object.fromEntries([...entityIds, DONE].map((id) => [id, "unread"])));
  const [fetchTick, setFetchTick] = useState(0);
  /* A read is in flight — what Retry shows while it waits. The ref is why a
     second press doesn't start a second read: the state only turns true after
     the re-render the first press causes, so a double-click or Enter twice
     both saw false and each started a full read. */
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  const setInFlight = (v) => { readingRef.current = v; setReading(v); };
  const attemptRef = useRef(0);
  /* The next read already decided on: a retry, or the heartbeat. */
  const nextRead = useRef(null);
  const changeTimer = useRef(null);
  const seenKey = useRef(changeKey);
  const seenReady = useRef(readyKey);
  /* Lists whose completed items have been read at least once. A failed list
     keeps its old cards in Done, but one never read has none there — and then
     Done's count is a subset passed off as the whole column. */
  const doneRead = useRef(new Set());
  /* The same for a list's own column: one never read holds only what this
     board put there (an add, a move), so its count is "partial" too — "1"
     for a list of 6 otherwise. */
  const listRead = useRef(new Set());
  /* Lists that failed (either status) in the last read that landed. */
  const failedLists = useRef(new Set());
  /* The board's own writes in flight — moves, adds, deletes — each with when it
     started. A cross-list move is five round trips, and its add_item moves the
     target list's entity part way through — so on a slow link the change read
     that arms (or a heartbeat falling due) landed between the add and the
     remove, drew the task in both columns, and was followed by the move's own
     re-read anyway. An automatic read that falls due while one is in flight
     (and under WRITE_FENCE_MS old) waits instead, re-armed a CHANGE_DEBOUNCE_MS
     at a time; the writes end in a re-read (beginWrite) — one, by the last of
     them to end — which covers what they moved and cancels the waiting timer.
     Retry, a reconnect and a list coming back still read straight away. Any
     read, though, is dropped when it lands if a write is in flight then, or
     began after the read was sent (`writeSeq`): what it brings back may
     predate the write, and drawn, it put a moved card back where it was, or in
     both columns. A dropped read leaves a read owed (`readOwed`). */
  const writes = useRef(new Map());
  const writeSeq = useRef(0);
  const readOwed = useRef(false);
  const fenced = () => {
    const now = Date.now();
    for (const at of writes.current.values()) if (now - at < WRITE_FENCE_MS) return true;
    return false;
  };
  const autoRead = (timer) => () => {
    if (fenced()) timer.current = setTimeout(autoRead(timer), CHANGE_DEBOUNCE_MS);
    else setFetchTick((t) => t + 1);
  };

  /* A list moved in Home Assistant: read again once it has been still for
     CHANGE_DEBOUNCE_MS. So does a list turning "ready" whose last read failed:
     on a reconnect the board reads before HA's first batch, so a list HA was
     still loading fails that read, then arrives with nothing that counts as a
     change (first sight of it, not a dead list coming back) — and its column
     sat on "Couldn't refresh" once the two retries were spent. Declared before
     the read effect on purpose: a read that starts in the same commit cancels
     this timer, since it will see the change anyway — that is what keeps a
     list coming back (deadKey) or the board's own write (refresh) to one read. */
  useEffect(() => {
    const back = listsBack(seenReady.current, readyKey, failedLists.current).length > 0;
    seenReady.current = readyKey;
    const moved = connStatus === "ready" && (back || listsMoved(seenKey.current, changeKey));
    seenKey.current = changeKey;
    if (!moved) return;
    clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(autoRead(changeTimer), CHANGE_DEBOUNCE_MS);
  }, [changeKey, connStatus, readyKey]);

  useEffect(() => {
    clearTimeout(changeTimer.current); // this read covers it; offline, nothing reads
    if (connStatus !== "ready") {
      attemptRef.current = 0; // the reconnect gets a fresh retry budget
      setInFlight(false);
      return;
    }
    let cancelled = false;
    const seq = writeSeq.current;
    readOwed.current = false; // this read covers it, unless a write overtakes it
    setInFlight(true);
    (async () => {
      const read = (id, status) => withTimeout(getTodoItems(id, status), READ_TIMEOUT_MS);
      const results = await Promise.all(entityIds.map(async (id) => {
        const [active, completed] = await Promise.allSettled([read(id, "needs_action"), read(id, "completed")]);
        return { id, active, completed };
      }));
      if (cancelled) return;
      /* Overtaken by a write (see `writes`): owed, and done by the write's end
         — or, should that never come, by this timer once the fence's age
         bound lets it through. */
      if (seq !== writeSeq.current || fenced()) {
        readOwed.current = true;
        setInFlight(false);
        nextRead.current = setTimeout(autoRead(nextRead), CHANGE_DEBOUNCE_MS);
        return;
      }
      const own = (id) => (it) => ({ ...it, _entity: id });
      /* A failed read keeps what that column already showed instead of
         emptying it: an empty column is a claim, and we didn't check. */
      setColumns((cur) => {
        const next = { ...cur };
        const done = [];
        for (const { id, active, completed } of results) {
          if (active.status === "fulfilled") next[id] = active.value.map(own(id));
          if (completed.status === "fulfilled") done.push(...completed.value.map(own(id)));
          else done.push(...(cur[DONE] || []).filter((c) => c._entity === id));
        }
        next[DONE] = done;
        return next;
      });
      const hole = results.some((x) => x.completed.status !== "fulfilled" && !doneRead.current.has(x.id));
      for (const { id, completed } of results) if (completed.status === "fulfilled") doneRead.current.add(id);
      const r = { [DONE]: results.every((x) => x.completed.status === "fulfilled") ? "ok" : hole ? "partial" : "error" };
      for (const { id, active } of results) {
        if (active.status === "fulfilled") listRead.current.add(id);
        r[id] = active.status === "fulfilled" ? "ok" : listRead.current.has(id) ? "error" : "partial";
      }
      setReads(r);
      setInFlight(false);
      const failedIds = results
        .filter((x) => x.active.status !== "fulfilled" || x.completed.status !== "fulfilled")
        .map((x) => x.id);
      failedLists.current = new Set(failedIds);
      /* A dead list can't be read and asking again won't change that; its
         column recovers when the list comes back (deadKey, below). */
      const dead = deadKey.split(",");
      const failed = failedIds.some((id) => !dead.includes(id));
      if (!failed) attemptRef.current = 0;
      const delay = failed ? RETRY_DELAYS_MS[attemptRef.current] : undefined;
      if (delay != null) attemptRef.current += 1;
      nextRead.current = setTimeout(autoRead(nextRead), delay ?? HEARTBEAT_MS);
    })();
    /* Whatever re-runs this — a write's refresh, a reconnect, unmount — makes
       a pending retry or heartbeat moot: the new run decides again. */
    return () => { cancelled = true; clearTimeout(nextRead.current); clearTimeout(changeTimer.current); };
    /* deadKey (which lists are unavailable, as a string) is a reason to read
       again: a list coming back is the only way its column recovers by itself. */
  }, [connStatus, fetchTick, deadKey]);

  const refresh = () => setFetchTick((t) => t + 1);
  /* The person asked: the automatic retries are earned back too. */
  const retry = () => {
    if (readingRef.current) return;
    readingRef.current = true;
    attemptRef.current = 0;
    refresh();
  };
  /* Call as a write starts. Call what it returns exactly once, when the write
     ends — on every path, or automatic reads wait out WRITE_FENCE_MS: with the
     delay before the re-read that covers it (0 for straight away), or with
     nothing when the write failed and changed nothing. The fence stays up
     until that re-read starts, so a timer can't slip into the 500 ms gap and
     read twice. With writes overlapping, only the last one to end reads — one
     read, once none is in flight, for all of them — and it also does a read
     that was owed (one dropped, above), whatever way it ended. A write that
     ends owing a read while another is still in flight leaves a timer too:
     should that other write never answer, the read still comes once the
     fence's age bound lets it through, not at the next heartbeat. Any read
     that starts first (the other write's own end, say) cancels it. */
  const beginWrite = () => {
    const id = ++writeSeq.current;
    writes.current.set(id, Date.now());
    return (readIn) => {
      const end = () => {
        writes.current.delete(id);
        if (readIn != null) readOwed.current = true;
        if (!readOwed.current) return;
        if (!fenced()) { readOwed.current = false; refresh(); return; }
        clearTimeout(changeTimer.current);
        changeTimer.current = setTimeout(autoRead(changeTimer), CHANGE_DEBOUNCE_MS);
      };
      if (readIn > 0) setTimeout(end, readIn); else end();
    };
  };

  return { connStatus, columns, setColumns, reads, reading, retry, beginWrite };
}
