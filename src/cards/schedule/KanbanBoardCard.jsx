import { useState, useEffect, useLayoutEffect, useRef, useId } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService, getTodoItems } from "../../ha/client.js";
import { describeHaError } from "../../ha/errors.js";
import { logError } from "../../lib/errorLog.js";
import { Card } from "../../components/Card.jsx";
import { KanbanAddForm } from "./KanbanAddForm.jsx";
import { KanbanTask } from "./KanbanTask.jsx";
import { useKanbanItems } from "./useKanbanItems.js";
import {
  buildDescription, dueFields, boardState, cardKey, itemRef, isTempCard, isDeadList, omit, TEMP_UID_PREFIX,
  listStamp, DONE,
} from "./kanbanUtils.js";

/* ----------------------------------------------------------------
   Kanban — local todo lists stored on the Pi (local_todo integration).
   Columns: Backlog → Next → In Progress → Done.
   Tags stored as #tag in description. Due dates optional.
   How the board reads its lists, and keeps those reads out of its own
   writes' way: useKanbanItems.js.
   ----------------------------------------------------------------*/
const KANBAN_COLS = [
  { id: "todo.backlog", label: "Backlog" },
  { id: "todo.next",    label: "Next" },
  { id: "todo.doing_2", label: "In Progress" },
  { id: DONE,           label: "Done" },
];

const KANBAN_ENTITY_IDS = KANBAN_COLS.filter((c) => c.id !== DONE).map((c) => c.id);
const ALL_COL_IDS = KANBAN_COLS.map((c) => c.id);

/* How long a deleted card sits in its slot as "Deleted · Undo" before
   remove_item is actually sent. Nothing is deleted in Home Assistant until
   this runs out, so Undo needs no compensating call. */
const UNDO_MS = 5000;

let tempSeq = 0;

/* One useEntityStatus per list. The lists are fixed, so the hooks run in the
   same order on every render. `changeKey` is every list's listStamp, joined. */
const [BACKLOG, NEXT, DOING] = KANBAN_ENTITY_IDS;
function useListStatuses() {
  const all = [useEntityStatus(BACKLOG), useEntityStatus(NEXT), useEntityStatus(DOING)];
  return {
    lists: Object.fromEntries(KANBAN_ENTITY_IDS.map((id, i) => [id, all[i].status])),
    changeKey: all.map((s) => listStamp(s.entity)).join(","),
  };
}

/* Adds `card` to `listId` and resolves with the new item's uid once a re-read
   of the list shows it there. Home Assistant skips an unavailable list and
   still reports success, so "add_item resolved" is not proof the task exists
   anywhere. Rejects without writing anything if the list can't be read first
   (getTodoItems rejects for a list HA didn't answer for). */
async function addConfirmed(listId, card) {
  const before = new Set((await getTodoItems(listId, "needs_action")).map((i) => i.uid));
  await callService("todo", "add_item", {
    entity_id: listId,
    item: card.summary,
    ...dueFields(card.due),
    ...(card.description ? { description: card.description } : {}),
  });
  const after = await getTodoItems(listId, "needs_action");
  const landed = after.find((i) => !before.has(i.uid) && i.summary === card.summary);
  if (!landed) throw new Error(`todo.add_item to ${listId} did not land`);
  return landed.uid;
}

