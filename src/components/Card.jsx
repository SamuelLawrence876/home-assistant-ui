/* ----------------------------------------------------------------
   Reusable Card shell
   ----------------------------------------------------------------*/
export function Card({ index = 0, className = "", children, eyebrow, title, meta, badge, headRight, style }) {
  return (
    <section className={`card ${className}`} style={{ ...style, "--i": index }}>
      {(eyebrow || title || meta || headRight || badge) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {/* A real heading, so a screen reader can jump card to card
                instead of walking the whole tab. h2 because App.jsx's
                wordmark is the page's h1. The tag's own margin and weight
                are cancelled in a11y.css — this renders identically to the
                <div> it replaced. */}
            {title && <h2 className="title">{title}</h2>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {badge && <span className="card-badge">{badge}</span>}
            {meta && <span className="meta">{meta}</span>}
            {headRight}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}
