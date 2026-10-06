import { useState } from "react";
import { useConnectionStatus, useEntitiesByDomain } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { useArmedConfirm } from "./useArmedConfirm.js";
import { useReconnectNotice } from "./useReconnectNotice.js";

/* Updates whose install takes the house down with it: Core restarts Home
   Assistant (dashboard and automations drop for minutes), OS reboots the Pi,
   Supervisor restarts what runs the add-ons. Each one asks first — the same
   confirm as Restart HA / Reboot Pi next door, which this card used to be a
   one-tap way around — and none of them ride along with "Install all", so a
   reboot can't land in the middle of an add-on update.

   Their install call expects the disconnect (client.js#callService): HA
   drops the WebSocket before it answers, which used to log and toast a
   failure for an install that had worked. `after` is what the row says once
   the call has gone out, until the dashboard is back. */
const SYSTEM_UPDATES = {
  "update.home_assistant_core_update": {
    does: "Restarts Home Assistant",
    after: "Restarting Home Assistant… the dashboard will reconnect",
  },
  "update.home_assistant_operating_system_update": {
    does: "Reboots the Pi",
    after: "Rebooting the Pi… the dashboard will reconnect",
  },
  "update.home_assistant_supervisor_update": {
    does: "Restarts the Supervisor",
    after: "Restarting the Supervisor…",
  },
};

/* An update entity answers "on" (an update is waiting) or "off" (current).
   Anything else — unavailable, unknown — is a component nobody could check,
   and it used to be counted as current: with the Supervisor down, every row
   went unavailable and the card said "All up to date ✓ current". */
const readable = (u) => u.state === "on" || u.state === "off";

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
  const c = SYSTEM_UPDATES[u.entity_id]?.does;
  if (!c) return undefined;
  return backsUp(u) ? `Backs up, then ${c[0].toLowerCase()}${c.slice(1)}` : c;
}

const nameOf = (u) => u.attributes?.title || u.attributes?.friendly_name || u.entity_id;

const NOTE_STYLE = {
  color: "var(--ink-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.04em",
  padding: "8px 0",
};

function headline(pending, unreadable, total) {
  if (pending) return `${pending} update${pending > 1 ? "s" : ""} available`;
  if (unreadable) return `${unreadable} can't be checked`;
  return total ? "All up to date" : "Can't tell yet";
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
  const unreadable = updates.filter((u) => !readable(u));
  const current = updates.length - pending.length - unreadable.length;
  // "✓ current" only when every tracked component said so — never for none,
  // and never from the states cached before the socket dropped.
  const live = useConnectionStatus() === "ready";
  const allCurrent = live && updates.length > 0 && current === updates.length;
  const bulk = pending.filter((u) => !SYSTEM_UPDATES[u.entity_id]);
  const held = pending.length - bulk.length;
  const [installingId, setInstallingId] = useState(null);
  const [installingAll, setInstallingAll] = useState(false);
  const { armed, request, disarm } = useArmedConfirm();
  // The system row whose install has gone out, until the dashboard is back.
  const [restarting, setRestarting] = useReconnectNotice();

  function install(u) {
    setInstallingId(u.entity_id);
    const system = SYSTEM_UPDATES[u.entity_id];
    const call = system
      ? callService("update", "install", installData(u), undefined, { expectDisconnect: true })
      : callService("update", "install", installData(u));
    // callService records and toasts a failure itself; nothing to add here.
    return call
      .then(() => {
        if (system) setRestarting(u.entity_id);
      })
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
      title={live ? headline(pending.length, unreadable.length, updates.length) : "Can't tell yet"}
      meta={pending.length ? "supervisor" : allCurrent ? "✓ current" : undefined}
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
      {pending.length > 0 && (
        <div className="domains" style={{ marginTop: 4 }}>
          {pending.map((u) => {
            const attrs = u.attributes || {};
            const installed = attrs.installed_version || "—";
            const next = attrs.latest_version || "—";
            const consequence = consequenceOf(u);
            const confirming = armed === u.entity_id;
            const gone = restarting === u.entity_id;
            const running = installingId === u.entity_id || inProgress(attrs) || gone;
            // Every row waits while any of ours is running: one install in
            // flight, so a system row's backup never races another install.
            const busy = running || installingAll || installingId != null;
            return (
              <div key={u.entity_id} className="domain" style={{ gridTemplateColumns: "1fr auto auto", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
                    {nameOf(u)}
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
                    ) : gone ? (
                      SYSTEM_UPDATES[u.entity_id].after
                    ) : (
                      <>
                        <span style={{ color: "var(--ink-4)" }}>{installed}</span>
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
      {/* Named, not folded into "current" or dropped from the list. */}
      {unreadable.length > 0 && (
        <div style={NOTE_STYLE}>{`Can't be checked: ${unreadable.map(nameOf).join(", ")}`}</div>
      )}
      {pending.length === 0 && (unreadable.length === 0 || current > 0) && (
        <div style={NOTE_STYLE}>
          {!updates.length
            ? "Waiting for update entities…"
            : unreadable.length
              ? `The other ${current} ${current === 1 ? "is" : "are"} at the latest version.`
              : `All ${updates.length} tracked components are at the latest version.`}
        </div>
      )}
    </Card>
  );
}

/* ================================================================
   MEDIA tab
   ================================================================*/
