import { useState, useEffect } from "react";
import { formatRelativeIso } from "../../lib/format.js";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService, imageUrl } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Vacuum — Roborock S8 "Gregory"
   ----------------------------------------------------------------*/
/* One gate for every reading. Roborock's cloud sensors report "unavailable" when the
   dock drops off and "unknown" before they have ever reported — `??` lets both of
   those strings through, so they render raw ("unavailable m²") in a 20px stat face. */
const has = (v) => v != null && v !== "" && v !== "unavailable" && v !== "unknown";
const numOr = (v, d) => (has(v) && !Number.isNaN(+v) ? +v : d);
const txtOr = (v, d = "—") => (has(v) ? v : d);

function FloorPlan({ cleaning }) {
  const W = 320, H = 220;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="fp-svg">
      <defs>
        <pattern id="fp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--rule)" strokeWidth="0.4" />
        </pattern>
        <linearGradient id="fp-floor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--accent-2), transparent 92%)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--accent), transparent 92%)" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" fill="url(#fp-grid)" />
      <g className="fp-rooms">
        <g>
          <rect x="14" y="86" width="160" height="124" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="22" y="104" className="rm">LIVING</text>
          <text x="22" y="118" className="rm-sub">24 m²</text>
        </g>
        <g>
          <rect x="180" y="86" width="126" height="78" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="188" y="104" className="rm">KITCHEN</text>
          <text x="188" y="118" className="rm-sub">11 m²</text>
        </g>
        <g>
          <rect x="180" y="170" width="58" height="40" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="188" y="186" className="rm">BATH</text>
        </g>
        <g>
          <rect x="244" y="170" width="62" height="40" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" />
          <text x="252" y="186" className="rm">BED</text>
        </g>
        <g>
          <rect x="14" y="14" width="292" height="60" rx="6" fill="url(#fp-floor)" stroke="var(--ink-3)" strokeWidth="0.9" opacity="0.85" />
          <text x="22" y="32" className="rm">HALL · OFFICE</text>
          <text x="22" y="46" className="rm-sub">7 m²</text>
        </g>
      </g>
      <g className="fp-path">
        <path
          d="M 34 196 Q 60 170 100 188 T 160 178 Q 168 152 130 140 T 60 130 Q 38 118 60 100 T 130 100 Q 160 96 188 110 T 254 124 Q 290 132 280 152"
          fill="none"
          stroke={cleaning ? "var(--accent)" : "var(--ink-3)"}
          strokeWidth={cleaning ? "1.6" : "1.2"}
          strokeDasharray={cleaning ? "0" : "2 3"}
          opacity={cleaning ? 0.85 : 0.45}
          strokeLinecap="round"
        />
      </g>
      <g className="fp-dock">
        <rect x="20" y="192" width="20" height="14" rx="3" fill="var(--good)" opacity="0.18" stroke="var(--good)" strokeWidth="0.8" />
        <circle cx="30" cy="199" r="3" fill="var(--good)" />
        <text x="46" y="203" className="dock-lbl">DOCK</text>
      </g>
      {cleaning && (
        <g>
          <circle cx="160" cy="178" r="6" fill="var(--accent)" opacity="0.22">
            <animate attributeName="r" values="6;10;6" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="160" cy="178" r="3.5" fill="var(--accent)" stroke="var(--glass-bg)" strokeWidth="1.2" />
        </g>
      )}
    </svg>
  );
}

