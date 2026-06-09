import { useState } from "react";
import { useEntity } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Scenes
   ----------------------------------------------------------------
   Tiles come in three kinds:
   - "script-toggle": a script that runs over time (sunrise fade,
     colour flow). The tile lights up while the script is running
     and tapping again CANCELS it (script.toggle). State source is
     the script entity itself (state "on" === running).
   - "pair": a script that sets device state, with an inverse script
     for the OFF half. State source is a representative device
     entity (e.g. the air purifier). Tap on → run; tap off → run
     the inverse.
   - "scene": a classic HA scene snapshot. No real "off" — fire-once.
   ----------------------------------------------------------------*/
const SCENES = [
  { id: "good_morning", nm: "Good Morning", ic: "☀", sub: "5-min sunrise", kind: "script-toggle", stateEntity: "script.good_morning" },
  { id: "leaving", nm: "Leaving", ic: "→", sub: "Purifier · lights off", kind: "pair", stateEntity: "fan.core_300s_series", offId: "leaving_off" },
  { id: "work_done", nm: "Work Done!", ic: "✦", sub: "Light flow", kind: "script-toggle", stateEntity: "script.work_done" },
  { id: "morning", nm: "Morning", ic: "◑", sub: "scene.morning", kind: "scene" },
  { id: "movie", nm: "Movie", ic: "▶", sub: "scene.movie", kind: "scene" },
  { id: "goodnight", nm: "Goodnight", ic: "☾", sub: "scene.goodnight", kind: "scene" },
  { id: "all_off", nm: "All off", ic: "○", sub: "scene.all_off", kind: "scene" },
];

function SceneTile({ s, firing, onFire }) {
  // useEntity(undefined) is a no-op (classic scenes have no stateEntity).
  const live = useEntity(s.stateEntity);
  const active = !!s.stateEntity && live?.state === "on";
  const toggleable = s.kind === "script-toggle" || s.kind === "pair";
  return (
    <button
      className={`scene ${s.id} ${firing ? "firing" : ""} ${active ? "active" : ""}`}
      onClick={() => onFire(s, active)}
      aria-pressed={toggleable ? active : undefined}
    >
      <div className="scene-ic">{s.ic}</div>
      <div>
        <div className="scene-nm">{s.nm}</div>
        <div className="scene-sub">{active ? (s.kind === "script-toggle" ? "Running · tap to stop" : "On · tap to undo") : s.sub}</div>
      </div>
      {toggleable && <span className={`scene-dot ${active ? "on" : ""}`} aria-hidden="true" />}
    </button>
  );
}

export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);

  async function fire(s, active) {
    setFiring(s.id);
    try {
      if (s.kind === "script-toggle") {
        // runs if idle, cancels if already running
        await callService("script", "toggle", { entity_id: `script.${s.id}` });
      } else if (s.kind === "pair") {
        await callService("script", "turn_on", { entity_id: `script.${active ? s.offId : s.id}` });
      } else {
        await callService("scene", "turn_on", { entity_id: `scene.${s.id}` });
      }
    } catch (e) {
      console.warn("[scenes] failed", s.id, e);
    }
    setTimeout(() => setFiring(null), 1100);
  }

  return (
    <Card index={index} eyebrow={`Scenes · ${SCENES.length} tiles`} title="Quick scenes" meta={firing ? `Running · ${firing}` : "Idle"}>
      <div className="scenes-grid">
        {SCENES.map((s) => (
          <SceneTile key={s.id} s={s} firing={firing === s.id} onFire={fire} />
        ))}
      </div>
    </Card>
  );
}
