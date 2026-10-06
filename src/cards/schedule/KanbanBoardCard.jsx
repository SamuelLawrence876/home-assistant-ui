import { useState, useEffect, useRef, useId } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";
import { callService, getTodoItems } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { KanbanAddForm } from "./KanbanAddForm.jsx";
import { KanbanTask } from "./KanbanTask.jsx";
import {
  buildDescription, dueFields, boardState, cardKey, itemRef, isTempCard, omit, TEMP_UID_PREFIX,
} from "./kanbanUtils.js";

/* ----------------------------------------------------------------
   Kanban — local todo lists stored on the Pi (local_todo integration).
   Columns: Backlog → Next → In Progress → Done.
   Tags stored as #tag in description. Due dates optional.
   ----------------------------------------------------------------*/
const DONE = "__done__";
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

function useKanbanItems(entityIds) {
  const connStatus = useConnectionStatus();
  const [columns, setColumns] = useState(() => Object.fromEntries(ALL_COL_IDS.map((id) => [id, []])));
  /* Per column: "unread" | "ok" | "error". Done is "ok" only if every list's
     completed items came back. See boardState() for what each one says. */
  const [reads, setReads] = useState(() => Object.fromEntries(ALL_COL_IDS.map((id) => [id, "unread"])));
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (connStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(entityIds.map(async (id) => {
        const [active, completed] = await Promise.allSettled([
          getTodoItems(id, "needs_action"),
          getTodoItems(id, "completed"),
        ]);
        return { id, active, completed };
      }));
      if (cancelled) return;
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
      const r = { [DONE]: results.every((x) => x.completed.status === "fulfilled") ? "ok" : "error" };
      for (const { id, active } of results) r[id] = active.status === "fulfilled" ? "ok" : "error";
      setReads(r);
    })();
    return () => { cancelled = true; };
  }, [connStatus, fetchTick]);

  const refresh = () => setFetchTick((t) => t + 1);

  return { connStatus, columns, setColumns, reads, refresh };
}

export function KanbanBoardCard({ index = 0 }) {
  const { connStatus, columns, setColumns, reads, refresh } = useKanbanItems(KANBAN_ENTITY_IDS);
  const canWrite = connStatus === "ready";
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [adding, setAdding] = useState(null);
  /* cardKey -> "undo" | "sending", for rendering. The ref holds the rest
     (card, column, timer) so a timer callback never reads stale state. */
  const [pending, setPending] = useState({});
  const pendingRef = useRef(new Map());
  const colRefs = useRef({});
  const idBase = useId();

  const focusColumn = (colId) => colRefs.current[colId]?.focus();
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
    if (fromCol === toCol || !canWrite) return;
    const card = columns[fromCol]?.find((c) => cardKey(c) === key);
    if (!card || isTempCard(card) || pendingRef.current.has(key)) return;
    optimisticMove(key, fromCol, toCol);
    try {
      if (toCol === DONE) {
        await callService("todo", "update_item", { entity_id: card._entity, item: itemRef(card), status: "completed" });
      } else if (fromCol === DONE && card._entity === toCol) {
        await callService("todo", "update_item", { entity_id: card._entity, item: itemRef(card), status: "needs_action" });
      } else {
        /* Cross-list move is two calls with no transaction. Add to the
           target FIRST so a failure between them leaves a recoverable
           duplicate instead of deleting the task from both lists. The
           new item lands as needs_action, so no status update is needed. */
        await callService("todo", "add_item", {
          entity_id: toCol,
          item: card.summary,
          ...dueFields(card.due),
          ...(card.description ? { description: card.description } : {}),
        });
        await callService("todo", "remove_item", { entity_id: card._entity, item: itemRef(card) });
      }
      setTimeout(refresh, 500);
    } catch {
      /* Put the card back, then re-read: half the move may have landed, and
         the re-read shows what really exists. Offline the re-read can't run,
         but then the first call is the one that failed, so nothing landed
         and the revert is the truth. */
      optimisticMove(key, toCol, fromCol);
      refresh();
    }
  }

  /* Resolves once Home Assistant has the task, rejects if it didn't take it.
     The form waits on this and keeps its draft on a rejection — it used to be
     closed before the call settled, so a failed add threw the typing away. */
  async function addItem(colId, summary, tags, due) {
    const desc = buildDescription(tags, "");
    await callService("todo", "add_item", {
      entity_id: colId,
      item: summary,
      ...dueFields(due),
      ...(desc ? { description: desc } : {}),
    });
    const temp = { uid: `${TEMP_UID_PREFIX}${++tempSeq}`, summary, description: desc, due: due || undefined, status: "needs_action", _entity: colId };
    setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], temp] }));
    setAdding((cur) => (cur === colId ? null : cur));
    setTimeout(refresh, 500);
  }

  function startDelete(colId, card) {
    const key = cardKey(card);
    if (pendingRef.current.has(key)) return;
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
    try {
      await callService("todo", "remove_item", removePayload(entry));
      setColumns((cur) => Object.fromEntries(
        Object.entries(cur).map(([id, items]) => [id, items.filter((c) => cardKey(c) !== key)]),
      ));
      setTimeout(refresh, 500);
    } catch {
      /* Nothing was deleted, so the card just comes back where it was. */
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
  function onDragOver(ev, col) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOver(col); }
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
  const { meta, total, columns: colView } = boardState({ connStatus, reads, counts });

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
          const targets = KANBAN_COLS.filter((c) => c.id !== id);
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
              {view.note && <p className={`kanban-col-note ${view.tone}`}>{view.note}</p>}
              {items.map((c) => {
                const key = cardKey(c);
                return (
                  <KanbanTask
                    key={key} card={c} isDone={id === DONE} targets={targets} canWrite={canWrite}
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
                  disabled={!canWrite}
                  aria-label={`Add a task to ${label}`}
                  title={canWrite ? undefined : "Not connected to Home Assistant"}
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
