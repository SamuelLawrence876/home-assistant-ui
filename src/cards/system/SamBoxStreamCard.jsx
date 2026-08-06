import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { useOptimisticToggle } from "../../hooks/useOptimistic.js";

/* ----------------------------------------------------------------
   SamBox game stream — health + controls (System tab).

   Backed by four real entities on the Pi (all added 2026-08-06; this is the
   telemetry that roadmap [26] was parked waiting for — that item covers the
   Media-tab strip and stays parked, this card is the System-tab half):

     switch.sambox                 session: ON summons the kiosk (it wakes the
                                   TV over HDMI-CEC and streams Big Picture);
                                   flips itself off when the TV is turned off
     switch.sambox_smooth_mode     720p/10Mbps "party-proof" profile; a live
                                   stream restarts itself in the new quality
     sensor.sambox_dropped_frames  drops for the current/last session, with
                                   moonlight's end-of-session verdict and the
                                   Pi's online state as attributes
     binary_sensor.sam_pc          ping of the streaming PC — status ONLY, by
                                   Samuel's explicit request (the wake-on-LAN
                                   switch was built and reverted the same day)

   Honesty rule notes: the health sensor's command has an offline fallback
   that reports zeros so it never inflates the unavailable-entities count —
   which means a zero with pi:"offline" is fabricated, not measured, and
   every number here must render as an em dash unless the Pi answered.
   ----------------------------------------------------------------*/

const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);

/* Pure derivation, exported for tests. `pcWarning` is the error message that
   replaced wake-on-LAN: a session is wanted but there is no PC to stream. */
export function deriveStream({ healthStatus, piOnline, streaming, mode, sessionOn, pcStatus, pcOn }) {
  const pcKnown = pcStatus === "ready";
  const pcWarning = !!sessionOn && pcKnown && !pcOn;
  let meta;
  if (healthStatus === "loading") meta = "—";
  else if (healthStatus !== "ready") meta = "sensor unavailable";
  else if (!piOnline) meta = "SamBox offline";
  else if (streaming) meta = mode ? `streaming · ${mode}` : "streaming";
  else if (pcWarning) meta = "PC is off";
  else if (sessionOn) meta = "starting…";
  else meta = "idle";
  return { meta, pcWarning };
}

export function SamBoxStreamCard({ index = 0 }) {
  const { status: sessionStatus, on: sessionOn, toggle: toggleSession } =
    useOptimisticToggle("switch.sambox", "switch");
  const { status: smoothStatus, on: smoothOn, toggle: toggleSmooth } =
    useOptimisticToggle("switch.sambox_smooth_mode", "switch");
  const { entity: health, status: healthStatus } = useEntityStatus("sensor.sambox_dropped_frames");
  const { entity: pc, status: pcStatus } = useEntityStatus("binary_sensor.sam_pc");

  const sessionReady = sessionStatus === "ready";
  const smoothReady = smoothStatus === "ready";
  const healthReady = healthStatus === "ready";
  const pcKnown = pcStatus === "ready";
  const pcOn = pcKnown && pc.state === "on";

  const attrs = healthReady ? health.attributes : null;
  const piOnline = attrs?.pi === "online";
  const streaming = piOnline && attrs?.streaming === true;
  // Measured only when the Pi answered — the offline fallback's zeros are
  // fabricated (see header) and must not render as a clean bill.
  const dropped = piOnline ? numOr(health.state, null) : null;
  const netPct = piOnline ? numOr(attrs?.net_drop_pct, null) : null;
  const jitPct = piOnline ? numOr(attrs?.jitter_drop_pct, null) : null;
  const mode = piOnline && (attrs?.mode === "720" || attrs?.mode === "1080") ? `${attrs.mode}p` : null;

  const { meta, pcWarning } = deriveStream({
    healthStatus, piOnline, streaming, mode, sessionOn, pcStatus, pcOn,
  });

  // Loss bars: raw percentages. >1% network loss is a visibly bad session, so
  // that is where the warn colour starts; the bar itself stays honest (0.07%
  // is a sliver, not a pre-scaled lie).
  const barPct = (v) => (v != null ? `${Math.min(v, 100)}%` : "0%");

  return (
    <Card
      index={index}
      eyebrow="Gaming · sambox360"
      title="Game stream"
      meta={meta}
      headRight={
        <ToggleSwitch
          on={sessionOn && sessionReady}
          onToggle={toggleSession}
          disabled={!sessionReady}
          label="Game session"
        />
      }
    >
      {pcWarning && (
        <div className="sbx-warn" role="status">
          PC is off — there is nothing to stream. Turn the PC on first.
        </div>
      )}
      <div className="pi-rows">
        <div className="pi-row">
          <span className="k">PC</span>
          <span />
          <span className="v">{pcKnown ? (pcOn ? "On" : "Off") : "—"}</span>
        </div>
        <div className="pi-row">
          <span className="k">SamBox</span>
          <span />
          <span className="v">{healthReady ? (piOnline ? "Online" : "Offline") : "—"}</span>
        </div>
        <div className="pi-row" title="Current or last session">
          <span className="k">Dropped</span>
          <span />
          <span className="v">{dropped != null ? `${dropped} f` : "—"}</span>
        </div>
        <div className={`pi-row ${netPct > 1 ? "warn" : ""}`} title="Frames lost to the network (moonlight's end-of-session verdict)">
          <span className="k">Net loss</span>
          <div className="bar"><span style={{ "--p": barPct(netPct) }} /></div>
          <span className="v">{netPct != null ? `${netPct}%` : "—"}</span>
        </div>
        <div className={`pi-row ${jitPct > 1 ? "warn" : ""}`} title="Frames dropped to network jitter (moonlight's end-of-session verdict)">
          <span className="k">Jitter</span>
          <div className="bar"><span style={{ "--p": barPct(jitPct) }} /></div>
          <span className="v">{jitPct != null ? `${jitPct}%` : "—"}</span>
        </div>
      </div>
      <div className="sbx-row" title="720p/10Mbps party-proof profile — a running stream restarts in the new quality within seconds">
        <span className="k">Smooth mode · 720p</span>
        <ToggleSwitch
          on={smoothOn && smoothReady}
          onToggle={toggleSmooth}
          disabled={!smoothReady}
          label="Smooth mode (720p)"
        />
      </div>
    </Card>
  );
}
