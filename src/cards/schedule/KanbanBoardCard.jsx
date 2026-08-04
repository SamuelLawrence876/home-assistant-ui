import { useState, useEffect } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";
import { callService, getTodoItems } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { KanbanAddForm } from "./KanbanAddForm.jsx";
import { parseTags, buildDescription, fmtDue, dueFields } from "./kanbanUtils.js";

/* ----------------------------------------------------------------
   Kanban — local todo lists stored on the Pi (local_todo integration).
   Columns: Backlog → Next → In Progress → Done.
   Tags stored as #tag in description. Due dates optional.
   ----------------------------------------------------------------*/
const KANBAN_COLS = [
  { id: "todo.backlog", label: "Backlog" },
  { id: "todo.next",    label: "Next" },
  { id: "todo.doing_2", label: "In Progress" },
  { id: "__done__",      label: "Done" },
];

const KANBAN_ENTITY_IDS = KANBAN_COLS.filter((c) => c.id !== "__done__").map((c) => c.id);

function useKanbanItems(entityIds) {
  const connStatus = useConnectionStatus();
  const [columns, setColumns] = useState(() => {
    const out = {};
    for (const id of entityIds) out[id] = [];
    out.__done__ = [];
    return out;
  });
  const [loading, setLoading] = useState(true);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (connStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      const out = {};
      const done = [];
      for (const id of entityIds) {
        out[id] = [];
        try {
          const [active, completed] = await Promise.all([
            getTodoItems(id, "needs_action"),
            getTodoItems(id, "completed"),
          ]);
          out[id] = active.map((it) => ({ ...it, _entity: id }));
          done.push(...completed.map((it) => ({ ...it, _entity: id })));
        } catch {}
      }
      if (cancelled) return;
      setColumns({ ...out, __done__: done });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [connStatus, fetchTick]);

  const refresh = () => setFetchTick((t) => t + 1);

  return { columns, setColumns, loading, refresh };
}

