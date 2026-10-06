import { useState, useRef, useEffect, useId } from "react";
import { parseTags, fmtDue, isTempCard, cardKey } from "./kanbanUtils.js";

/* One task on the Kanban board. Private to KanbanBoardCard, which owns every
   Home Assistant call — this file owns only what a card looks like and where
   keyboard focus goes when its controls come and go.

   Three shapes:
   - normal: move + delete in the top-right corner, revealed on hover, on
     keyboard focus (a11y.css) and always on a touch screen.
   - pending delete: the card keeps its own height with its content hidden and
     a "Deleted · Undo" line over it. Holding the slot is what stops a
     double-click on × from landing on the next card's × as it slides up.
   - temp: an add that Home Assistant has accepted but not yet handed back a
     uid for. No controls until the next read, because nothing can target it
     reliably until then.

   `canWrite` is per card: the board turns it off while offline, while the
   card's own list is unavailable, and while a move of this card is in flight. */

export function KanbanTask({
  card, isDone, targets, dragging, pending, canWrite,
  onDragStart, onDragEnd, onMove, onDelete, onUndo,
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const moveId = useId();
  const rootRef = useRef(null);
  const moveBtnRef = useRef(null);
  const xRef = useRef(null);
  const undoRef = useRef(null);
  /* × and Undo replace each other, so whichever one had focus is about to be
     unmounted. Hand focus across after the render that swaps them, and only
     when it was really there — focusing on behalf of a mouse click would
     light up a focus ring nobody asked for. */
  const focusNext = useRef(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "undo") undoRef.current?.focus();
    else if (target === "x") xRef.current?.focus();
  }, [pending]);
  /* The Move row comes after × in the DOM (× sits in the corner with Move;
     the row is in flow below the card), so the next Tab after opening it
     landed on Delete. A keyboard open hands focus straight to the first
     option instead; Escape gives it back to the toggle. */
  const focusFirstOpt = useRef(false);
  useEffect(() => {
    if (!moveOpen || !focusFirstOpt.current) return;
    focusFirstOpt.current = false;
    rootRef.current?.querySelector(".kanban-move-opt:not(:disabled)")?.focus();
  }, [moveOpen]);

  const temp = isTempCard(card);
  const interactive = canWrite && !pending && !temp;
  const { tags } = parseTags(card.description);
  const dueLabel = fmtDue(card.due);

  function handleDelete() {
    if (document.activeElement === xRef.current) focusNext.current = "undo";
    setMoveOpen(false);
    onDelete();
  }
  function handleUndo() {
    if (document.activeElement === undoRef.current) focusNext.current = "x";
    onUndo();
  }
  /* A click from Enter or Space has detail 0; a mouse click or a tap has 1+.
     Focus only follows a keyboard user — a tap focuses the button in
     Chromium too, and handing that over scrolled the phone's Kanban across to
     the target column after every move. */
  const fromKeyboard = (ev) => ev.detail === 0;
  function toggleMove(ev) {
    focusFirstOpt.current = !moveOpen && fromKeyboard(ev);
    setMoveOpen(!moveOpen);
  }
  function handleMove(toCol, ev) {
    const hadFocus = fromKeyboard(ev) && Boolean(rootRef.current?.contains(document.activeElement));
    setMoveOpen(false);
    onMove(toCol, hadFocus);
  }
  function onMoveKey(ev) {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    setMoveOpen(false);
    moveBtnRef.current?.focus();
  }

  const cls = [
    "kanban-card",
    isDone && "done",
    dragging && "dragging",
    dueLabel === "overdue" && "overdue",
    pending && "pending-delete",
    moveOpen && "move-open",
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={rootRef}
      className={cls}
      data-kanban-key={cardKey(card)}
      draggable={interactive}
      onDragStart={interactive ? onDragStart : undefined}
      onDragEnd={onDragEnd}
    >
      <div className="kanban-card-body" aria-hidden={pending ? "true" : undefined}>
        <div className="summary">{card.summary}</div>
        <div className="meta">
          <span className="tags">
            {tags.map((t) => <span key={t} className={`tag tag-${t}`}>{t}</span>)}
          </span>
          {dueLabel && <span className={`due${dueLabel === "overdue" ? " due-overdue" : ""}`}>due · {dueLabel}</span>}
        </div>
      </div>

      {!pending && !temp && (
        <div className="kanban-card-actions">
          <button
            ref={moveBtnRef}
            type="button"
            className="kanban-card-act kanban-card-move"
            onClick={toggleMove}
            disabled={!canWrite}
            aria-expanded={moveOpen}
            aria-controls={moveOpen ? moveId : undefined}
            aria-label={`Move ${card.summary}`}
            title="Move to…"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
            </svg>
          </button>
          <button
            ref={xRef}
            type="button"
            className="kanban-card-act kanban-card-x"
            onClick={handleDelete}
            disabled={!canWrite}
            aria-label={`Delete ${card.summary}`}
            title="Delete"
          >
            &times;
          </button>
        </div>
      )}

      {/* In flow rather than a popover: .kanban is a scroll container on the
          phone layout and clips anything drawn outside it (the tag menu hit
          exactly that). A taller card is always visible. */}
      {moveOpen && !pending && (
        <div id={moveId} className="kanban-move" role="group" aria-label={`Move ${card.summary} to`} onKeyDown={onMoveKey}>
          <span className="kanban-move-label" aria-hidden="true">Move to</span>
          {/* A target Home Assistant would silently ignore (an unavailable
              list) is shown but disabled, with the reason as its title. */}
          {targets.map((t) => (
            <button
              key={t.id} type="button" className="kanban-move-opt"
              disabled={!canWrite || t.disabled} title={t.disabled ? t.why : undefined}
              onClick={(ev) => handleMove(t.id, ev)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <div className="kanban-card-undo">
          <span>{pending === "sending" ? "Deleting…" : "Deleted"}</span>
          {pending === "undo" && (
            <button ref={undoRef} type="button" className="kanban-undo-btn" onClick={handleUndo} aria-label={`Undo deleting ${card.summary}`}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