export function KanbanBoardCard({ index = 0 }) {
  const { lists, changeKey } = useListStatuses();
  const deadKey = KANBAN_ENTITY_IDS.filter((id) => isDeadList(lists[id])).join(",");
  const readyKey = KANBAN_ENTITY_IDS.filter((id) => lists[id] === "ready").join(",");
  const { connStatus, columns, setColumns, reads, reading, retry, beginWrite } = useKanbanItems(
    KANBAN_ENTITY_IDS, { deadKey, changeKey, readyKey },
  );
  const canWrite = connStatus === "ready";
  /* A write is offered only into a list HA will act on. "loading" (no state
     snapshot yet) isn't proof the list exists, so it doesn't count either. */
  const listReady = (id) => lists[id] === "ready";
  const accepts = (colId) => colId === DONE || listReady(colId);
  const whyNoWrite = (listId) => (
    !canWrite ? "Not connected to Home Assistant"
      : listReady(listId) ? undefined
        : isDeadList(lists[listId]) ? "This list is unavailable in Home Assistant" : "Loading…"
  );
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [adding, setAdding] = useState(null);
  /* cardKey -> "undo" | "sending", for rendering. The ref holds the rest
     (card, column, timer) so a timer callback never reads stale state. */
  const [pending, setPending] = useState({});
  const pendingRef = useRef(new Map());
  /* Cards whose move is still in flight. Such a card is already drawn in its
     new column but still carries its old list and uid — the very item the move
     is deleting — so a second move or a delete from it hit a dead uid and left
     the task in two lists. Refused until the move settles. The ref is the
     synchronous guard against a double click; the state is for rendering. */
  const [moving, setMoving] = useState({});
  const movingRef = useRef(new Set());
  const colRefs = useRef({});
  const idBase = useId();

  const focusColumn = (colId, opts) => colRefs.current[colId]?.focus(opts);
  /* Retry goes away by itself — its read works (pressed or on the timer), the
     socket drops, the list goes unavailable. If it had keyboard focus, hand
     focus to its column rather than to <body>. Its ref callback runs before
     the button leaves the DOM, while it still has focus; the handover itself
     waits for the commit. No scroll: the timer can fire after the page has
     moved on. A tap is left alone — Enter/Space clicks have detail 0 (as in
     KanbanTask), and a pointer click clears what focusing it recorded. */
  const retryKeyed = useRef(null);
  const retryLost = useRef(null);
  const retryEls = useRef({});
  const retryRefs = useRef({});
  const retryButtonRef = (colId) => {
    retryRefs.current[colId] ||= (el) => {
      const was = retryEls.current[colId];
      retryEls.current[colId] = el;
      if (!el && was && was === document.activeElement && retryKeyed.current === colId) retryLost.current = colId;
    };
    return retryRefs.current[colId];
  };
  const onRetry = (colId) => (ev) => {
    retryKeyed.current = ev.detail === 0 ? colId : null;
    retry();
  };
  useLayoutEffect(() => {
    const colId = retryLost.current;
    retryLost.current = null;
    if (colId && !retryEls.current[colId] && (!document.activeElement || document.activeElement === document.body)) {
      focusColumn(colId, { preventScroll: true });
    }
  });
  const removePayload = ({ card, colId }) => ({ entity_id: card._entity || colId, item: itemRef(card) });

  function optimisticMove(key, fromCol, toCol) {
    setColumns((cur) => {
      const card = cur[fromCol]?.find((c) => cardKey(c) === key);
      if (!card) return cur;
      return {
        ...cur,
        [fromCol]: cur[fromCol].filter((c) => cardKey(c) !== key),
        [toCol]: [card, ...cur[toCol]],
      };
    });
  }

  async function moveCard(key, fromCol, toCol) {
    if (fromCol === toCol || !canWrite || movingRef.current.has(key)) return;
    const card = columns[fromCol]?.find((c) => cardKey(c) === key);
    if (!card || isTempCard(card) || pendingRef.current.has(key)) return;
    if (!listReady(card._entity) || !accepts(toCol)) return;
    movingRef.current.add(key);
    setMoving((m) => ({ ...m, [key]: true }));
    optimisticMove(key, fromCol, toCol);
    const endWrite = beginWrite();
    try {
      if (toCol === DONE) {
        await callService("todo", "update_item", { entity_id: card._entity, item: itemRef(card), status: "completed" });
      } else if (fromCol === DONE && card._entity === toCol) {
        await callService("todo", "update_item", { entity_id: card._entity, item: itemRef(card), status: "needs_action" });
      } else {
        /* Cross-list move is two calls with no transaction. The add goes
           first and is CONFIRMED by re-reading the target (addConfirmed);
           only then is the source removed. Any failure leaves the task where
           it was or, at worst, in both lists — never in neither. The new item
           lands as needs_action, so no status update is needed.
           The card can be older than the list, though: one deleted (or
           completed, or moved) elsewhere since the last read is still drawn
           here, and adding it would bring it back. So the source has to still
           hold it, by uid, in the state its column shows — or nothing is sent.
           What is added is the item as that check read it, not the card, or
           a rename, tag or due date changed elsewhere since would be lost. */
        const was = fromCol === DONE ? "completed" : "needs_action";
        const fresh = (await getTodoItems(card._entity, was)).find((i) => i.uid === card.uid);
        if (!fresh) throw new Error(`item is no longer in ${card._entity} (changed or deleted elsewhere)`);
        const now = { summary: fresh.summary, description: fresh.description, due: fresh.due };
        const uid = await addConfirmed(toCol, now);
        await callService("todo", "remove_item", { entity_id: card._entity, item: itemRef(card) });
        /* The card now IS the new item: give it that list, uid and content,
           so the next move or delete before the re-read targets what exists. */
        setColumns((cur) => ({
          ...cur,
          [toCol]: cur[toCol].map((c) => (cardKey(c) === key ? { ...c, ...now, uid, _entity: toCol, status: "needs_action" } : c)),
        }));
      }
      endWrite(500);
    } catch (err) {
      /* Most failures here never pass through callService — a list that
         couldn't be read, an add HA silently skipped, a task changed
         elsewhere — so nothing else would record them, and the card would
         just snap back without a word. */
      logError({ source: "service", message: "Kanban move didn't go through", detail: `${fromCol} → ${toCol} · ${describeHaError(err)}` });
      /* Put the card back, then re-read: half the move may have landed, and
         the re-read shows what really exists. Offline the re-read can't run,
         but then the first call is the one that failed, so nothing landed
         and the revert is the truth. */
      optimisticMove(key, toCol, fromCol);
      endWrite(0);
    } finally {
      movingRef.current.delete(key);
      setMoving((m) => omit(m, key));
    }
  }

  /* Resolves once Home Assistant has the task, rejects if it didn't take it.
     The form waits on this and keeps its draft on a rejection — it used to be
     closed before the call settled, so a failed add threw the typing away. */
  async function addItem(colId, summary, tags, due) {
    /* HA would skip a dead list and still say yes, and the "added" card would
       vanish on the next read. Refuse instead, so the form keeps the draft. */
    if (!listReady(colId)) throw new Error(`${colId} is not available`);
    const desc = buildDescription(tags, "");
    const endWrite = beginWrite();
    await callService("todo", "add_item", {
      entity_id: colId,
      item: summary,
      ...dueFields(due),
      ...(desc ? { description: desc } : {}),
    }).catch((err) => { endWrite(); throw err; });
    const temp = { uid: `${TEMP_UID_PREFIX}${++tempSeq}`, summary, description: desc, due: due || undefined, status: "needs_action", _entity: colId };
    setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], temp] }));
    setAdding((cur) => (cur === colId ? null : cur));
    endWrite(500);
  }

  function startDelete(colId, card) {
    const key = cardKey(card);
    if (pendingRef.current.has(key) || movingRef.current.has(key) || !listReady(card._entity || colId)) return;
    const timer = setTimeout(() => commitDelete(key), UNDO_MS);
    pendingRef.current.set(key, { card, colId, timer, sent: false });
    setPending((p) => ({ ...p, [key]: "undo" }));
  }

  function undoDelete(key) {
    const entry = pendingRef.current.get(key);
    if (!entry || entry.sent) return;
    clearTimeout(entry.timer);
    pendingRef.current.delete(key);
    setPending((p) => omit(p, key));
  }

  async function commitDelete(key) {
    const entry = pendingRef.current.get(key);
    if (!entry || entry.sent) return;
    entry.sent = true;
    /* Undo is about to disappear; don't strand keyboard focus on nothing. */
    if (document.activeElement?.closest?.("[data-kanban-key]")?.getAttribute("data-kanban-key") === key) {
      focusColumn(entry.colId);
    }
    setPending((p) => ({ ...p, [key]: "sending" }));
    const endWrite = beginWrite();
    try {
      await callService("todo", "remove_item", removePayload(entry));
      setColumns((cur) => Object.fromEntries(
        Object.entries(cur).map(([id, items]) => [id, items.filter((c) => cardKey(c) !== key)]),
      ));
      endWrite(500);
    } catch {
      /* Nothing was deleted, so the card just comes back where it was. */
      endWrite();
    } finally {
      pendingRef.current.delete(key);
      setPending((p) => omit(p, key));
    }
  }

  /* Leaving the tab inside the undo window SENDS the delete rather than
     cancelling it: pressing × was the decision, and Undo is the only thing
     that takes it back. Closing or reloading the page inside the window is
     different — no unmount runs, the timer dies with the page, nothing is
     sent, and the task is still there next time. That's the safe way round. */
  useEffect(() => {
    const entries = pendingRef.current;
    return () => {
      for (const entry of entries.values()) {
        if (entry.sent) continue;
        clearTimeout(entry.timer);
        entry.sent = true;
        callService("todo", "remove_item", removePayload(entry)).catch(() => {});
      }
      entries.clear();
    };
  }, []);

  function onDragStart(ev, key, col) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ uid: key, col }));
    ev.dataTransfer.effectAllowed = "move";
    setDraggingId(key);
  }
  function onDragEnd() { setDraggingId(null); setDragOver(null); }
  /* No preventDefault over a dead list: the browser then refuses the drop
     itself and shows "can't drop here". */
  function onDragOver(ev, col) {
    if (!accepts(col)) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOver(col);
  }
  function onDrop(ev, col) {
    ev.preventDefault();
    try {
      const { uid, col: fromCol } = JSON.parse(ev.dataTransfer.getData("text/plain"));
      moveCard(uid, fromCol, col);
    } catch {}
    setDragOver(null);
    setDraggingId(null);
  }

  const counts = Object.fromEntries(ALL_COL_IDS.map((id) => [id, columns[id]?.length || 0]));
  const { meta, total, columns: colView } = boardState({ connStatus, reads, counts, lists });

  return (
    <Card
      index={index}
      eyebrow={`Kanban${total == null ? "" : ` · ${total} items`}`}
      title="Project board"
      meta={meta}
    >
      <div className="kanban">
        {KANBAN_COLS.map(({ id, label }) => {
          const items = columns[id] || [];
          const view = colView[id];
          const headId = `${idBase}-${id}`;
          const targets = KANBAN_COLS.filter((c) => c.id !== id)
            .map((c) => ({ ...c, disabled: !accepts(c.id), why: whyNoWrite(c.id) }));
          return (
            /* Focusable from script only (tabIndex -1): it's where focus
               lands after a keyboard move, because the card itself remounts
               in its new column — and again, with a new uid, on the next read. */
            <div
              key={id}
              ref={(el) => { colRefs.current[id] = el; }}
              tabIndex={-1}
              role="group"
              aria-labelledby={headId}
              className={`kanban-col ${dragOver === id ? "drag-over" : ""}`}
              onDragOver={(ev) => onDragOver(ev, id)}
              onDragLeave={() => setDragOver((cur) => (cur === id ? null : cur))}
              onDrop={(ev) => onDrop(ev, id)}
            >
              <div className="kanban-col-head">
                <span className="label" id={headId}>{label}</span>
                <span className="count">{view.count}</span>
              </div>
              {view.note && (
                <p className={`kanban-col-note ${view.tone}`}>
                  {view.note}
                  {/* aria-disabled, not disabled: a focused button that turns
                      disabled drops keyboard focus on the floor. */}
                  {view.retry && (
                    <button
                      ref={retryButtonRef(id)}
                      type="button"
                      className="kanban-retry"
                      onFocus={() => { retryKeyed.current = id; }}
                      onClick={onRetry(id)}
                      aria-disabled={reading || undefined}
                      aria-label={reading ? `Retrying ${label}` : `Retry ${label}`}
                    >
                      {reading ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </p>
              )}
              {items.map((c) => {
                const key = cardKey(c);
                return (
                  <KanbanTask
                    key={key} card={c} isDone={id === DONE} targets={targets}
                    canWrite={canWrite && listReady(c._entity) && !moving[key]}
                    dragging={draggingId === key} pending={pending[key]}
                    onDragStart={(ev) => onDragStart(ev, key, id)} onDragEnd={onDragEnd}
                    onMove={(toCol, hadFocus) => { moveCard(key, id, toCol); if (hadFocus) focusColumn(toCol); }}
                    onDelete={() => startDelete(id, c)} onUndo={() => undoDelete(key)}
                  />
                );
              })}
              {adding === id ? (
                <KanbanAddForm onSubmit={(s, t, d) => addItem(id, s, t, d)} onCancel={() => setAdding(null)} />
              ) : id !== DONE ? (
                <button
                  type="button"
                  className="kanban-add"
                  onClick={() => setAdding(id)}
                  disabled={!canWrite || !listReady(id)}
                  aria-label={`Add a task to ${label}`}
                  title={whyNoWrite(id)}
                >
                  + Add
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
