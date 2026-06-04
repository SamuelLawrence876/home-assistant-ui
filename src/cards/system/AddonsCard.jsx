import { useState } from "react";
import { useEntitiesByDomain } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Updates — driven by live `update.*` entities (core, add-ons, HACS, firmware, …)
   ----------------------------------------------------------------*/
export function AddonsCard({ index = 0 }) {
  const updates = useEntitiesByDomain("update");
  const pending = updates.filter((u) => u.state === "on");
  const [installingId, setInstallingId] = useState(null);
  const [installingAll, setInstallingAll] = useState(false);

  function installOne(entityId) {
    setInstallingId(entityId);
    callService("update", "install", { entity_id: entityId })
      .catch(() => {})
      .finally(() => setInstallingId(null));
  }
  function installAll() {
    setInstallingAll(true);
    Promise.allSettled(
      pending.map((u) => callService("update", "install", { entity_id: u.entity_id })),
    ).finally(() => setInstallingAll(false));
  }

  return (
    <Card
      index={index}
      eyebrow={`Updates · ${updates.length} tracked`}
      title={pending.length ? `${pending.length} update${pending.length > 1 ? "s" : ""} available` : "All up to date"}
      meta={pending.length ? "supervisor" : "✓ current"}
      headRight={
        pending.length > 1 && (
          <button className="btn primary" disabled={installingAll} onClick={installAll}>
            {installingAll ? "Installing all…" : "Install all"}
          </button>
        )
      }
    >
      {pending.length === 0 ? (
        <div
          style={{
            color: "var(--ink-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            padding: "8px 0",
          }}
        >
          {updates.length
            ? `All ${updates.length} tracked components are at the latest version.`
            : "Waiting for update entities…"}
        </div>
      ) : (
        <div className="domains" style={{ marginTop: 4 }}>
          {pending.map((u) => {
            const attrs = u.attributes || {};
            const name = attrs.title || attrs.friendly_name || u.entity_id;
            const current = attrs.installed_version || "—";
            const next = attrs.latest_version || "—";
            const busy = installingId === u.entity_id || installingAll;
            return (
              <div key={u.entity_id} className="domain" style={{ gridTemplateColumns: "1fr auto auto", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
                    {name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      marginTop: 2,
                    }}
                  >
                    <span style={{ color: "var(--ink-4)" }}>{current}</span>
                    {" → "}
                    <span style={{ color: "var(--good)" }}>{next}</span>
                  </div>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => installOne(u.entity_id)}
                >
                  {installingId === u.entity_id ? "…" : "Install"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ================================================================
   MEDIA tab
   ================================================================*/
