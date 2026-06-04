import { useState, useEffect, useMemo } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";
import { getAllStates, onStatesChanged } from "../../ha/socket.js";
import { Card } from "../../components/Card.jsx";

export function EntityHealthCard({ index = 0 }) {
  const connStatus = useConnectionStatus();
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(null);
  useEffect(() => onStatesChanged(() => setTick((t) => t + 1)), []);

  const { groups, available, unavailable } = useMemo(() => {
    const all = getAllStates();
    let avail = 0;
    let unavail = 0;
    const byDomain = {};
    for (const s of all) {
      const bad = s.state === "unavailable" || s.state === "unknown";
      if (bad) {
        unavail++;
        const domain = s.entity_id.split(".")[0];
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(s);
      } else {
        avail++;
      }
    }
    const sorted = Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length);
    return { groups: sorted, available: avail, unavailable: unavail };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, connStatus]);

  const loading = connStatus !== "ready";

  return (
    <Card
      index={index}
      eyebrow={`Entity registry · ${available} online · ${unavailable} unavailable`}
      title="Unavailable groups"
    >
      {loading ? (
        <div className="entity-loading" />
      ) : unavailable === 0 ? (
        <div className="health-all-good">All entities available</div>
      ) : (
        <div className="health-groups">
          {groups.map(([domain, entities]) => (
            <div key={domain} className="health-group">
              <button
                className={`health-group-header ${expanded === domain ? "open" : ""}`}
                onClick={() => setExpanded(expanded === domain ? null : domain)}
              >
                <span className="health-domain">{domain}</span>
                <span className="health-count">{entities.length}</span>
                <span className="health-chevron">{expanded === domain ? "−" : "+"}</span>
              </button>
              {expanded === domain && (
                <ul className="health-entities">
                  {entities.map((e) => (
                    <li key={e.entity_id}>
                      <span className="health-eid">{e.entity_id}</span>
                      <span className={`health-state ${e.state}`}>{e.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
