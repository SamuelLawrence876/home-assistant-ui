import { useState, useEffect } from "react";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService, imageUrl } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Printer — Bambu X1C
   ----------------------------------------------------------------*/
/* One gate for every reading. HA reports "unavailable" when a sensor drops out and
   "unknown" before it has ever reported — neither may reach the screen, be parsed
   as a number, or be handed to Date(), which turns them into "Invalid Date". */
const has = (v) => v != null && v !== "" && v !== "unavailable" && v !== "unknown";
const numOr = (v, d) => (has(v) && !Number.isNaN(+v) ? +v : d);
const txtOr = (v, d = "—") => (has(v) ? v : d);

function PrinterPreview({ progress = 0, color = "#d97757" }) {
  const H = 220, W = 240;
  const layers = 36;
  const printedLayers = Math.floor((progress / 100) * layers);
  const baseY = H - 24;
  const profile = (i) => {
    const t = i / layers;
    const r = 48 + Math.sin(t * Math.PI * 1.2) * 12 - t * 14;
    return Math.max(22, r);
  };
  const stripes = [];
  for (let i = 0; i < layers; i++) {
    const y = baseY - (i + 0.5) * ((H - 60) / layers);
    const r = profile(i);
    stripes.push({ y, r, printed: i < printedLayers, i });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="pp-svg">
      <defs>
        <linearGradient id="pp-plate" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
        <radialGradient id="pp-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <ellipse cx={W / 2} cy={baseY + 4} rx="84" ry="14" fill="url(#pp-floor)" />
      <rect x={W / 2 - 78} y={baseY} width="156" height="6" rx="2" fill="url(#pp-plate)" />
      <line x1={W / 2 - 78} y1={baseY + 6} x2={W / 2 + 78} y2={baseY + 6} stroke="rgba(255,255,255,0.22)" strokeWidth="0.6" />
      <g>
        {stripes.filter(s => s.printed).map((s) => (
          <ellipse key={s.i} cx={W / 2} cy={s.y} rx={s.r} ry="3.2"
            fill={color} opacity={0.92 - (s.i / layers) * 0.05} />
        ))}
        {printedLayers > 0 && (() => {
          const top = stripes[printedLayers - 1];
          return (
            <>
              <ellipse cx={W / 2} cy={top.y - 1} rx={top.r} ry="2" fill="rgba(255,255,255,0.35)" />
              <g>
                <line x1={W / 2} x2={W / 2} y1={top.y - 36} y2={top.y - 6}
                  stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
                <polygon points={`${W / 2 - 5},${top.y - 6} ${W / 2 + 5},${top.y - 6} ${W / 2},${top.y + 2}`}
                  fill="rgba(255,255,255,0.85)" />
              </g>
            </>
          );
        })()}
      </g>
      <g opacity="0.18">
        {stripes.filter(s => !s.printed).map((s) => (
          <ellipse key={`g${s.i}`} cx={W / 2} cy={s.y} rx={s.r} ry="2.2"
            fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.5" strokeDasharray="1 2" />
        ))}
      </g>
    </svg>
  );
}

export function PrinterCard({ index = 0 }) {
  const PREFIX = "x1c_00m09d522400385";
  const { entity: liveProg, status } = useEntityStatus(`sensor.${PREFIX}_print_progress`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  const liveRemaining = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveNozzle = useEntity(`sensor.${PREFIX}_nozzle_temperature`);
  const liveNozzleTarget = useEntity(`sensor.${PREFIX}_nozzle_target_temperature`);
  const liveBed = useEntity(`sensor.${PREFIX}_bed_temperature`);
  const liveBedTarget = useEntity(`sensor.${PREFIX}_bed_target_temperature`);
  const liveChamber = useEntity(`sensor.${PREFIX}_chamber_temperature`);
  const liveAms = useEntity(`sensor.${PREFIX}_ams_1_humidity`);
  const liveTray = useEntity(`sensor.${PREFIX}_active_tray`);
  const liveLight = useEntity(`light.${PREFIX}_chamber_light`);
  const liveImage = useEntity(`image.${PREFIX}_cover_image`);
  const liveLayer = useEntity(`sensor.${PREFIX}_current_layer`);
  const liveTotalLayers = useEntity(`sensor.${PREFIX}_total_layer_count`);
  const liveSpeed = useEntity(`sensor.${PREFIX}_speed_profile`);
  const liveAuxFan = useEntity(`sensor.${PREFIX}_aux_fan_speed`);
  const liveChamberFan = useEntity(`sensor.${PREFIX}_chamber_fan_speed`);
  const liveCoolingFan = useEntity(`sensor.${PREFIX}_cooling_fan_speed`);
  const liveStart = useEntity(`sensor.${PREFIX}_start_time`);
  const liveEnd = useEntity(`sensor.${PREFIX}_end_time`);
  const livePrintStatus = useEntity(`sensor.${PREFIX}_print_status`);
  const liveDoor = useEntity(`binary_sensor.${PREFIX}_door`);
  const liveHmsErrors = useEntity(`binary_sensor.${PREFIX}_hms_errors`);
  const livePrintError = useEntity(`binary_sensor.${PREFIX}_print_error`);
  const liveCamera = useEntity(`switch.${PREFIX}_camera`);
  const liveOnline = useEntity(`binary_sensor.${PREFIX}_online`);
  const liveTray1 = useEntity(`sensor.${PREFIX}_ams_1_tray_1`);
  const liveTray2 = useEntity(`sensor.${PREFIX}_ams_1_tray_2`);
  const liveTray3 = useEntity(`sensor.${PREFIX}_ams_1_tray_3`);
  const liveTray4 = useEntity(`sensor.${PREFIX}_ams_1_tray_4`);
  const liveWeight = useEntity(`sensor.${PREFIX}_print_weight`);
  const liveLength = useEntity(`sensor.${PREFIX}_print_length`);

  // The X1C drops every sensor to "unavailable" the moment it goes offline,
  // so these are null (→ em dash) rather than NaN or a fake 0.
  const prog = numOr(liveProg?.state, null);
  const stage = txtOr(liveStage?.state);
  const remaining = numOr(liveRemaining?.state, null);
  const nozzle = numOr(liveNozzle?.state, null);
  const nozzleTarget = numOr(liveNozzleTarget?.state, 0);
  const bed = numOr(liveBed?.state, null);
  const bedTarget = numOr(liveBedTarget?.state, 0);
  const chamber = numOr(liveChamber?.state, null);
  const ams = numOr(liveAms?.state, null);
  const tray = txtOr(liveTray?.state);
  const fileName = liveProg?.attributes?.file_name || "—";
  const curLayer = has(liveLayer?.state) ? String(liveLayer.state).padStart(3, "0") : "—";
  const totalLayers = txtOr(liveTotalLayers?.state);
  const speedProfile = txtOr(liveSpeed?.state);
  const auxFan = txtOr(liveAuxFan?.state);
  const chamberFan = txtOr(liveChamberFan?.state);
  const coolingFan = txtOr(liveCoolingFan?.state);
  const startTime = liveStart?.state;
  const endTime = liveEnd?.state;
  const printStatus = txtOr(livePrintStatus?.state, "unknown");
  const doorOpen = liveDoor?.state === "on";
  const hasHmsError = liveHmsErrors?.state === "on";
  const hasPrintError = livePrintError?.state === "on";
  const online = liveOnline?.state === "on";
  const cameraOn = liveCamera?.state === "on";
  const printWeight = liveWeight?.state;
  // Subscribed and read, but nothing renders it yet. Underscored so the linter's
  // allowance covers it rather than warning on every run; drop both this and the
  // liveLength subscription above if the filament-length readout isn't wanted.
  const _printLength = liveLength?.state;
  const printing = printStatus === "running" || (remaining > 0 && stage !== "idle");
  const amsTrayNames = [liveTray1, liveTray2, liveTray3, liveTray4].map(
    (t) => has(t?.state) && t.state !== "Empty" ? t.state : null
  );

  const [light, setLight] = useState(liveLight?.state === "on");
  useEffect(() => { if (liveLight) setLight(liveLight.state === "on"); }, [liveLight?.state]);
  function toggleLight() {
    const next = !light;
    setLight(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: `light.${PREFIX}_chamber_light` }).catch(() => setLight(light));
  }
  function toggleCamera() {
    callService("switch", cameraOn ? "turn_off" : "turn_on", { entity_id: `switch.${PREFIX}_camera` }).catch(() => {});
  }
  // HA rotates the entity_picture token, so a cached URL can 401 — fall back to the
  // drawn preview like the vacuum map does, rather than leaving an empty tile with
  // white-on-dark overlay buttons stranded on the pale card background.
  const coverSrc = liveImage ? imageUrl(`image.${PREFIX}_cover_image`, liveImage.last_updated) : null;
  const [coverBroken, setCoverBroken] = useState(false);
  useEffect(() => { setCoverBroken(false); }, [coverSrc]);
  const cover = coverBroken ? null : coverSrc;

  const fmtIsoTime = (iso) => {
    if (!has(iso)) return "—";
    // new Date("unavailable") doesn't throw — it returns an Invalid Date that
    // formats as the literal string "Invalid Date".
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatRemaining = (m) => {
    if (!m && m !== 0) return "—";
    if (m < 60) return `${Math.round(m)}m`;
    const h = Math.floor(m / 60), mm = Math.round(m % 60);
    return mm ? `${h}h ${mm}m` : `${h}h`;
  };

  const trayColors = ["#d97757", "#4a9eff", "#6ecf6e", "#f5d442"];
  const activeTrayIdx = amsTrayNames.findIndex(n => n && n === tray);

  return (
    <Card
      index={index}
      className="ws-printer"
      eyebrow="3D Printer · Bambu X1C"
      title={printing ? "Printing" : printStatus === "unknown" ? "Idle" : printStatus.charAt(0).toUpperCase() + printStatus.slice(1)}
      meta={`Stage · ${stage}`}
      headRight={
        <span className={`ws-status-pill ${printing ? "live" : online ? "ok" : ""}`}>
          <span className="dot" style={!printing && online ? { background: "var(--good)" } : !online ? { background: "var(--ink-4)" } : undefined} />
          {printing ? "live" : online ? "online" : "offline"}
        </span>
      }
    >
      <EntityGuard status={status} entityId={`sensor.${PREFIX}_print_progress`}>
      {(hasHmsError || hasPrintError) && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          {hasHmsError && "HMS ERROR"}
          {hasHmsError && hasPrintError && " · "}
          {hasPrintError && "PRINT ERROR"}
        </div>
      )}
      <div className="ws-printer-grid">
        {/* LEFT: live preview tile */}
        <div className="ws-printer-tile">
          {cover ? (
            <img
              src={cover}
              alt="Print cover"
              onError={() => setCoverBroken(true)}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <PrinterPreview progress={prog ?? 0} color={activeTrayIdx >= 0 ? trayColors[activeTrayIdx] : "#d97757"} />
          )}
          <div className="ws-tile-overlay">
            <span className="ws-tile-live">
              <span className="dot" /> {cover ? "LIVE · cover" : "cover_image"}
            </span>
            <span className="ws-tile-layer">
              Layer <b>{curLayer}</b> / {totalLayers}
            </span>
          </div>
          <div className="ws-tile-toggles">
            <button className={`ws-tog ${cameraOn ? "on" : ""}`} onClick={toggleCamera} aria-pressed={cameraOn}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1" y="4" width="10" height="8" rx="1.5" />
                <path d="M11 7l4-2v6l-4-2z" />
              </svg>
              Cam
            </button>
            <button className={`ws-tog ${light ? "on" : ""}`} onClick={toggleLight} aria-pressed={light}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M5 7a3 3 0 1 1 6 0c0 1.5-1.2 2.2-1.2 3.5H6.2C6.2 9.2 5 8.5 5 7z" />
                <path d="M6.5 13h3M7 14.5h2" strokeLinecap="round" />
              </svg>
              Light
            </button>
          </div>
        </div>

        {/* RIGHT: file + progress + temps */}
        <div className="ws-printer-info">
          <div className="ws-file">
            <div className="ws-file-name" title={fileName}>{fileName}</div>
            <div className="ws-file-sub">
              {has(startTime) ? `Started ${fmtIsoTime(startTime)}` : "—"}
              {has(endTime) && <> · ETA <b>{fmtIsoTime(endTime)}</b></>}
              {doorOpen && <span style={{ color: "var(--accent-2)", marginLeft: 6 }}>· door open</span>}
            </div>
          </div>

          <div className="ws-progress-block">
            <div className="ws-progress-readout">
              <span className="big">{prog ?? "—"}<span className="u">%</span></span>
              <span className="rem">{formatRemaining(remaining)} <span className="muted">remaining</span></span>
            </div>
            <div className="ws-progress-track">
              <span style={{ "--p": `${prog ?? 0}%` }} />
              <em style={{ left: `${prog ?? 0}%` }} />
            </div>
            {printing && (
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                <span>Speed · <b style={{ color: "var(--ink-2)" }}>{speedProfile}</b></span>
                {has(printWeight) && <span>Weight · <b style={{ color: "var(--ink-2)" }}>{printWeight}g</b></span>}
              </div>
            )}
          </div>

          <div className="ws-therm-grid">
            <div className="ws-therm">
              <span className="k">Nozzle</span>
              <span className="v">{nozzle ?? "—"}<i>°</i></span>
              <span className="tgt">{nozzleTarget > 0 ? `→ ${nozzleTarget}°` : "idle"}</span>
            </div>
            <div className="ws-therm">
              <span className="k">Bed</span>
              <span className="v">{bed ?? "—"}<i>°</i></span>
              <span className="tgt">{bedTarget > 0 ? `→ ${bedTarget}°` : "idle"}</span>
            </div>
            <div className="ws-therm">
              <span className="k">Chamber</span>
              <span className="v">{chamber ?? "—"}<i>°</i></span>
              <span className="tgt">passive</span>
            </div>
            <div className="ws-therm">
              <span className="k">AMS RH</span>
              <span className="v">{ams ?? "—"}<i>%</i></span>
              <span className="tgt">{ams == null ? "no reading" : ams < 50 ? "ok < 50%" : "high"}</span>
            </div>
          </div>

          {printing && (
            <div className="ws-therm-grid" style={{ paddingTop: 0, borderTop: "none" }}>
              <div className="ws-therm">
                <span className="k">Part fan</span>
                <span className="v">{coolingFan}<i>%</i></span>
              </div>
              <div className="ws-therm">
                <span className="k">Aux fan</span>
                <span className="v">{auxFan}<i>%</i></span>
              </div>
              <div className="ws-therm">
                <span className="k">Cham. fan</span>
                <span className="v">{chamberFan}<i>%</i></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AMS tray strip */}
      {amsTrayNames.some(Boolean) && (
        <div className="ws-ams">
          <div className="ws-ams-head">
            <span className="lbl">AMS · {amsTrayNames.filter(Boolean).length} trays loaded</span>
            <span className="hint">active · {tray}</span>
          </div>
          <div className="ws-ams-trays">
            {/* Read-only: the Bambu integration exposes no select-tray service, so these
                are plain tiles — as <button>s they were four dead tab stops between the
                printer card and the vacuum card. */}
            {amsTrayNames.map((name, i) => (
              <div key={i} className={`ws-ams-tray ${name && name === tray ? "active" : ""}`} style={{ cursor: "default" }}>
                <span className="swatch" style={{ background: name ? trayColors[i] : "var(--ink-4)" }}>
                  {name && name === tray && <span className="active-mark" />}
                </span>
                <span className="ws-ams-meta">
                  <span className="slot">Tray {i + 1}</span>
                  <span className="mat">{name || "Empty"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </EntityGuard>
    </Card>
  );
}
