/* Service error toast — frosted glass beacon, bottom of the stack.
   Presentational only: it takes a { id, label, detail } list and a dismiss
   callback. The onServiceError subscription that fills that list lives in
   App.jsx, because components/ must stay entity-agnostic (CLAUDE.md: no
   ha/ or data.js imports in here). */
import { useState, useEffect, useCallback } from "react";

const TOAST_DURATION = 6000;

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 420);
  }, [toast.id, onDismiss]);
  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <div className={`toast-item ${exiting ? "toast-exit" : ""}`}>
      <div className="toast-glow" />
      <div className="toast-edge" />
      <div className="toast-icon-col">
        <div className="toast-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      </div>
      <div className="toast-body">
        <div className="toast-label">{toast.label}</div>
        <div className="toast-detail">{toast.detail}</div>
      </div>
      <button className="toast-close" onClick={dismiss} aria-label={`Dismiss error: ${toast.label}`}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
      <div className="toast-timer">
        <div className="toast-timer-bar" style={{ animationDuration: `${TOAST_DURATION}ms` }} />
      </div>
    </div>
  );
}

export function ServiceErrorToast({ toasts = [], onDismiss }) {
  // The stack is always mounted, even with nothing in it: a live region that
  // arrives in the same DOM mutation as its first message is not announced —
  // screen readers only report changes to a region already in the tree. It is
  // `pointer-events: none` (toast.css) and collapses to nothing when empty.
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
