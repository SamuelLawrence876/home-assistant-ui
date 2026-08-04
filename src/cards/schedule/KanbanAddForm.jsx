import { useState, useEffect, useRef } from "react";

/* The inline "+ Add" form on a Kanban column. Owns nothing but its own draft:
   it hands (summary, tags, dueDate) back to KanbanBoardCard, which is the only
   thing that talks to Home Assistant. */

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
          {/* The chips inside this button are the only place the current
              selection is shown, and aria-label overrides them — so the
              label has to carry the selection itself, or a screen reader
              is told "Choose tags" and never which ones are chosen. */}
          <button
            type="button"
            ref={toggleRef}
            className="kanban-tag-toggle"
            onClick={() => setShowTagMenu(!showTagMenu)}
            aria-label={
              selectedTags.length
                ? `Tags: ${selectedTags.map(tagLabel).join(", ")}. Choose tags`
                : "Choose tags"
            }
            aria-haspopup="true"
            aria-expanded={showTagMenu}
          >
            {selectedTags.length ? selectedTags.map((t) => (
              /* The × is a mouse shortcut layered on the button, not a
                 control of its own — it cannot be one, because a button
                 inside a button is not valid HTML. Hidden from assistive
                 tech so it is not announced as something to press; the
                 keyboard route to the same result is to reopen the menu
                 and unpick the tag. See notesForOwner: that route does not
                 exist yet for a custom tag. */
              <span key={t} className={`tag tag-${t}`}>{tagLabel(t)} <span className="tag-rm" aria-hidden="true" onClick={(ev) => { ev.stopPropagation(); removeTag(t); }}>&times;</span></span>
            )) : <span className="placeholder">+ Tags</span>}
          </button>
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
      <div className="kanban-add-row">
        <button type="submit" className="kanban-add-btn">Add</button>
        <button type="button" className="kanban-add-btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
