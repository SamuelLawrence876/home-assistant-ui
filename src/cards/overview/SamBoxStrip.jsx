import { useState, useEffect, useRef } from "react";
import { callService } from "../../ha/client.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   SamBox360 — game console (Pi 5 Moonlight client) on a smart plug.

   This card knows exactly one thing: whether mains power at
   `switch.sambox360_plug` is on. It used to also print a fixed
   "Living Room TV · 4K·60·HDR · controller" line pulled from the mock,
   which it claimed whether the console was on, off or unplugged, at any
   resolution. There is no HA entity behind a display mode, a resolution
   or a controller, so those claims are gone rather than faked — the
   strip now names the entity it actually controls and stops there.
   Wiring real console telemetry is roadmap item [26], parked pending a
   design conversation; do not invent entities for it here.

   When the plug entity is missing or unavailable the strip says so and
   the switch is disabled. It used to fall back to the mock's "off",
   so a dead plug and a plug that is genuinely off looked identical.
   ----------------------------------------------------------------*/
const PLUG_ENTITY = "switch.sambox360_plug";
const SESSION_ENTITY = "sensor.sambox360_status"; // optional: Pi-reported play state (stretch)
const DEVICE_NAME = "SamBox360";
const BOOT_MS = 2200; // cold-boot transient while the plug restores + the Pi wakes

export function SamBoxStrip({ compact = false }) {
  const { entity: plug, status: plugStatus } = useEntityStatus(PLUG_ENTITY);
  const { entity: session } = useEntityStatus(SESSION_ENTITY);

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
  }
  function powerOff() {
    clearTimeout(timer.current);
    setTurning(false);
    setOnLocal(false);
    callService("switch", "turn_off", { entity_id: PLUG_ENTITY }).catch(() => setOnLocal(plugOnRef.current));
  }

  // Richer "Streaming" label once the Pi reports a session sensor; ignored until it exists.
  const streaming = session?.state === "streaming" || session?.state === "playing";

  const displayOn = known && (on || streaming);
  const pending = plugStatus === "loading";
  const unknownLabel = pending ? "—" : "Unavailable";
  const statusLabel = !known
    ? unknownLabel
    : turning
      ? "Turning on…"
      : streaming
        ? "Streaming"
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
            {/* The entity this switch actually drives. Mains power is the only
                thing the dashboard can see, so it is the only thing named. */}
            <div className="sambox-out" title="Mains power only — the console reports no display or controller state to Home Assistant">
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
            aria-label={known ? "SamBox360 power" : `SamBox360 power — ${pending ? "not reported yet" : "unavailable"}`}
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
