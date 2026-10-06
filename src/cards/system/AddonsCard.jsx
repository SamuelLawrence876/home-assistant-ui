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

/* UpdateEntityFeature.BACKUP. A backup is asked for only on the system rows —
   the installs behind a confirm, where a bad update costs the whole house —
   and the confirm says so. Routine installs (add-ons, HACS, firmware) don't
   take one: that would make every install slower and let a failed backup
   abort it, a policy change nobody asked for. HA rejects backup: true for an
   entity that doesn't declare the feature, so it is only asked for where the
   entity says it works. Exported for tests. */
const FEATURE_BACKUP = 8;
const backsUp = (u) =>
  Boolean(SYSTEM_UPDATES[u.entity_id]) && (Number(u.attributes?.supported_features) & FEATURE_BACKUP) !== 0;
export function installData(u) {
  return backsUp(u) ? { entity_id: u.entity_id, backup: true } : { entity_id: u.entity_id };
}

/* What a system row's install does, for its confirm line and tooltip. */
function consequenceOf(u) {
  const c = SYSTEM_UPDATES[u.entity_id];
  if (!c) return undefined;
  return backsUp(u) ? `Backs up, then ${c[0].toLowerCase()}${c.slice(1)}` : c;
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
  const { armed, request, disarm } = useArmedConfirm();

  function install(u) {
    setInstallingId(u.entity_id);
    // callService records and toasts a failure itself; nothing to add here.
    return callService("update", "install", installData(u))
      .catch(() => {})
      .finally(() => setInstallingId(null));
  }
  function pressInstall(u) {
    if (SYSTEM_UPDATES[u.entity_id] && !request(u.entity_id)) return;
    // Doing anything else drops a pending confirm: an armed Core row used to
    // sit out another row's install and come back still one press from firing.
    disarm();
    install(u);
  }
  async function installAll() {
    // One at a time: the card's one-install-in-flight rule (`busy` below), so
    // the row showing "…" is the one actually installing.
    disarm();
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
          /* Kept short and on one line: "Install all but system" wrapped to
             a three-line pill at 360px. The tooltip carries the why. */
          <button
            className="btn primary"
            disabled={installingAll || installingId != null}
            onClick={installAll}
            style={{ whiteSpace: "nowrap" }}
            title={held ? "Installs everything except Core, OS and Supervisor — they restart or reboot, so each installs from its own row" : undefined}
          >
            {installingAll ? "Installing all…" : held ? "Install the rest" : "Install all"}
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
            const consequence = consequenceOf(u);
            const confirming = armed === u.entity_id;
            const running = installingId === u.entity_id || inProgress(attrs);
            // Every row waits while any of ours is running: one install in
            // flight, so a system row's backup never races another install.
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
