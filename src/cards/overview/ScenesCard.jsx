import { useState } from "react";
import { useEntities, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Quick scenes
   ----------------------------------------------------------------
   Every tile is backed by a gh_* script on the Pi (see /config/scripts.yaml).
   The old scene.* snapshots were retired 2026-08-04: they pointed at Meross
   switches that no longer exist, so they reported success and did nothing.

   Two shapes:
   - "moment"  one script, runs and ends (sunrise fade, All off). State comes
               from the script entity, so the tile lights up while it runs and
               tapping again cancels it via script.toggle.
   - "mode"    a script pair, and state comes from input_boolean.gh_mode_*
               rather than from a device. That matters: the old Leaving tile
               read the air purifier to decide which way it pointed, so once
               the purifier went offline the tile was stuck showing "off" and
               the undo half was unreachable.

   Each tile also declares `deps` — the entities its script touches. When some
   of those are unreachable the tile says so instead of playing a confident
   animation for a scene that did half of nothing. Firing anyway is deliberate:
   the live half of a scene is still worth having.
   ----------------------------------------------------------------*/

const E = {
  BULB: "light.smartbulb_5c_h",
  DIFF: "light.smart_humidifier_2403124281557464110148e1e9eff28f",
  DIFF_DND: "light.smart_humidifier_2403124281557464110148e1e9eff28f_dnd",
  SPRAY: "select.smart_humidifier_2403124281557464110148e1e9eff28f_spray",
  CHAMBER: "light.x1c_00m09d522400385_chamber_light",
  CAMERA: "switch.x1c_00m09d522400385_camera",
  PLUG: "switch.sambox360_plug",
  PIXOO: "light.divoom_pixoo_64_light",
  PURIFIER: "fan.core_300s_series",
};

/* Short names for the offline tooltip. friendly_name is unavailable for an
   entity that has gone missing entirely, which is exactly the case we most
   need to name. */
const LABEL = {
  [E.BULB]: "Bedroom bulb",
  [E.DIFF]: "Diffuser lamp",
  [E.DIFF_DND]: "Diffuser night light",
  [E.SPRAY]: "Diffuser mist",
  [E.CHAMBER]: "Printer chamber light",
  [E.CAMERA]: "Printer camera",
  [E.PLUG]: "SamBox360 plug",
  [E.PIXOO]: "Pixoo 64",
  [E.PURIFIER]: "Air purifier",
};

const SCENES = [
  {
    id: "good_morning", nm: "Good Morning", ic: "☀", sub: "5-min sunrise",
    kind: "moment", script: "gh_good_morning",
    deps: [E.BULB, E.DIFF, E.SPRAY, E.PIXOO],
  },
  {
    /* Subs are capped at ~13 characters: .scene-sub ellipsises, and two tiles
       per row at 390px leaves 158px. Anything longer reads as "DESK ON - CO…". */
    id: "focus", nm: "Focus", ic: "◎", sub: "Desk on",
    kind: "mode", script: "gh_focus", offScript: "gh_focus_off",
    mode: "input_boolean.gh_mode_focus",
    deps: [E.PLUG, E.DIFF, E.SPRAY, E.CHAMBER, E.BULB],
  },
  {
    id: "work_done", nm: "Work Done!", ic: "✦", sub: "Colour flow",
    kind: "moment", script: "gh_work_done",
    deps: [E.BULB, E.DIFF],
  },
  {
    id: "movie", nm: "Movie", ic: "▶", sub: "Lights down",
    kind: "mode", script: "gh_movie", offScript: "gh_movie_off",
    mode: "input_boolean.gh_mode_movie",
    deps: [E.BULB, E.DIFF, E.CHAMBER, E.CAMERA, E.PLUG],
  },
  {
    id: "leaving", nm: "Leaving", ic: "→", sub: "Purifier full",
    kind: "mode", script: "gh_leaving", offScript: "gh_leaving_off",
    mode: "input_boolean.gh_mode_leaving",
    deps: [E.BULB, E.DIFF, E.PIXOO, E.CHAMBER, E.SPRAY, E.PURIFIER],
  },
  {
    id: "goodnight", nm: "Goodnight", ic: "☾", sub: "Night light",
    kind: "mode", script: "gh_goodnight", offScript: "gh_goodnight_off",
    mode: "input_boolean.gh_mode_goodnight",
    deps: [E.BULB, E.DIFF, E.DIFF_DND, E.CHAMBER, E.SPRAY, E.PURIFIER],
  },
  {
    id: "all_off", nm: "All off", ic: "○", sub: "Hard kill",
    kind: "moment", script: "gh_all_off",
    deps: [E.BULB, E.DIFF, E.DIFF_DND, E.PIXOO, E.CHAMBER, E.CAMERA, E.SPRAY, E.PURIFIER],
  },
];

/* Union of every entity any tile touches, for the card header count. */
const ALL_DEPS = [...new Set(SCENES.flatMap((s) => s.deps))];

const isDown = (e) => !e || e.state === "unavailable" || e.state === "unknown";

function SceneTile({ s, firing, onFire }) {
  // Moments read their script entity ("on" while running); modes read their
  // bookkeeping boolean. Either way "on" means the tile is lit.
  const stateId = s.kind === "mode" ? s.mode : `script.${s.script}`;
  const { entity: live, status } = useEntityStatus(stateId);
  const depStates = useEntities(s.deps);

  const active = live?.state === "on";
  // Before the WS snapshot lands every entity looks missing — don't accuse
  // the house of being offline while we're still connecting.
  const offline = status === "loading" ? [] : s.deps.filter((id) => isDown(depStates[id]));
  const degraded = offline.length > 0 && !active;

  const sub = active
    ? s.kind === "moment" ? "Running · tap to stop" : "On · tap to undo"
    : degraded ? `${offline.length}/${s.deps.length} offline`
    : s.sub;

  const offlineNames = offline.map((id) => LABEL[id] || id).join(", ");

  return (
    <button
      className={`scene ${s.id} ${firing ? "firing" : ""} ${active ? "active" : ""} ${degraded ? "degraded" : ""}`}
      onClick={() => onFire(s, active)}
      aria-pressed={active}
      title={degraded ? `Offline: ${offlineNames}` : undefined}
      aria-label={degraded ? `${s.nm} — ${offline.length} of ${s.deps.length} devices offline: ${offlineNames}` : undefined}
    >
      <div className="scene-ic">{s.ic}</div>
      <div>
        <div className="scene-nm">{s.nm}</div>
        <div className="scene-sub">{sub}</div>
      </div>
      {s.kind === "mode" && <span className={`scene-dot ${active ? "on" : ""}`} aria-hidden="true" />}
    </button>
  );
}

export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  const allStates = useEntities(ALL_DEPS);
  const { status } = useEntityStatus(ALL_DEPS[0]);
  const downCount = status === "loading" ? 0 : ALL_DEPS.filter((id) => isDown(allStates[id])).length;

  async function fire(s, active) {
    setFiring(s.id);
    let ok = true;
    try {
      if (s.kind === "moment") {
        // Runs if idle, cancels if already running.
        await callService("script", "toggle", { entity_id: `script.${s.script}` });
      } else {
        await callService("script", "turn_on", {
          entity_id: `script.${active ? s.offScript : s.script}`,
        });
      }
    } catch {
      // client.js broadcasts to onServiceError, which App.jsx turns into a
      // toast — so drop the animation rather than implying it worked.
      ok = false;
      setFiring(null);
    }
    if (ok) setTimeout(() => setFiring(null), 1100);
  }

  return (
    <Card
      index={index}
      eyebrow={`Scenes · ${SCENES.length} tiles`}
      title="Quick scenes"
      meta={firing ? "Running" : downCount ? `${downCount} devices offline` : "Idle"}
    >
      <div className="scenes-grid">
        {SCENES.map((s) => (
          <SceneTile key={s.id} s={s} firing={firing === s.id} onFire={fire} />
        ))}
      </div>
    </Card>
  );
}
