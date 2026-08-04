import { useState, useEffect, useRef } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";
import { callService, getTodoItems } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

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

const KANBAN_PRESET_TAGS = [
  { id: "ha",           label: "HA" },
  { id: "work",         label: "Work" },
  { id: "side-project", label: "Side Project" },
  { id: "fun",          label: "Fun" },
  { id: "errand",       label: "Errand" },
  { id: "learning",     label: "Learning" },
  { id: "health",       label: "Health" },
  { id: "finance",      label: "Finance" },
];
const KANBAN_ENTITY_IDS = KANBAN_COLS.filter((c) => c.id !== "__done__").map((c) => c.id);

function parseTags(description) {
  if (!description) return { tags: [], text: "" };
  const tags = [];
  const text = description.replace(/#(\w[\w-]*)/g, (_, t) => { tags.push(t); return ""; }).trim();
  return { tags, text };
}

function buildDescription(tags, text) {
  const parts = [];
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(" "));
  if (text) parts.push(text);
  return parts.join(" ") || undefined;
}

/* HA to-do items carry either a bare date ("2026-06-10") or a full datetime
   ("2026-06-10T14:30:00+01:00"). Only the bare form needs the midnight suffix
   to parse as local time — appending it to a datetime yields Invalid Date. */
function fmtDue(dateStr) {
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
function dueFields(due) {
  if (!due) return {};
  return due.length > 10 ? { due_datetime: due } : { due_date: due };
}

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

function KanbanAddForm({ onSubmit, onCancel }) {
  const [summary, setSummary] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [due, setDue] = useState("");
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!showTagMenu) return;
    function close(ev) { if (menuRef.current && !menuRef.current.contains(ev.target)) setShowTagMenu(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showTagMenu]);

  function toggleTag(id) {
    setSelectedTags((cur) => cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]);
  }
  function addCustomTag(ev) {
    ev.preventDefault();
    const t = customTag.replace(/^#/, "").replace(/\s+/g, "-").toLowerCase().trim();
    if (t && !selectedTags.includes(t)) setSelectedTags((cur) => [...cur, t]);
    setCustomTag("");
  }
  function removeTag(id) { setSelectedTags((cur) => cur.filter((t) => t !== id)); }

  function handle(ev) {
    ev.preventDefault();
    const s = summary.trim();
    if (!s) return;
    onSubmit(s, selectedTags, due || null);
  }

  const tagLabel = (id) => KANBAN_PRESET_TAGS.find((p) => p.id === id)?.label || id;

  return (
    <form className="kanban-add-form" onSubmit={handle}>
      <input ref={ref} className="kanban-input" placeholder="What needs doing?" aria-label="Task summary" value={summary} onChange={(ev) => setSummary(ev.target.value)} />
      <div className="kanban-add-row">
        <div className="kanban-tag-picker" ref={menuRef}>
          <button
            type="button"
            className="kanban-tag-toggle"
            onClick={() => setShowTagMenu(!showTagMenu)}
            aria-label="Choose tags"
            aria-expanded={showTagMenu}
          >
            {selectedTags.length ? selectedTags.map((t) => (
              <span key={t} className={`tag tag-${t}`}>{tagLabel(t)} <span className="tag-rm" onClick={(ev) => { ev.stopPropagation(); removeTag(t); }}>&times;</span></span>
            )) : <span className="placeholder">+ Tags</span>}
          </button>
          {showTagMenu && (
            <div className="kanban-tag-menu">
              {KANBAN_PRESET_TAGS.map(({ id, label }) => (
                <button key={id} type="button" className={`kanban-tag-option ${selectedTags.includes(id) ? "selected" : ""}`} onClick={() => toggleTag(id)}>
                  <span className={`tag-dot tag-${id}`} />
                  {label}
                  {selectedTags.includes(id) && <span className="check">✓</span>}
                </button>
              ))}
              {/* Deliberately a div, not a form: nesting forms is invalid HTML
                  and the inner submit bubbles up, firing the outer form's
                  handler and creating the task before the tag is applied. */}
              <div className="kanban-tag-custom">
                <input
                  className="kanban-input kanban-input-sm"
                  placeholder="Custom tag…"
                  aria-label="Custom tag"
                  value={customTag}
                  onChange={(ev) => setCustomTag(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === "Enter") addCustomTag(ev); }}
                />
              </div>
            </div>
          )}
        </div>
        <input className="kanban-input kanban-input-sm kanban-date" type="date" aria-label="Due date" value={due} onChange={(ev) => setDue(ev.target.value)} />
      </div>
      <div className="kanban-add-row">
        <button type="submit" className="kanban-add-btn">Add</button>
        <button type="button" className="kanban-add-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
