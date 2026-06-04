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

function fmtDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diff = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
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
          await callService("todo", "update_item", {
            entity_id: card._entity,
            item: card.summary,
            status: "needs_action",
          });
          await callService("todo", "remove_item", {
            entity_id: card._entity,
            item: card.summary,
          });
          await callService("todo", "add_item", {
            entity_id: targetEntity,
            item: card.summary,
            ...(card.due ? { due_date: card.due } : {}),
            ...(card.description ? { description: card.description } : {}),
          });
        }
      } else {
        await callService("todo", "remove_item", {
          entity_id: fromCol,
          item: card.summary,
        });
        await callService("todo", "add_item", {
          entity_id: toCol,
          item: card.summary,
          ...(card.due ? { due_date: card.due } : {}),
          ...(card.description ? { description: card.description } : {}),
        });
      }
      setTimeout(refresh, 500);
    } catch {
      optimisticMove(uid, toCol, fromCol);
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
        ...(due ? { due_date: due } : {}),
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
                    <button className="kanban-card-x" onClick={() => removeItem(id, c)} title="Delete">&times;</button>
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
                <button className="kanban-add" onClick={() => setAdding(id)}>+ Add</button>
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
      <input ref={ref} className="kanban-input" placeholder="What needs doing?" value={summary} onChange={(ev) => setSummary(ev.target.value)} />
      <div className="kanban-add-row">
        <div className="kanban-tag-picker" ref={menuRef}>
          <button type="button" className="kanban-tag-toggle" onClick={() => setShowTagMenu(!showTagMenu)}>
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
              <form className="kanban-tag-custom" onSubmit={addCustomTag}>
                <input className="kanban-input kanban-input-sm" placeholder="Custom tag…" value={customTag} onChange={(ev) => setCustomTag(ev.target.value)} />
              </form>
            </div>
          )}
        </div>
        <input className="kanban-input kanban-input-sm kanban-date" type="date" value={due} onChange={(ev) => setDue(ev.target.value)} />
      </div>
      <div className="kanban-add-row">
        <button type="submit" className="kanban-add-btn">Add</button>
        <button type="button" className="kanban-add-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
