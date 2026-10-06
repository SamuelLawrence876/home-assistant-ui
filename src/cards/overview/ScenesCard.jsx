import { useState, useRef } from "react";
import { useEntities, useEntityStatus, useConnectionStatus } from "../../ha/useEntity.js";
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
               a tap on the lit tile cancels it (script.turn_off). Never
               script.toggle: a toggle decides from HA's state at arrival, so
               the second tap of a double-tap cancelled the run the first one
               had just started.
   - "mode"    a script pair, and state comes from input_boolean.gh_mode_*
               rather than from a device. That matters: the old Leaving tile
               read the air purifier to decide which way it pointed, so once
               the purifier went offline the tile was stuck showing "off" and
               the undo half was unreachable.

   Each tile also declares `deps` — the entities its script touches. When some
   of those are unreachable the tile says so instead of playing a confident
   animation for a scene that did half of nothing. Firing anyway is deliberate:
   the live half of a scene is still worth having.

   A tile whose own state HA isn't vouching for right now takes no taps and
   claims nothing — the lib/diffuser.js#knownState rule. "loading" covers
   connecting, signed out and a dropped connection, and the socket keeps its
   last states through a drop, so reading them lit Focus "On · tap to undo"
   through an outage and sent its undo into a dead socket. A missing or
   unavailable script / mode boolean is the same: the tile can't tell run
   from undo, and HA reports success for a missing target anyway.
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

function SceneTile({ s, firing, busyWord, onFire }) {
  // Moments read their script entity ("on" while running); modes read their
  // bookkeeping boolean. Either way "on" means the tile is lit.
  const stateId = s.kind === "mode" ? s.mode : `script.${s.script}`;
  const { entity: live, status } = useEntityStatus(stateId);
  const depStates = useEntities(s.deps);

  // Unknown (see the header) is neither lit nor unlit: no state, no taps.
  const known = status === "ready";
  const active = known && live.state === "on";
  // Before the WS snapshot lands every entity looks missing — don't accuse
  // the house of being offline while we're still connecting.
  const offline = known ? s.deps.filter((id) => isDown(depStates[id])) : [];
  const degraded = offline.length > 0 && !active;

  // A busy tile drops taps (see fire()), so it says what it is doing instead
  // of inviting one with "tap to stop" / "tap to undo".
  const sub = !known ? (status === "loading" ? "—" : "Unavailable")
    : busyWord ? busyWord
    : active ? s.kind === "moment" ? "Running · tap to stop" : "On · tap to undo"
    : degraded ? `${offline.length}/${s.deps.length} offline`
    : s.sub;

  const offlineNames = offline.map((id) => LABEL[id] || id).join(", ");
  const label = !known ? `${s.nm} — ${status === "loading" ? "state unknown" : "unavailable"}`
    : degraded && !busyWord ? `${s.nm} — ${offline.length} of ${s.deps.length} devices offline: ${offlineNames}`
    : undefined;

  return (
    <button
      type="button"
      className={`scene ${s.id} ${firing ? "firing" : ""} ${active ? "active" : ""} ${degraded ? "degraded" : ""}`}
      onClick={() => { if (known) onFire(s, active); }}
      aria-pressed={known ? active : undefined}
      // aria-disabled, not disabled: a focused tile that turned disabled when
      // the connection dropped would throw keyboard focus onto <body>.
      aria-disabled={known ? undefined : true}
      title={degraded ? `Offline: ${offlineNames}` : undefined}
      aria-label={label}
    >
      <div className="scene-ic">{s.ic}</div>
      <div>
        <div className="scene-nm">{s.nm}</div>
        <div className="scene-sub">{sub}</div>
      </div>
      {s.kind === "mode" && known && <span className={`scene-dot ${active ? "on" : ""}`} aria-hidden="true" />}
    </button>
  );
}

const FIRING_MS = 1100;
// A failed call drops the sweep at once, but the guard stays up until this
// long after the tap: released at a fast rejection, it let the double-tap's
// second half send the call — and raise the error toast — a second time.
const DOUBLE_TAP_MS = 400;

export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  // Tiles whose call is in flight or whose firing sweep is still showing. A
  // tap on one of those is the second half of a double-tap, not a new
  // decision, so it is dropped. A ref, not state: the second click can land
  // before React has re-rendered with the first one's `firing`.
  const busy = useRef(new Set());
  // What each busy tile says meanwhile. Under latency HA's "on" lands before
  // the call returns, and the tile used to read "Running · tap to stop" for
  // seconds while silently dropping exactly that tap.
  const [busyWords, setBusyWords] = useState({});
  const allStates = useEntities(ALL_DEPS);
  const { status } = useEntityStatus(ALL_DEPS[0]);
  const conn = useConnectionStatus();
  const downCount = status === "loading" ? 0 : ALL_DEPS.filter((id) => isDown(allStates[id])).length;

  // `active` is what the tile showed when it was tapped, so the call matches
  // the words on it: "Running · tap to stop" stops, anything else starts.
  function fire(s, active) {
    if (busy.current.has(s.id)) return;
    busy.current.add(s.id);
    const say = (word) => setBusyWords((w) => {
      const next = { ...w };
      if (word) next[s.id] = word;
      else delete next[s.id];
      return next;
    });
    say(!active ? "Starting…" : s.kind === "moment" ? "Stopping…" : "Undoing…");
    setFiring(s.id);
    // Only clear our own sweep — another tile may have fired since.
    const unsweep = () => setFiring((f) => (f === s.id ? null : f));
    const release = () => {
      busy.current.delete(s.id);
      say(null);
      unsweep();
    };
    let failed = false;
    let tapWindow = true;
    setTimeout(() => { tapWindow = false; if (failed) release(); }, DOUBLE_TAP_MS);
    const target = s.kind === "moment" ? s.script : active ? s.offScript : s.script;
    const service = s.kind === "moment" && active ? "turn_off" : "turn_on";
    callService("script", service, { entity_id: `script.${target}` }).then(
      () => setTimeout(release, FIRING_MS),
      // client.js broadcasts to onServiceError, which App.jsx turns into a
      // toast — so drop the animation rather than implying it worked, and
      // free the tile for a retry once the double-tap window has closed.
      () => {
        failed = true;
        unsweep();
        if (tapWindow) say("Failed");
        else release();
      },
    );
  }

  // "loading" is connecting, signed out or dropped: no tile knows its state,
  // so the card doesn't claim "Idle" either.
  const meta = status === "loading" ? (conn === "ready" ? "—" : "Not connected")
    : firing ? "Running" : downCount ? `${downCount} devices offline` : "Idle";

  return (
    <Card
      index={index}
      eyebrow={`Scenes · ${SCENES.length} tiles`}
      title="Quick scenes"
      meta={meta}
    >
      <div className="scenes-grid">
        {SCENES.map((s) => (
          <SceneTile key={s.id} s={s} firing={firing === s.id} busyWord={busyWords[s.id]} onFire={fire} />
        ))}
      </div>
    </Card>
  );
}
