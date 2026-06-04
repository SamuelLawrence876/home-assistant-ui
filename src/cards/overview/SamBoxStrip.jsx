import { useState, useEffect, useRef } from "react";
import { GH_DATA } from "../../data.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   SamBox360 — game console on a smart plug. Power-only control.
   On/off only; "Turning on…" is a transient the UI owns while the plug
   restores + the box cold-boots. From the glasshouse-v2 stream-options design.
   ----------------------------------------------------------------*/
const GAMING_ENTITY = "switch.sambox360_plug";

export function SamBoxStrip({ compact = false }) {
  const g = GH_DATA.gaming;
  const [status, setStatus] = useState(g.status); // "off" | "turning_on" | "on"
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function setOn() {
    setStatus("turning_on");
    callService("switch", "turn_on", { entity_id: GAMING_ENTITY }).catch(() => {});
    timer.current = setTimeout(() => setStatus("on"), 2200);
  }
  function setOff() {
    clearTimeout(timer.current);
    setStatus("off");
    callService("switch", "turn_off", { entity_id: GAMING_ENTITY }).catch(() => {});
  }

  const on = status === "on";
  const turning = status === "turning_on";
  const statusLabel = on ? "On" : turning ? "Turning on…" : "Off";
  const statusColor = on ? "var(--good)" : turning ? "var(--accent-2)" : "var(--ink-4)";

  return (
    <div className={`sambox ${compact ? "sambox-compact" : ""}`}>
      <div className="sambox-main">
        <div className="sambox-id">
          <div className="sambox-badge" data-on={on}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 11h4M8 9v4" strokeLinecap="round" />
              <circle cx="15.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="17.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
              <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
            </svg>
          </div>
          <div className="sambox-meta">
            <div className="sambox-name">{g.name}</div>
            <div className="sambox-out">{g.output}</div>
          </div>
        </div>

        <div className="sambox-control">
          <div className="sambox-status" style={{ color: statusColor }}>
            <span className="sambox-dot" style={{ background: statusColor }} data-pulse={turning} />
            {statusLabel}
          </div>
          <button
            className="sambox-switch"
            role="switch"
            aria-checked={on}
            data-on={on}
            data-turning={turning}
            onClick={on || turning ? setOff : setOn}
          >
            <span className="sambox-knob" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Media tab: SamBox360 control as a full card row.
export function SamBoxCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Gaming" title="SamBox360" meta="Smart plug">
      <SamBoxStrip />
    </Card>
  );
}

// Overview: the compact "Play strip" pinned at the foot.
