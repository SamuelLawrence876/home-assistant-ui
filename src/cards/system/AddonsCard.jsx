import { useState } from "react";
import { useConnectionStatus, useEntitiesByDomain, useSnapshotReady } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { useArmedConfirm } from "./useArmedConfirm.js";
import { installRunning, prepareNotice, useReconnectNotice } from "./useReconnectNotice.js";

/* Updates whose install takes the house down with it: Core restarts Home
   Assistant (dashboard and automations drop for minutes), OS reboots the Pi,
   Supervisor restarts what runs the add-ons. Each one asks first — the same
   confirm as Restart HA / Reboot Pi next door, which this card used to be a
   one-tap way around — and none of them ride along with "Install all", so a
   reboot can't land in the middle of an add-on update.

   Core and OS end with Home Assistant starting again, so their install call
   expects the disconnect (client.js#callService) — HA drops the WebSocket
   before it answers, which used to log and toast a failure for an install
   that had worked — and their notice checks HA's start time afterwards, so a
   call that never reached HA isn't taken for one that worked. The Supervisor
   restarts only itself: the dashboard stays connected, so its call is an
   ordinary one, and its notice waits for HA to report the entity again
   (useReconnectNotice.js). `notice` is what the row says meanwhile. */
const SYSTEM_UPDATES = {
  "update.home_assistant_core_update": {
    does: "Restarts Home Assistant",
    notice: {
      kind: "restart", logAs: "update.install",
      text: "Restarting Home Assistant… the dashboard will reconnect",
      checkText: "Reconnected — checking Home Assistant restarted…",
      failText: "Home Assistant didn't restart — try again",
      unsureText: "Reconnected, but couldn't confirm Home Assistant restarted",
    },
  },
  "update.home_assistant_operating_system_update": {
    does: "Reboots the Pi",
    notice: {
      kind: "restart", logAs: "update.install",
      text: "Rebooting the Pi… the dashboard will reconnect",
      checkText: "Reconnected — checking the Pi rebooted…",
      failText: "The Pi didn't reboot — try again",
      unsureText: "Reconnected, but couldn't confirm the Pi rebooted",
    },
  },
  "update.home_assistant_supervisor_update": {
    does: "Restarts the Supervisor",
    notice: { kind: "report", text: "Update sent — waiting for the Supervisor to report back" },
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

const OFFLINE = "Not connected to Home Assistant";
// Reconnected, and HA hasn't sent its set again yet.
const RESENDING = "Waiting for Home Assistant to send its updates";

function headline(pending, unreadable, total, loading) {
  if (pending) return `${pending} update${pending > 1 ? "s" : ""} available`;
  if (unreadable) return `${unreadable} can't be checked`;
  return total && !loading ? "All up to date" : "Can't tell yet";
}

/* ----------------------------------------------------------------
   Updates — driven by live `update.*` entities (core, add-ons, HACS, firmware, …)
   ----------------------------------------------------------------*/
export function AddonsCard({ index = 0 }) {
  const updates = useEntitiesByDomain("update");
  const pending = updates.filter((u) => u.state === "on");
  const unreadable = updates.filter((u) => !readable(u));
  const current = updates.length - pending.length - unreadable.length;
  // "✓ current" only when every tracked component said so — never for none,
  // never from the states cached before the socket dropped, and never while
  // HA may still be loading one after a reconnect: a pending update.* left
  // out of a partial set read "✓ current" after every Restart HA. Connected
  // isn't enough for "now", either: until HA's first batch on a new
  // connection the cache is still the pre-drop set, and it read "All up to
  // date ✓ current" while every other card on the tab was a skeleton.
  const connected = useConnectionStatus() === "ready";
  const snapshotReady = useSnapshotReady();
  const live = connected && snapshotReady;
  const loadingCount = live ? updates.loadingIds?.length || 0 : 0;
  const allCurrent = live && updates.length > 0 && current === updates.length && !loadingCount;
  // Not live: everything below is what HA said before, so it is worded as
  // that and nothing in it can be installed — the heading already says it
  // can't tell, and the body used to say "are at the latest version".
  const lastKnown = !live && updates.length > 0;
  const inertWhy = connected ? RESENDING : OFFLINE;
  const bulk = pending.filter((u) => !SYSTEM_UPDATES[u.entity_id]);
  const held = pending.length - bulk.length;
  const [installingId, setInstallingId] = useState(null);
  const [installingAll, setInstallingAll] = useState(false);
  const { armed, request, disarm } = useArmedConfirm();
  // A system row's install that has gone out, and what became of it.
  const notice = useReconnectNotice("updates");
  const bulkInert = installingAll || installingId != null || !live;

  function install(u) {
    setInstallingId(u.entity_id);
    const system = SYSTEM_UPDATES[u.entity_id];
    const begin = system
      ? prepareNotice("updates", u.entity_id, { ...system.notice, entityId: u.entity_id, label: nameOf(u) })
      : null;
    const call =
      system?.notice.kind === "restart"
        ? callService("update", "install", installData(u), undefined, { expectDisconnect: true })
        : callService("update", "install", installData(u));
    // callService records and toasts a failure itself; nothing to add here.
    return call
      .then((res) => begin?.(res))
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
    if (bulkInert) return;
    // One at a time: the card's one-install-in-flight rule (`busy` below), so
    // the row showing "…" is the one actually installing.
    disarm();
    setInstallingAll(true);
    for (const u of bulk) await install(u);
    setInstallingAll(false);
  }

  /* The buttons below are aria-disabled, never disabled, while they can't be
     used: the one you just pressed is the focused one, and a focused button
     that turns disabled drops keyboard focus to the page. */
  return (
    <Card
      index={index}
      eyebrow={`Updates · ${updates.length} tracked`}
      title={live ? headline(pending.length, unreadable.length, updates.length, loadingCount) : "Can't tell yet"}
      meta={pending.length ? "supervisor" : allCurrent ? "✓ current" : undefined}
      headRight={
        bulk.length > 1 && (
          /* Kept short and on one line: "Install all but system" wrapped to
             a three-line pill at 360px. The tooltip carries the why. */
          <button
            className="btn primary updates-btn"
            aria-disabled={bulkInert || undefined}
            onClick={installAll}
            style={{ whiteSpace: "nowrap" }}
            title={!live ? inertWhy : held ? "Installs everything except Core, OS and Supervisor — they restart or reboot, so each installs from its own row" : undefined}
          >
            {installingAll ? "Installing all…" : held ? "Install the rest" : "Install all"}
          </button>
        )
      }
    >
      {lastKnown && (
        <div style={NOTE_STYLE}>
          {`${connected ? "Reconnected, waiting for Home Assistant" : "Not connected"} — showing what Home Assistant last reported.`}
        </div>
      )}
      {pending.length > 0 && (
        <div className="domains" style={{ marginTop: 4 }}>
          {pending.map((u) => {
            const attrs = u.attributes || {};
            const installed = attrs.installed_version || "—";
            const next = attrs.latest_version || "—";
            const consequence = consequenceOf(u);
            const confirming = armed === u.entity_id;
            const said = notice?.key === u.entity_id ? notice : null;
            const running = installingId === u.entity_id || installRunning(attrs) || Boolean(said?.pending);
            // Every row waits while any of ours is running: one install in
            // flight, so a system row's backup never races another install.
            const busy = running || installingAll || installingId != null;
            const inert = busy || !live;
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
                      color: confirming || said?.outcome === "failed" ? "var(--bad)" : "var(--ink-3)",
                      letterSpacing: "0.04em",
                      marginTop: 2,
                    }}
                  >
                    {confirming ? (
                      `${consequence} — confirm to install`
                    ) : said ? (
                      said.message
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
                  className="btn updates-btn"
                  aria-disabled={inert || undefined}
                  aria-label={running ? `Installing ${nameOf(u)}` : undefined}
                  onClick={() => !inert && pressInstall(u)}
                  title={!live ? inertWhy : consequence}
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
        <div style={NOTE_STYLE}>
          {`${lastKnown ? "Couldn't" : "Can't"} be checked: ${unreadable.map(nameOf).join(", ")}`}
        </div>
      )}
      {pending.length === 0 && (unreadable.length === 0 || current > 0) && (
        <div style={NOTE_STYLE}>
          {!updates.length
            ? "Waiting for update entities…"
            : unreadable.length
              ? `The other ${current} ${current === 1 ? (lastKnown ? "was" : "is") : lastKnown ? "were" : "are"} at the latest version.`
              : loadingCount // not "All": HA hasn't sent every one yet (the note below)
                ? `${current} tracked component${current === 1 ? " is" : "s are"} at the latest version.`
                : `All ${updates.length} tracked components ${lastKnown ? "were" : "are"} at the latest version.`}
        </div>
      )}
      {loadingCount > 0 && updates.length > 0 && (
        <div style={NOTE_STYLE}>{`Waiting for ${loadingCount} more from Home Assistant…`}</div>
      )}
      {/* The row's sentence, announced: always in the DOM, because a live
          region that appears together with its text is often not read. */}
      <p className="visually-hidden" role="status">
        {notice ? `${notice.label}: ${notice.message}` : ""}
      </p>
    </Card>
  );
}

/* ================================================================
   MEDIA tab
   ================================================================*/
