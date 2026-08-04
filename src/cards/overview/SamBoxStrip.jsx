import { useState, useEffect, useRef } from "react";
import { GH_DATA } from "../../data.js";
import { callService } from "../../ha/client.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   SamBox360 — game console (Pi 5 Moonlight client) on a smart plug.
   Power-only control. On/off only; "Turning on…" is a transient the
   UI owns while the plug restores power + the Pi cold-boots into
   Moonlight. Live once `switch.sambox360_plug` exists in HA; falls
   back to the GH_DATA mock before the WS arrives (and in the
   mock-mode visual-verify harness, where status never reaches "ready").
   ----------------------------------------------------------------*/
const PLUG_ENTITY = "switch.sambox360_plug";
const SESSION_ENTITY = "sensor.sambox360_status"; // optional: Pi-reported play state (stretch)
const BOOT_MS = 2200; // cold-boot transient while the plug restores + the Pi wakes

export function SamBoxStrip({ compact = false }) {
  const g = GH_DATA.gaming;
  const { entity: plug, status: plugStatus } = useEntityStatus(PLUG_ENTITY);
  const { entity: session } = useEntityStatus(SESSION_ENTITY);

  // Prefer live plug state once the WS has a real entity; otherwise fall back
  // to the mock so the card renders cleanly pre-connect and in the harness.
  const livePlug = plugStatus === "ready" ? plug : null;
  const plugOn = livePlug ? livePlug.state === "on" : g.status === "on";

  const [on, setOnLocal] = useState(plugOn);
  const [turning, setTurning] = useState(g.status === "turning_on");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Re-sync to live plug state on every change (canonical pattern). A real
  // "off" from HA cancels any in-flight boot transient.
  useEffect(() => {
    if (!livePlug) return;
    const isOn = livePlug.state === "on";
    setOnLocal(isOn);
    if (!isOn) {
      clearTimeout(timer.current);
      setTurning(false);
    }
  }, [livePlug?.state]);

  // Revert from the plug's latest known state, not the one captured at click
  // time — the resync effect above only fires on a *changed* state string.
  const plugOnRef = useRef(plugOn);
  plugOnRef.current = plugOn;

  function powerOn() {
    setOnLocal(true);
    setTurning(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTurning(false), BOOT_MS);
    callService("switch", "turn_on", { entity_id: PLUG_ENTITY }).catch(() => {
      clearTimeout(timer.current);
      setTurning(false);
      setOnLocal(plugOnRef.current); // revert to last-known state on failure
    });
  }
  function powerOff() {
    clearTimeout(timer.current);
    setTurning(false);
    setOnLocal(false);
    callService("switch", "turn_off", { entity_id: PLUG_ENTITY }).catch(() => setOnLocal(plugOnRef.current));
  }

  // Richer "Streaming" label once the Pi reports a session sensor; ignored until it exists.
  const streaming = session?.state === "streaming" || session?.state === "playing";

  const displayOn = on || streaming;
  const statusLabel = turning ? "Turning on…" : streaming ? "Streaming" : on ? "On" : "Off";
  const statusColor = turning
    ? "var(--accent-2)"
    : displayOn
      ? "var(--good)"
      : "var(--ink-4)";

  return (
    <div className={`sambox ${compact ? "sambox-compact" : ""}`}>
      <div className="sambox-main">
        <div className="sambox-id">
          <div className="sambox-badge" data-on={displayOn}>
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
            type="button"
            className="sambox-switch"
            role="switch"
            aria-checked={displayOn}
            aria-label="SamBox360 power"
            data-on={displayOn}
            data-turning={turning}
            onClick={displayOn || turning ? powerOff : powerOn}
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