export function VacuumCard({ index = 0 }) {
  const { entity: liveVac, status: vacStatus } = useEntityStatus("vacuum.roborock_s8");
  const liveBat = useEntity("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  const liveLast = useEntity("sensor.roborock_s8_last_clean_end");
  const liveMap = useEntity("select.roborock_s8_selected_map");
  const liveMopIntensity = useEntity("select.roborock_s8_mop_intensity");
  const liveMopMode = useEntity("select.roborock_s8_mop_mode");
  const liveRoom = useEntity("sensor.roborock_s8_current_room");
  const liveArea = useEntity("sensor.roborock_s8_cleaning_area");
  const liveTime = useEntity("sensor.roborock_s8_cleaning_time");
  const liveProgress = useEntity("sensor.roborock_s8_cleaning_progress");
  const liveDnd = useEntity("switch.roborock_s8_do_not_disturb");
  const liveCharging = useEntity("binary_sensor.roborock_s8_charging");
  const liveMopAttached = useEntity("binary_sensor.roborock_s8_mop_attached");
  const liveWaterShortage = useEntity("binary_sensor.roborock_s8_water_shortage");
  const liveMainBrush = useEntity("sensor.roborock_s8_main_brush_time_left");
  const liveSideBrush = useEntity("sensor.roborock_s8_side_brush_time_left");
  const liveFilter = useEntity("sensor.roborock_s8_filter_time_left");
  const liveMapImage = useEntity("image.roborock_s8_map_0");
  const liveError = useEntity("sensor.roborock_s8_vacuum_error");

  // Roborock's cloud sensors go "unavailable" while the dock is offline —
  // null here so the readouts render an em dash instead of "NaN%".
  const battery = numOr(liveBat?.state, null);
  const vStatus = txtOr(liveStatus?.state);
  // formatRelativeIso hands an unparseable string straight back, so gate it first.
  const last = has(liveLast?.state) ? formatRelativeIso(liveLast.state) : "—";
  const mapOptions = liveMap?.attributes?.options || [];
  const currentMap = liveMap?.state;
  const mopIntensityOptions = liveMopIntensity?.attributes?.options || [];
  const currentMopIntensity = liveMopIntensity?.state;
  const mopModeOptions = liveMopMode?.attributes?.options || [];
  const currentMopMode = liveMopMode?.state;
  // Subscribed and read, but nothing renders it yet. Underscored so the linter's
  // allowance covers it rather than warning on every run; drop both this and the
  // liveRoom subscription above if the room readout isn't wanted.
  const _currentRoom = liveRoom?.state;
  const cleanArea = numOr(liveArea?.state, null);
  const cleanTime = numOr(liveTime?.state, null);
  const cleanProgress = numOr(liveProgress?.state, null);
  const dndOn = liveDnd?.state === "on";
  const charging = liveCharging?.state === "on";
  const mopAttached = liveMopAttached?.state === "on";
  const waterShortage = liveWaterShortage?.state === "on";
  const mainBrushRaw = numOr(liveMainBrush?.state, null);
  const sideBrushRaw = numOr(liveSideBrush?.state, null);
  const filterRaw = numOr(liveFilter?.state, null);
  const consumableUnit = liveMainBrush?.attributes?.unit_of_measurement || "";
  const toHours = (v) => v == null ? null : consumableUnit === "s" || v > 10000 ? Math.round(v / 3600) : v;
  const mainBrushLeft = toHours(mainBrushRaw);
  const sideBrushLeft = toHours(sideBrushRaw);
  const filterLeft = toHours(filterRaw);
  const maxBrush = 300;
  const brushPct = (v) => v == null ? 0 : Math.max(0, Math.min(100, (v / maxBrush) * 100));
  const brushColor = (v) => brushPct(v) > 50 ? "var(--good)" : brushPct(v) > 20 ? "var(--warn)" : "var(--bad)";
  const vacError = liveError?.state;
  const hasError = has(vacError) && vacError !== "none" && vacError !== "0";
  const mapImgSrc = liveMapImage ? imageUrl("image.roborock_s8_map_0", liveMapImage.last_updated) : null;
  const [mapBroken, setMapBroken] = useState(false);
  useEffect(() => { setMapBroken(false); }, [mapImgSrc]);

  const [state, setState] = useState(liveVac?.state ?? "docked");
  const unavailable = liveVac?.state === "unavailable";
  useEffect(() => {
    if (liveVac?.state) setState(liveVac.state);
  }, [liveVac?.state]);
  const cleaning = state === "cleaning";
  const paused = state === "paused";

  // Acting flips `state` optimistically, which re-renders a different command into
  // the same slot — click Return and "Full" lands under the cursor, so a fast second
  // click starts a whole-house clean nobody asked for. Hold the set the user clicked
  // in, and lock it, until the command has had time to land.
  const [lockedMode, setLockedMode] = useState(null);
  useEffect(() => {
    if (!lockedMode) return;
    const id = setTimeout(() => setLockedMode(null), 600);
    return () => clearTimeout(id);
  }, [lockedMode]);
  const actionMode = lockedMode || (cleaning ? "cleaning" : paused ? "paused" : "idle");
  const actionsLocked = unavailable || lockedMode != null;
  const act = (fn) => { setLockedMode(actionMode); fn(); };

  function start() {
    setState("cleaning");
    callService("vacuum", "start", { entity_id: "vacuum.roborock_s8" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function pause() {
    setState("paused");
    callService("vacuum", "pause", { entity_id: "vacuum.roborock_s8" }).catch(() => setState(liveVac?.state || "cleaning"));
  }
  function dock() {
    setState("returning");
    callService("vacuum", "return_to_base", { entity_id: "vacuum.roborock_s8" }).catch(() => setState("cleaning"));
  }
  function fullClean() {
    setState("cleaning");
    callService("button", "press", { entity_id: "button.roborock_s8_full_cleaning" }).catch(() => setState(liveVac?.state || "docked"));
  }
  function locate() {
    callService("vacuum", "locate", { entity_id: "vacuum.roborock_s8" }).catch(() => {});
  }
  function pickMap(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_selected_map", option: opt }).catch(() => {});
  }
  function pickMopIntensity(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_mop_intensity", option: opt }).catch(() => {});
  }
  function pickMopMode(opt) {
    callService("select", "select_option", { entity_id: "select.roborock_s8_mop_mode", option: opt }).catch(() => {});
  }
  function toggleDnd() {
    callService("switch", dndOn ? "turn_off" : "turn_on", { entity_id: "switch.roborock_s8_do_not_disturb" }).catch(() => {});
  }

  const charge = cleaning ? "var(--accent)" : "var(--good)";
  const batteryLabel = battery != null ? `${battery}%` : "—";
  const chargeLabel = cleaning
    ? `cleaning · ${batteryLabel}`
    : charging
    ? `charging · ${batteryLabel}`
    : `${vStatus} · ${batteryLabel}`;

  return (
    <Card
      index={index}
      className="ws-vacuum"
      eyebrow="Vacuum · Roborock S8"
      title="Gregory"
      meta={`Last clean · ${last}`}
      headRight={
        <span className={`ws-status-pill ${cleaning ? "live" : "ok"}`}>
          <span className="dot" style={{ background: charge }} /> {chargeLabel}
        </span>
      }
    >
      <EntityGuard status={vacStatus} entityId="vacuum.roborock_s8">
      {hasError && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          Error · {vacError}
        </div>
      )}
      {waterShortage && (
        <div style={{ color: "var(--bad)", fontSize: 12, fontFamily: "var(--font-mono)", marginBottom: 8, letterSpacing: "0.04em" }}>
          Water shortage
        </div>
      )}

      {/* Floor plan / live map */}
      <div className="ws-floorplan">
        {mapImgSrc && !mapBroken ? (
          <img src={mapImgSrc} alt="Vacuum map" onError={() => setMapBroken(true)} style={{ width: "100%", height: "auto", borderRadius: 8, opacity: 0.9 }} />
        ) : (
          <FloorPlan cleaning={cleaning} />
        )}
      </div>

      {/* Stats + actions */}
      <div className="ws-vac-actions">
        <div className="ws-vac-stat">
          <span className="k">Battery</span>
          <span className="v" style={{ color: battery != null && battery >= 90 ? "var(--good)" : "var(--ink)" }}>
            {battery ?? "—"}<i>%</i>
          </span>
        </div>
        <div className="ws-vac-stat">
          <span className="k">Status</span>
          <span className="v small">{cleaning ? "ACTIVE" : paused ? "PAUSED" : (vStatus || "—").toUpperCase()}</span>
        </div>
        <div className="ws-vac-actbtns">
          {actionMode === "cleaning" ? (
            <>
              <button className="btn primary" onClick={() => act(pause)} disabled={actionsLocked}>Pause</button>
              <button className="btn" onClick={() => act(dock)} disabled={actionsLocked}>Return</button>
            </>
          ) : actionMode === "paused" ? (
            <>
              <button className="btn accent" onClick={() => act(start)} disabled={actionsLocked}>Resume</button>
              <button className="btn" onClick={() => act(dock)} disabled={actionsLocked}>Dock</button>
            </>
          ) : (
            <>
              <button className="btn accent" onClick={() => act(start)} disabled={actionsLocked}>Start</button>
              <button className="btn" onClick={() => act(fullClean)} disabled={actionsLocked}>Full</button>
            </>
          )}
          <button className="btn ghost" onClick={locate} disabled={unavailable} title="Beep so I can find it">Locate</button>
        </div>
      </div>

      {(cleaning || paused) && (
        <div className="ws-therm-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="ws-therm">
            <span className="k">Progress</span>
            <span className="v">{cleanProgress ?? "—"}<i>%</i></span>
          </div>
          <div className="ws-therm">
            <span className="k">Area</span>
            <span className="v">{cleanArea ?? "—"}<i>m²</i></span>
          </div>
          <div className="ws-therm">
            <span className="k">Time</span>
            <span className="v">{cleanTime ?? "—"}<i>min</i></span>
          </div>
        </div>
      )}

      {/* Mop intensity + mode + map controls */}
      <div className="ws-vac-controls">
        {mopIntensityOptions.length > 0 && (
          <div className="ws-control-row">
            <span className="k">Mop intensity</span>
            <div className="seg">
              {mopIntensityOptions.map((p) => (
                <button key={p} className={currentMopIntensity === p ? "on" : ""} onClick={() => pickMopIntensity(p)} disabled={unavailable}>{p}</button>
              ))}
            </div>
          </div>
        )}
        {mopModeOptions.length > 0 && (
          <div className="ws-control-row">
            <span className="k">Mop mode</span>
            <div className="seg">
              {mopModeOptions.map((p) => (
                <button key={p} className={currentMopMode === p ? "on" : ""} onClick={() => pickMopMode(p)} disabled={unavailable}>{p}</button>
              ))}
            </div>
          </div>
        )}
        <div className="ws-control-row">
          {mapOptions.length > 0 && (
            <>
              <span className="k">Map</span>
              <div className="seg compact">
                {mapOptions.map((opt) => (
                  <button key={opt} className={currentMap === opt ? "on" : ""} onClick={() => pickMap(opt)} disabled={unavailable}>{opt}</button>
                ))}
              </div>
            </>
          )}
          {/* The whole pill is the switch — the 22x12 knob alone is under the
              24x24 minimum target size, and a bare <span> announced as nothing. */}
          <button
            type="button"
            className="ws-flag"
            role="switch"
            aria-checked={dndOn}
            aria-label="Do not disturb"
            onClick={toggleDnd}
            disabled={unavailable}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              lineHeight: "inherit",   // buttons don't inherit it; keeps the pill the same height as its siblings
              cursor: unavailable ? "not-allowed" : "pointer",
              opacity: unavailable ? 0.5 : 1,
            }}
          >
            <span className={`mini-tog ${dndOn ? "on" : ""}`} aria-hidden />
            DND
          </button>
          {mopAttached && (
            <span className="ws-flag ok">
              <span className="dot" /> Mop attached
            </span>
          )}
        </div>
      </div>

      {/* Brushes / filter wear */}
      <div className="ws-wear">
        {[
          { lbl: "Main brush", v: mainBrushLeft },
          { lbl: "Side brush", v: sideBrushLeft },
          { lbl: "Filter", v: filterLeft },
        ].map(({ lbl, v }) => (
          <div className="ws-wear-row" key={lbl}>
            <span className="lbl">{lbl}</span>
            <span className="bar">
              <span style={{ "--p": `${brushPct(v)}%`, "--c": brushColor(v) }} />
            </span>
            <span className="val">
              {v ?? "—"}<i>h left</i>
            </span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}
