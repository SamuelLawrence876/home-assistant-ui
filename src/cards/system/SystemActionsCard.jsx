import { useState } from "react";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { useArmedConfirm } from "./useArmedConfirm.js";
import { useReconnectNotice } from "./useReconnectNotice.js";

/* Restart HA and Reboot Pi take the WebSocket down before HA answers, so
   their calls expect the disconnect (client.js#callService) — a dropped
   connection there means "sent", not "failed" — and `after` is what the card
   says once one has gone out, until the dashboard is back. */
const EXPECT_DROP = { expectDisconnect: true };
const SYSTEM_ACTIONS = [
  { id: "restart_ha", label: "Restart HA", icon: "↻", desc: "homeassistant.restart", confirm: true,
    after: "Restarting… the dashboard will reconnect.",
    run: () => callService("homeassistant", "restart", {}, undefined, EXPECT_DROP) },
  { id: "reboot_host", label: "Reboot Pi", icon: "⏻", desc: "hassio.host_reboot", confirm: true,
    after: "Rebooting… the dashboard will reconnect.",
    run: () => callService("hassio", "host_reboot", {}, undefined, EXPECT_DROP) },
  { id: "reload_auto", label: "Reload Automations", icon: "⟲", desc: "automation.reload",
    run: () => callService("automation", "reload") },
  { id: "reload_scripts", label: "Reload Scripts", icon: "⟲", desc: "script.reload",
    run: () => callService("script", "reload") },
];

export function SystemActionsCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  // A double-click can't arm-and-fire, and an armed tile disarms itself —
  // see useArmedConfirm.js for why each guard exists.
  const { armed: confirm, request, disarm } = useArmedConfirm();
  const [notice, setNotice] = useReconnectNotice();

  async function exec(action) {
    if (action.confirm) {
      if (!request(action.id)) return;
    } else {
      disarm();
    }
    setFiring(action.id);
    try {
      await action.run();
      if (action.after) setNotice(action.after);
    } catch (e) {
      console.warn("[system-action] failed", action.id, e);
    }
    setTimeout(() => setFiring(null), 2000);
  }

  return (
    <Card index={index} eyebrow="System · actions" title="Quick actions" meta={firing ? `Running…` : ""}>
      <div className="sys-actions-grid">
        {SYSTEM_ACTIONS.map((a) => (
          <button
            key={a.id}
            className={`sys-action ${firing === a.id ? "firing" : ""} ${confirm === a.id ? "confirming" : ""} ${a.id}`}
            onClick={() => exec(a)}
            disabled={!!firing}
          >
            <div className="sys-action-ic">{a.icon}</div>
            <div>
              <div className="sys-action-nm">
                {confirm === a.id ? "Confirm?" : a.label}
              </div>
              <div className="sys-action-sub">{a.desc}</div>
            </div>
          </button>
        ))}
      </div>
      {confirm && (
        <button className="sys-action-cancel" onClick={disarm}>
          Cancel
        </button>
      )}
      {/* Always in the DOM, empty (and zero-height) until there is something
          to say: a live region that appears together with its text is often
          not announced. */}
      <p className="sys-action-note" role="status">
        {notice}
      </p>
    </Card>
  );
}