export function KanbanBoardCard({ index = 0 }) {
  const { columns, setColumns, loading, refresh } = useKanbanItems(KANBAN_ENTITY_IDS);
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [adding, setAdding] = useState(null);

  function optimisticMove(uid, fromCol, toCol) {
    setColumns((cur) => {
      const next = { ...cur };
      const card = cur[fromCol].find((c) => (c.uid || c.summary) === uid);
      if (!card) return cur;
      next[fromCol] = cur[fromCol].filter((c) => (c.uid || c.summary) !== uid);
      next[toCol] = [card, ...cur[toCol]];
      return next;
    });
  }

  async function moveCard(uid, fromCol, toCol) {
    if (fromCol === toCol) return;
    const card = columns[fromCol]?.find((c) => (c.uid || c.summary) === uid);
    if (!card) return;
    optimisticMove(uid, fromCol, toCol);
    try {
      if (toCol === "__done__") {
        await callService("todo", "update_item", {
          entity_id: card._entity,
          item: card.summary,
          status: "completed",
        });
      } else if (fromCol === "__done__") {
        const targetEntity = toCol;
        if (card._entity === targetEntity) {
          await callService("todo", "update_item", {
            entity_id: card._entity,
            item: card.summary,
            status: "needs_action",
          });
        } else {
          /* Cross-list move is two calls with no transaction. Add to the
             target FIRST so a failure between them leaves a recoverable
             duplicate instead of deleting the task from both lists. The
             new item lands as needs_action, so no status update is needed. */
          await callService("todo", "add_item", {
            entity_id: targetEntity,
            item: card.summary,
            ...dueFields(card.due),
            ...(card.description ? { description: card.description } : {}),
          });
          await callService("todo", "remove_item", {
            entity_id: card._entity,
            item: card.summary,
          });
        }
      } else {
        /* Add-then-remove for the same reason as above. */
        await callService("todo", "add_item", {
          entity_id: toCol,
          item: card.summary,
          ...dueFields(card.due),
          ...(card.description ? { description: card.description } : {}),
        });
        await callService("todo", "remove_item", {
          entity_id: fromCol,
          item: card.summary,
        });
      }
      setTimeout(refresh, 500);
    } catch {
      /* Don't trust the optimistic revert — half the move may have landed.
         Re-read both lists from the Pi so the board shows what really exists. */
      refresh();
    }
  }

  async function addItem(colId, summary, tags, due) {
    const desc = buildDescription(tags, "");
    const temp = { uid: `temp-${Date.now()}`, summary, description: desc, due: due || undefined, status: "needs_action", _entity: colId };
    setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], temp] }));
    setAdding(null);
    try {
      await callService("todo", "add_item", {
        entity_id: colId,
        item: summary,
        ...dueFields(due),
        ...(desc ? { description: desc } : {}),
      });
      setTimeout(refresh, 500);
    } catch {
      setColumns((cur) => ({ ...cur, [colId]: cur[colId].filter((c) => c.uid !== temp.uid) }));
    }
  }

  async function removeItem(colId, card) {
    setColumns((cur) => ({
      ...cur,
      [colId]: cur[colId].filter((c) => (c.uid || c.summary) !== (card.uid || card.summary)),
    }));
    try {
      await callService("todo", "remove_item", {
        entity_id: card._entity || colId,
        item: card.summary,
      });
      setTimeout(refresh, 500);
    } catch {
      setColumns((cur) => ({ ...cur, [colId]: [...cur[colId], card] }));
    }
  }

  function onDragStart(ev, uid, col) {
    ev.dataTransfer.setData("text/plain", JSON.stringify({ uid, col }));
    ev.dataTransfer.effectAllowed = "move";
    setDraggingId(uid);
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

  const liveCount = KANBAN_ENTITY_IDS.reduce((n, id) => n + (columns[id]?.length || 0), 0) + (columns.__done__?.length || 0);

  return (
    <Card
      index={index}
      eyebrow={`Kanban${loading ? "" : ` · ${liveCount} items`}`}
      title="Project board"
      meta={loading ? "loading…" : "drag cards between columns"}
    >
      <div className="kanban">
        {KANBAN_COLS.map(({ id, label }) => {
          const items = columns[id] || [];
          const isDone = id === "__done__";
          const canAdd = id !== "__done__";
          return (
            <div
              key={id}
              className={`kanban-col ${dragOver === id ? "drag-over" : ""}`}
              onDragOver={(ev) => onDragOver(ev, id)}
              onDragLeave={() => setDragOver((cur) => (cur === id ? null : cur))}
              onDrop={(ev) => onDrop(ev, id)}
            >
              <div className="kanban-col-head">
                <span className="label">{label}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map((c) => {
                const key = c.uid || c.summary;
                const { tags } = parseTags(c.description);
                const dueLabel = fmtDue(c.due);
                return (
                  <div
                    key={key}
                    className={`kanban-card ${isDone ? "done" : ""} ${draggingId === key ? "dragging" : ""}${dueLabel === "overdue" ? " overdue" : ""}`}
                    draggable
                    onDragStart={(ev) => onDragStart(ev, key, id)}
                    onDragEnd={onDragEnd}
                  >
                    <button
                      type="button"
                      className="kanban-card-x"
                      onClick={() => removeItem(id, c)}
                      title="Delete"
                      aria-label={`Delete ${c.summary}`}
                    >
                      &times;
                    </button>
                    <div className="summary">{c.summary}</div>
                    <div className="meta">
                      <span className="tags">
                        {tags.map((t) => <span key={t} className={`tag tag-${t}`}>{t}</span>)}
                      </span>
                      {dueLabel && <span className={`due${dueLabel === "overdue" ? " due-overdue" : ""}`}>due · {dueLabel}</span>}
                    </div>
                  </div>
                );
              })}
              {adding === id ? (
                <KanbanAddForm onSubmit={(s, t, d) => addItem(id, s, t, d)} onCancel={() => setAdding(null)} />
              ) : canAdd ? (
                <button type="button" className="kanban-add" onClick={() => setAdding(id)} aria-label={`Add a task to ${label}`}>+ Add</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
