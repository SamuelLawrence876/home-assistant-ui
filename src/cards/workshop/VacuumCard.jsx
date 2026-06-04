import { useState, useEffect } from "react";
import { formatRelativeIso } from "../../lib/format.js";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService, imageUrl } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Vacuum — Roborock S8 "Gregory"
   ----------------------------------------------------------------*/
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

  const battery = Number(liveBat?.state ?? 0);
  const vStatus = liveStatus?.state ?? "—";
  const last = formatRelativeIso(liveLast?.state) || "—";
  const mapOptions = liveMap?.attributes?.options || [];
  const currentMap = liveMap?.state;
  const mopIntensityOptions = liveMopIntensity?.attributes?.options || [];
  const currentMopIntensity = liveMopIntensity?.state;
  const mopModeOptions = liveMopMode?.attributes?.options || [];
  const currentMopMode = liveMopMode?.state;
  const currentRoom = liveRoom?.state;
  const cleanArea = liveArea?.state;
  const cleanTime = liveTime?.state;
  const cleanProgress = Number(liveProgress?.state ?? 0);
  const dndOn = liveDnd?.state === "on";
  const charging = liveCharging?.state === "on";
  const mopAttached = liveMopAttached?.state === "on";
  const waterShortage = liveWaterShortage?.state === "on";
  const mainBrushRaw = Number(liveMainBrush?.state ?? 0);
  const sideBrushRaw = Number(liveSideBrush?.state ?? 0);
  const filterRaw = Number(liveFilter?.state ?? 0);
  const consumableUnit = liveMainBrush?.attributes?.unit_of_measurement || "";
  const toHours = (v) => consumableUnit === "s" || v > 10000 ? Math.round(v / 3600) : v;
  const mainBrushLeft = toHours(mainBrushRaw);
  const sideBrushLeft = toHours(sideBrushRaw);
  const filterLeft = toHours(filterRaw);
  const maxBrush = 300;
  const brushPct = (v) => Math.max(0, Math.min(100, (v / maxBrush) * 100));
  const brushColor = (v) => brushPct(v) > 50 ? "var(--good)" : brushPct(v) > 20 ? "var(--warn)" : "var(--bad)";
  const vacError = liveError?.state;
  const hasError = vacError && vacError !== "none" && vacError !== "0" && vacError !== "unknown";
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
  const chargeLabel = cleaning
    ? `cleaning · ${battery}%`
    : charging
    ? `charging · ${battery}%`
    : `${vStatus} · ${battery}%`;

  return (
    <Card
      index={index}
      className="ws-vacuum"
      eyebrow="Vacuum · roborock_s8"
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
          <span className="v" style={{ color: battery >= 90 ? "var(--good)" : "var(--ink)" }}>
            {battery}<i>%</i>
          </span>
        </div>
        <div className="ws-vac-stat">
          <span className="k">Status</span>
          <span className="v small">{cleaning ? "ACTIVE" : paused ? "PAUSED" : (vStatus || "—").toUpperCase()}</span>
        </div>
        <div className="ws-vac-actbtns">
          {cleaning ? (
            <>
              <button className="btn primary" onClick={pause} disabled={unavailable}>Pause</button>
              <button className="btn" onClick={dock} disabled={unavailable}>Return</button>
            </>
          ) : paused ? (
            <>
              <button className="btn accent" onClick={start} disabled={unavailable}>Resume</button>
              <button className="btn" onClick={dock} disabled={unavailable}>Dock</button>
            </>
          ) : (
            <>
              <button className="btn accent" onClick={start} disabled={unavailable}>Start</button>
              <button className="btn" onClick={fullClean} disabled={unavailable}>Full</button>
            </>
          )}
          <button className="btn ghost" onClick={locate} disabled={unavailable} title="Beep so I can find it">Locate</button>
        </div>
      </div>

      {(cleaning || paused) && (
        <div className="ws-therm-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="ws-therm">
            <span className="k">Progress</span>
            <span className="v">{cleanProgress}<i>%</i></span>
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
          <span className="ws-flag" title="Do not disturb">
            <span className={`mini-tog ${dndOn ? "on" : ""}`} onClick={toggleDnd} />
            DND
          </span>
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
              {v}<i>h left</i>
            </span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}
