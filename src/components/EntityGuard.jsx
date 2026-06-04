/* ----------------------------------------------------------------
   Entity guard — loading / not-found / unavailable overlays
   ----------------------------------------------------------------*/
export function EntityGuard({ status, entityId, children, style }) {
  if (status === "loading") {
    return <div className="entity-loading" style={style} />;
  }
  if (status === "not_found" || status === "unavailable") {
    const label =
      status === "not_found"
        ? entityId ? `${entityId} not found` : "Entity not found"
        : entityId ? `${entityId} unavailable` : "Unavailable";
    // No children to show as a placeholder — fall back to the centered warning block.
    if (!children) {
      return (
        <div className="entity-warning" style={style}>
          <span className="entity-warning-icon">{"⚠️"}</span>
          <span className="entity-warning-text">{label}</span>
        </div>
      );
    }
    // Render the card as-is (mock/fallback values) with a warning badge pinned
    // to the card's top-right corner. `.card` is position:relative, so the
    // badge anchors there without disturbing the card layout.
    return (
      <>
        {children}
        <span className="entity-warning-badge" title={label} aria-label={label} role="img">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
      </>
    );
  }
  return children;
}
