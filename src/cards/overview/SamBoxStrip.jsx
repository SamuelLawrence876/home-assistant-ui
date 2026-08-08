import { useState, useEffect, useRef } from "react";
import { callService } from "../../ha/client.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   SamBox360 — one switch for the whole gaming rig.

   One tap does both halves of "I want to play": mains power to the PC
   (`switch.sambox360_plug`) AND the game session (`switch.sambox`, the
   TV-side kiosk that wakes the TV over HDMI-CEC and streams the PC).
   They used to be separate buttons on separate tabs, which Samuel
   called silly (2026-08-08) — powering the box and starting the game
   are the same intent. Off ends the session and cuts the plug, exactly
   what the off tap always did plus not leaving a kiosk streaming a
   dead source. The System tab's Game stream card is still the
   fine-grained control (session without power-cut, smooth mode).

   Firing the session while the PC is still booting is fine by design:
   the kiosk waits for a stream source, and the System card reports
   "PC is off" until there is one. A session-call failure does not
   revert the toggle — the toggle's *state* is the plug, and client.js
   has already put the failure in the error log.

   The toggle's state comes from the plug entity; "Streaming"/"Game on"
   labels come from the real session telemetry added 2026-08-06. When
   the plug entity is missing or unavailable the strip says so and the
   switch is disabled — a dead plug and a plug that is genuinely off
   must not look identical.
   ----------------------------------------------------------------*/
const PLUG_ENTITY = "switch.sambox360_plug"; // mains power to the gaming PC
const SESSION_SWITCH = "switch.sambox"; // TV-side kiosk: wake TV, stream the PC
const HEALTH_ENTITY = "sensor.sambox_dropped_frames"; // streaming state lives in its attributes
const DEVICE_NAME = "SamBox360";
const BOOT_MS = 2200; // cold-boot transient while the plug restores + the Pi wakes

export function SamBoxStrip({ compact = false }) {
  const { entity: plug, status: plugStatus } = useEntityStatus(PLUG_ENTITY);
  const { entity: session } = useEntityStatus(SESSION_SWITCH);
  const { entity: health } = useEntityStatus(HEALTH_ENTITY);

  // "known" = HA has told us the plug's real state. Anything else (still
  // connecting, entity missing, entity unavailable) is not an "off".
  const known = plugStatus === "ready";
  const plugOn = known && plug.state === "on";

  const [on, setOnLocal] = useState(plugOn);
  const [turning, setTurning] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Re-sync to live plug state on every change (canonical pattern). A real
  // "off" from HA cancels any in-flight boot transient; losing the entity
  // altogether cancels it too, because we no longer know what is happening.
  useEffect(() => {
    if (!known) {
      clearTimeout(timer.current);
      setTurning(false);
      return;
    }
    const isOn = plug.state === "on";
    setOnLocal(isOn);
    if (!isOn) {
      clearTimeout(timer.current);
      setTurning(false);
    }
  }, [known, plug?.state]);

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
    // Empty catch: the error log already has it, and the toggle's state is
    // the plug, so a failed session start must not revert it.
    callService("switch", "turn_on", { entity_id: SESSION_SWITCH }).catch(() => {});
  }
  function powerOff() {
    clearTimeout(timer.current);
    setTurning(false);
    setOnLocal(false);
    callService("switch", "turn_off", { entity_id: SESSION_SWITCH }).catch(() => {});
    callService("switch", "turn_off", { entity_id: PLUG_ENTITY }).catch(() => setOnLocal(plugOnRef.current));
  }

  // Real session telemetry (System tab has the numbers). The health sensor's
  // offline fallback fabricates streaming:false, so "Streaming" additionally
  // requires the kiosk Pi to have actually answered.
  const sessionOn = session?.state === "on";
  const streaming = health?.attributes?.pi === "online" && health?.attributes?.streaming === true;

  const displayOn = known && (on || streaming);
  const pending = plugStatus === "loading";
  const unknownLabel = pending ? "—" : "Unavailable";
  const statusLabel = !known
    ? unknownLabel
    : turning
      ? "Turning on…"
      : streaming
        ? "Streaming"
        : sessionOn
          ? "Game on"
          : on
            ? "On"
            : "Off";
  const statusColor = !known
    ? "var(--ink-4)"
    : turning
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
            <div className="sambox-name">{DEVICE_NAME}</div>
            {/* The visible line names the plug — the entity whose state the
                toggle shows. The session half rides in the tooltip and the
                switch's accessible name. */}
            <div className="sambox-out" title={`One tap drives both ${PLUG_ENTITY} (PC power) and ${SESSION_SWITCH} (game session)`}>
              {PLUG_ENTITY}
            </div>
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
            /* role="switch" has no "unknown" value, so when the plug hasn't
               reported, aria-checked has to say false — which a screen reader
               announces as "off", the exact conflation this card was rewritten
               to remove. Put the real state in the accessible name instead. */
            aria-label={known ? "SamBox360 power and game session" : `SamBox360 power and game session — ${pending ? "not reported yet" : "unavailable"}`}
            data-on={displayOn}
            data-turning={turning}
            disabled={!known}
            title={known ? undefined : `${PLUG_ENTITY} ${pending ? "has not reported yet" : "is unavailable"}`}
            style={known ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
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
