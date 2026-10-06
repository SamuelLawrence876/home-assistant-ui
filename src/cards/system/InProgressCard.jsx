import { useState, useEffect } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { getTodoItems } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);

const noteStyle = {
  color: "var(--ink-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.04em",
  padding: "8px 0",
};

export function InProgressCard({ index = 0 }) {
  const { entity: live, status } = useEntityStatus("todo.doing_2");
  // null = not read yet, [] = read and empty. `failed` replaces the list
  // rather than leaving the previous one on screen as if it were current.
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const count = numOr(live?.state, null);
  // An unavailable list has no items to read; it says so instead of "nothing".
  const unreadable = status === "unavailable" || status === "not_found";
  useEffect(() => {
    if (!live || count == null) return undefined;
    let stale = false;
    // needs_action only: with no status HA returns completed items too, and
    // this list is the Kanban "In Progress" column — every card dragged to
    // Done stays in it as a completed item.
    getTodoItems("todo.doing_2", "needs_action")
      .then((list) => {
        if (stale) return;
        setItems(Array.isArray(list) ? list.map((x) => x.summary || x.uid) : []);
        setFailed(false);
      })
      .catch(() => {
        if (stale) return;
        setItems(null);
        setFailed(true);
      });
    // A refetch started by a newer count wins over a slower older one.
    return () => {
      stale = true;
    };
  }, [live?.state]);
  return (
    <Card index={index} eyebrow={`In Progress · ${count ?? "—"} items`} title="Doing now">
      <EntityGuard status={status} entityId="todo.doing_2">
      {failed || unreadable ? (
        <div style={noteStyle}>Couldn’t read this list.</div>
      ) : items && items.length === 0 ? (
        <div style={noteStyle}>Nothing in progress.</div>
      ) : (
        <ul className="shopping">
          {(items || []).slice(0, 6).map((it, i) => (
            <li key={i}>{it}</li>
          ))}
          {items && items.length > 6 && (
            <li style={{ color: "var(--ink-3)", borderBottom: 0 }}>… and {items.length - 6} more</li>
          )}
        </ul>
      )}
      </EntityGuard>
    </Card>
  );
}
