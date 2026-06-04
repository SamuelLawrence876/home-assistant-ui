/* Service error toast — frosted glass beacon, bottom of the stack.
   Subscribes to onServiceError from the HA client; shows the last 5. */
import { useState, useEffect, useCallback } from "react";
import { onServiceError } from "../ha/client.js";

let toastIdCounter = 0;
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
      <button className="toast-close" onClick={dismiss} aria-label="Dismiss">
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

export function ServiceErrorToast() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  useEffect(() => {
    return onServiceError(({ domain, service, data, error }) => {
      const entityId = data?.entity_id || "";
      const errMsg = error?.message || String(error);
      const shortErr = errMsg.length > 120 ? errMsg.slice(0, 120) + "…" : errMsg;
      const label = entityId
        ? `${domain}.${service} on ${entityId}`
        : `${domain}.${service}`;
      const id = ++toastIdCounter;
      setToasts((t) => [...t.slice(-4), { id, label, detail: shortErr }]);
    });
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
