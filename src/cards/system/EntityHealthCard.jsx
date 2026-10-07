import { useState, useEffect, useMemo } from "react";
import { useConnectionStatus, useEntityCounts, useSnapshotReady } from "../../ha/useEntity.js";
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
    // Deliberately keyed on `tick` rather than on the entity map itself: the map
    // is mutated in place by the socket layer, so it is never a new reference to
    // depend on. `tick` is the invalidation signal.
  }, [tick, connStatus]);

  /* Right after a reconnect, before HA's first batch, the cache is the
     pre-drop set; after it, entities HA hasn't re-sent yet are left out until
     they arrive (or 5 minutes pass). Counting either as the registry made a
     restart look like "All entities available" — and a device that was
     unavailable before it simply dropped off the list. */
  const snapshot = useSnapshotReady();
  const { loading: waiting = 0 } = useEntityCounts();
  const loading = connStatus !== "ready" || !snapshot;
  const waitNote = `Waiting for ${waiting} more ${waiting === 1 ? "entity" : "entities"} from Home Assistant…`;

  return (
    <Card
      index={index}
      eyebrow={`Entity registry · ${available} online · ${unavailable} unavailable${waiting ? ` · ${waiting} loading` : ""}`}
      title="Unavailable groups"
    >
      {loading ? (
        <div className="entity-loading" />
      ) : unavailable === 0 ? (
        <div className="health-all-good">{waiting ? waitNote : "All entities available"}</div>
      ) : (
        <div className="health-groups">
          {waiting > 0 && <div className="health-all-good">{waitNote}</div>}
          {groups.map(([domain, entities]) => (
            <div key={domain} className="health-group">
              <button
                type="button"
                className={`health-group-header ${expanded === domain ? "open" : ""}`}
                onClick={() => setExpanded(expanded === domain ? null : domain)}
                aria-expanded={expanded === domain}
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
