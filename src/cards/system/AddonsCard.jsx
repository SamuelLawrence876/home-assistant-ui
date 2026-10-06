import { useState } from "react";
import { useEntitiesByDomain } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { useArmedConfirm } from "./useArmedConfirm.js";

/* Updates whose install takes the house down with it: Core restarts Home
   Assistant (dashboard and automations drop for minutes), OS reboots the Pi,
   Supervisor restarts what runs the add-ons. Each one asks first — the same
   confirm as Restart HA / Reboot Pi next door, which this card used to be a
   one-tap way around — and none of them ride along with "Install all", so a
   reboot can't land in the middle of an add-on update. */
const SYSTEM_UPDATES = {
  "update.home_assistant_core_update": "Restarts Home Assistant",
  "update.home_assistant_operating_system_update": "Reboots the Pi",
  "update.home_assistant_supervisor_update": "Restarts the Supervisor",
};

/* UpdateEntityFeature.BACKUP. HA rejects backup: true for an entity that
   doesn't declare it, so it is only asked for where the entity says it works.
   Exported for tests. */
const FEATURE_BACKUP = 8;
export function installData(u) {
  const data = { entity_id: u.entity_id };
  if ((Number(u.attributes?.supported_features) & FEATURE_BACKUP) !== 0) data.backup = true;
  return data;
}

/* An install HA says is already running — started from another device, or
   one whose call outlived this page. Older HA sent a percentage here. */
const inProgress = (attrs) => attrs.in_progress === true || typeof attrs.in_progress === "number";

/* ----------------------------------------------------------------
   Updates — driven by live `update.*` entities (core, add-ons, HACS, firmware, …)
   ----------------------------------------------------------------*/
export function AddonsCard({ index = 0 }) {
  const updates = useEntitiesByDomain("update");
  const pending = updates.filter((u) => u.state === "on");
  const bulk = pending.filter((u) => !SYSTEM_UPDATES[u.entity_id]);
  const held = pending.length - bulk.length;
  const [installingId, setInstallingId] = useState(null);
  const [installingAll, setInstallingAll] = useState(false);
  const { armed, request } = useArmedConfirm();

  function install(u) {
    setInstallingId(u.entity_id);
    // callService records and toasts a failure itself; nothing to add here.
    return callService("update", "install", installData(u))
      .catch(() => {})
      .finally(() => setInstallingId(null));
  }
  function pressInstall(u) {
    if (SYSTEM_UPDATES[u.entity_id] && !request(u.entity_id)) return;
    install(u);
  }
  async function installAll() {
    // One at a time. HA's backup manager refuses a second backup while one is
    // running, so parallel installs that each ask for one fail all but the first.
    setInstallingAll(true);
    for (const u of bulk) await install(u);
    setInstallingAll(false);
  }

  return (
    <Card
      index={index}
      eyebrow={`Updates · ${updates.length} tracked`}
      title={pending.length ? `${pending.length} update${pending.length > 1 ? "s" : ""} available` : "All up to date"}
      meta={pending.length ? "supervisor" : "✓ current"}
      headRight={
        bulk.length > 1 && (
          <button
            className="btn primary"
            disabled={installingAll || installingId != null}
            onClick={installAll}
            title={held ? "Core, OS and Supervisor restart or reboot, so they install one at a time from their own row" : undefined}
          >
            {installingAll ? "Installing all…" : held ? "Install all but system" : "Install all"}
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
            const consequence = SYSTEM_UPDATES[u.entity_id];
            const confirming = armed === u.entity_id;
            const running = installingId === u.entity_id || inProgress(attrs);
            // Every row waits while any of ours is running, for the same
            // one-backup-at-a-time reason as Install all.
            const busy = running || installingAll || installingId != null;
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
                      color: confirming ? "var(--bad)" : "var(--ink-3)",
                      letterSpacing: "0.04em",
                      marginTop: 2,
                    }}
                  >
                    {confirming ? (
                      `${consequence} — confirm to install`
                    ) : (
                      <>
                        <span style={{ color: "var(--ink-4)" }}>{current}</span>
                        {" → "}
                        <span style={{ color: "var(--good)" }}>{next}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => pressInstall(u)}
                  title={consequence}
                >
                  {running ? "…" : confirming ? "Confirm" : "Install"}
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
