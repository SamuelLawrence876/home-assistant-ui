import { Card } from "../components/Card.jsx";

/* ----------------------------------------------------------------
   At-a-glance stat boxes (used on Overview)
   ----------------------------------------------------------------*/
export function StatBox({ index = 0, eyebrow, value, unit, caption, pct, color }) {
  return (
    <Card index={index} className="statbox">
      <div className="eyebrow">{eyebrow}</div>
      <div className="v">
        {value}
        {unit && <span className="u">{unit}</span>}
      </div>
      <div className="cap">{caption}</div>
      {pct !== undefined && (
        <div className="progress-mini">
          <span style={{ "--p": `${pct}%`, "--c": color || "var(--accent)" }} />
        </div>
      )}
    </Card>
  );
}
