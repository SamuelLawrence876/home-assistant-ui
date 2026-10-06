import { useState, useEffect, useRef } from "react";
import { normaliseTag, tagDropsCharacters } from "./kanbanUtils.js";

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
  /* Why the last custom tag isn't stored exactly as typed, or "". */
  const [tagHint, setTagHint] = useState("");
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
  function toggleMenu() {
    setTagHint("");
    setShowTagMenu((open) => !open);
  }
  /* The box is a pointer shortcut to the toggle, the way the whole box was
     one button before the chips got their own remove buttons — chips can
     fill its first row and wrap the toggle into a small corner. The real
     <button> is still the keyboard and screen-reader way in, and a click on
     any button inside the box is left to that button. */
  /* A div with onClick, deliberately (LESSONS.md pattern 8 is about controls):
     this is only a bigger mouse/touch target for the real toggle <button>,
     which stays the keyboard and screen-reader way in. A click on a button
     inside it (a chip's ×, the toggle itself) is that button's, not the box's. */
  function onBoxClick(ev) {
    if (ev.target.closest("button")) return;
    toggleMenu();
    toggleRef.current?.focus();
  }
  /* A tag is stored only as letters, marks, digits, - and _ (normaliseTag),
     so "C++" becomes "c" and an emoji becomes nothing. Either way it is
     said: the input used to just clear, with no chip and no reason. A tag
     that can't be made keeps its text so it can be fixed. */
  function addCustomTag(ev) {
    ev.preventDefault();
    if (!customTag.trim()) { setCustomTag(""); return; }
    const t = normaliseTag(customTag);
    if (!t) {
      setTagHint(`Can’t make a tag from “${customTag.trim()}” — use letters, numbers, - or _.`);
      return;
    }
    if (!selectedTags.includes(t)) setSelectedTags((cur) => [...cur, t]);
    setTagHint(tagDropsCharacters(customTag) ? `Added as #${t} — tags keep only letters, numbers, - and _.` : "");
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
          <div className="kanban-tag-toggle" onClick={onBoxClick}>
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
              onClick={toggleMenu}
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
                  onChange={(ev) => { setCustomTag(ev.target.value); setTagHint(""); }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") addCustomTag(ev); }}
                />
                {/* Always in the DOM so the live region exists before it
                    has anything to say; zero height while empty. */}
                <p className="kanban-tag-hint" role="status">{tagHint}</p>
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
