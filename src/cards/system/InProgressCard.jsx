import { useState, useEffect } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { getTodoItems } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

export function InProgressCard({ index = 0 }) {
  const { entity: live, status } = useEntityStatus("todo.doing_2");
  const [items, setItems] = useState([]);
  const count = Number(live?.state ?? 0);
  useEffect(() => {
    if (!live) return;
    getTodoItems("todo.doing_2")
      .then((list) => {
        if (Array.isArray(list)) setItems(list.map((x) => x.summary || x.uid));
      })
      .catch(() => {});
  }, [live?.state]);
  return (
    <Card index={index} eyebrow={`In Progress · ${count} items`} title="Doing now">
      <EntityGuard status={status} entityId="todo.doing_2">
      <ul className="shopping">
        {items.slice(0, 6).map((it, i) => (
          <li key={i}>{it}</li>
        ))}
        {items.length > 6 && (
          <li style={{ color: "var(--ink-3)", borderBottom: 0 }}>… and {items.length - 6} more</li>
        )}
      </ul>
      </EntityGuard>
    </Card>
  );
}
