import { useState, useEffect, useRef } from "react";
import { normaliseTag } from "./kanbanUtils.js";

/* The inline "+ Add" form on a Kanban column. Owns nothing but its own draft:
   it hands (summary, tags, dueDate) back to KanbanBoardCard, which is the only
   thing that talks to Home Assistant.

   `onSubmit` returns a promise. On success the board closes this form; on a
   rejection the form stays exactly as it was, with a line saying the add
   didn't land — the draft is the user's work and a failed call doesn't get to
   throw it away. */

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

export function KanbanAddForm({ onSubmit, onCancel }) {
  const [summary, setSummary] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [due, setDue] = useState("");
  const [send, setSend] = useState("idle"); // "idle" | "busy" | "failed"
  const ref = useRef(null);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!showTagMenu) return;
    function close(ev) { if (menuRef.current && !menuRef.current.contains(ev.target)) setShowTagMenu(false); }
    /* Escape as well as click-outside: the menu was dismissable only by
       pointing somewhere else, which is not a thing a keyboard can do.
       Focus goes back to the toggle so you are not left standing on an
       element that has just been unmounted. */
    function onKey(ev) {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      setShowTagMenu(false);
      toggleRef.current?.focus();
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [showTagMenu]);

  function toggleTag(id) {
    setSelectedTags((cur) => cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]);
  }
  function addCustomTag(ev) {
    ev.preventDefault();
    const t = normaliseTag(customTag);
    if (t && !selectedTags.includes(t)) setSelectedTags((cur) => [...cur, t]);
    setCustomTag("");
  }
  /* The chip's × is about to unmount under the focus it holds; hand focus
     to the tag toggle so the keyboard isn't dropped back at <body>. */
  function removeTag(id) {
    setSelectedTags((cur) => cur.filter((t) => t !== id));
    toggleRef.current?.focus();
  }

  async function handle(ev) {
    ev.preventDefault();
    const s = summary.trim();
    if (!s || send === "busy") return;
    setSend("busy");
    try {
      await onSubmit(s, selectedTags, due || null);
      setSend("idle");
    } catch {
      setSend("failed");
    }
  }

  const tagLabel = (id) => KANBAN_PRESET_TAGS.find((p) => p.id === id)?.label || id;

  return (
    <form className="kanban-add-form" onSubmit={handle}>
      <input ref={ref} className="kanban-input" placeholder="What needs doing?" aria-label="Task summary" value={summary} onChange={(ev) => setSummary(ev.target.value)} />
      <div className="kanban-add-row">
        <div className="kanban-tag-picker" ref={menuRef}>
          {/* A box holding the chosen chips, each with its own remove
              button, and the menu toggle filling the rest. The chips used to
              sit inside the toggle, which left their × as an aria-hidden
              mouse-only <span> — a button inside a button isn't valid HTML —
              so a custom tag couldn't be removed from the keyboard at all. */}
          <div className="kanban-tag-toggle">
            {selectedTags.map((t) => (
              <span key={t} className={`tag tag-${t}`}>
                {tagLabel(t)}
                <button type="button" className="tag-rm" onClick={() => removeTag(t)} aria-label={`Remove tag ${tagLabel(t)}`}>&times;</button>
              </span>
            ))}
            {/* The label carries the selection too, so the toggle alone
                still says which tags are chosen. */}
            <button
              type="button"
              ref={toggleRef}
              className="kanban-tag-open"
              onClick={() => setShowTagMenu(!showTagMenu)}
              aria-label={
                selectedTags.length
                  ? `Tags: ${selectedTags.map(tagLabel).join(", ")}. Choose tags`
                  : "Choose tags"
              }
              aria-haspopup="true"
              aria-expanded={showTagMenu}
            >
              <span className="placeholder">{selectedTags.length ? "+" : "+ Tags"}</span>
            </button>
          </div>
          {showTagMenu && (
            <div className="kanban-tag-menu">
              {KANBAN_PRESET_TAGS.map(({ id, label }) => (
                <button key={id} type="button" className={`kanban-tag-option ${selectedTags.includes(id) ? "selected" : ""}`} aria-pressed={selectedTags.includes(id)} onClick={() => toggleTag(id)}>
                  <span className={`tag-dot tag-${id}`} aria-hidden="true" />
                  {label}
                  {selectedTags.includes(id) && <span className="check" aria-hidden="true">✓</span>}
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
      {send === "failed" && (
        <p className="kanban-add-error" role="alert">
          Couldn&apos;t add this — Home Assistant didn&apos;t take it. It&apos;s still here; try again.
        </p>
      )}
      <div className="kanban-add-row">
        <button type="submit" className="kanban-add-btn" disabled={send === "busy"}>
          {send === "busy" ? "Adding…" : "Add"}
        </button>
        <button type="button" className="kanban-add-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
