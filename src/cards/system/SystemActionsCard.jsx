import { useState } from "react";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

const SYSTEM_ACTIONS = [
  { id: "restart_ha", label: "Restart HA", icon: "↻", desc: "homeassistant.restart", confirm: true,
    run: () => callService("homeassistant", "restart") },
  { id: "reboot_host", label: "Reboot Pi", icon: "⏻", desc: "hassio.host_reboot", confirm: true,
    run: () => callService("hassio", "host_reboot") },
  { id: "reload_auto", label: "Reload Automations", icon: "⟲", desc: "automation.reload",
    run: () => callService("automation", "reload") },
  { id: "reload_scripts", label: "Reload Scripts", icon: "⟲", desc: "script.reload",
    run: () => callService("script", "reload") },
];

export function SystemActionsCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function exec(action) {
    if (action.confirm && confirm !== action.id) {
      setConfirm(action.id);
      return;
    }
    setConfirm(null);
    setFiring(action.id);
    try {
      await action.run();
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
        <button className="sys-action-cancel" onClick={() => setConfirm(null)}>
          Cancel
        </button>
      )}
    </Card>
  );
}
