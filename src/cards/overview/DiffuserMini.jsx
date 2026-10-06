import { useState, useEffect, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { DIFFUSER, DEFAULT_RGB, rgbCss, nearestColorName, knownState, unknownWord, sprayOptions, sprayPhase } from "../../lib/diffuser.js";

/* ----------------------------------------------------------------
   Overview quick-control strip — glanceable mist + LED. Compact
   sibling of the SamBox360 "Play" tile; pairs with it in the
   bottom row (col-5 next to the col-7 Play strip).
   Meross Smart Essential Oil Diffuser (meross_lan): mist is a
   select (off/eco/on), LED is an rgb light.

   An offline diffuser (every entity "unavailable") used to read as a green
   "On · Spraying · unavailable", because `mode !== "off"` was the whole test.
   knownState() gates both halves: unknown says so, and its controls are
   disabled rather than sending commands into the void.

   A live state that isn't one of the select's modes is a third case, not
   "off": it used to read a confident "Off · Standby" for a spray mode the
   card didn't recognise. sprayPhase() keeps the three apart, and the
   segments are the select's own options, so a mode meross_lan adds is a
   button rather than a mystery.

   There is no mock fallback. The data.js mock used to stand in until HA
   answered, so a signed-out or never-connected dashboard read a green
   "On · Spraying · eco · ocean" with live buttons. Before HA answers, and
   through a dropped connection, both halves read "—" and their controls are
   disabled.
   ----------------------------------------------------------------*/
export function DiffuserMini({ index = 0 }) {
  const { entity: liveSpray, status: sprayStatus } = useEntityStatus(DIFFUSER.spray);
  const { entity: liveLed, status: ledStatus } = useEntityStatus(DIFFUSER.light);
  const sprayKnown = knownState(sprayStatus);
  const ledKnown = knownState(ledStatus);

  const [mode, setMode] = useState(sprayKnown ? liveSpray.state : null);
  const [rgb, setRgb] = useState(liveLed?.attributes?.rgb_color || DEFAULT_RGB);
  const [lightOn, setLightOn] = useState(ledKnown && liveLed.state === "on");

  // Resync from HA only. `*Known` is in the lists so a diffuser coming back
  // from a dropout re-reads its state even when nothing changed meanwhile.
  useEffect(() => { if (sprayKnown) setMode(liveSpray.state); }, [sprayKnown, liveSpray?.state]);
  useEffect(() => { if (ledKnown) setLightOn(liveLed.state === "on"); }, [ledKnown, liveLed?.state]);
  useEffect(() => { if (liveLed?.attributes?.rgb_color) setRgb(liveLed.attributes.rgb_color); }, [liveLed?.attributes?.rgb_color?.join()]);

  const options = sprayOptions(liveSpray);
  const phase = sprayKnown ? sprayPhase(mode, options) : null;
  const misting = phase === "spraying";
  const ledOn = ledKnown && lightOn;
  const led = ledOn ? rgbCss(rgb) : "var(--ink-4)";
  const statusColor = misting ? "var(--good)" : "var(--ink-4)";
  const ledPending = ledStatus === "loading";
  // An unrecognised mode is shown as HA reported it — neither Off nor On.
  const mistText = !sprayKnown ? (sprayStatus === "loading" ? "Mist —" : "Mist unavailable")
    : misting ? `Spraying · ${mode}`
    : phase === "unrecognised" ? `Mist: ${mode}`
    : "Standby";
  const sub = !sprayKnown && !ledKnown ? unknownWord(sprayStatus)
    : mistText
      + `${!ledKnown ? ` · LED ${ledPending ? "—" : "unavailable"}` : lightOn ? ` · ${nearestColorName(rgb).toLowerCase()}` : " · LED off"}`;

  // Revert from HA's truth at failure time rather than the value captured at
  // click time: the resync effects above only fire on a *changed* state, so a
  // stale revert would stick.
  const sprayRef = useRef(liveSpray);
  sprayRef.current = liveSpray;
  const ledRef = useRef(liveLed);
  ledRef.current = liveLed;

  function changeMode(m) {
    const prev = mode;
    setMode(m);
    callService("select", "select_option", { entity_id: DIFFUSER.spray, option: m })
      .catch(() => setMode(sprayRef.current?.state ?? prev));
  }
  function toggleLight() {
    const next = !lightOn;
    setLightOn(next);
    callService("light", next ? "turn_on" : "turn_off", { entity_id: DIFFUSER.light })
      .catch(() => setLightOn(ledRef.current ? ledRef.current.state === "on" : !next));
  }

  return (
    <Card
      index={index}
      eyebrow="Diffuser · bedroom"
      title="Mist"
      className="diffuser-mini-card"
      style={{ "--led": led }}
      headRight={
        <span className="gs-status" style={{ "--gs-color": statusColor }}>
          <span className="d" />{!sprayKnown ? unknownWord(sprayStatus) : misting ? "On" : phase === "off" ? "Off" : "—"}
        </span>
      }
    >
      <div className="dmini-body">
        <div className="dmini-id">
          <div className={`dmini-orb ${ledOn ? "" : "off"}`} />
          <div style={{ minWidth: 0 }}>
            <div className="nm">Oil diffuser</div>
            <div className="sub">{sub}</div>
          </div>
        </div>

        <div className="dmini-mist">
          <div className="diff-seg" role="group" aria-label="Mist mode">
            {options.map((m) => (
              <button key={m} className={sprayKnown && mode === m ? "on" : ""} aria-pressed={sprayKnown && mode === m}
                disabled={!sprayKnown} onClick={() => changeMode(m)}>{m}</button>
            ))}
          </div>
        </div>

        <div className="dmini-ledrow">
          <span className="k">LED light</span>
          <span className="dmini-led">
            <span className={`w ${ledOn ? "lit" : ""}`}>{!ledKnown ? unknownWord(ledStatus) : lightOn ? "On" : "Off"}</span>
            {/* role="switch" has no "unknown", so the real state goes in the name. */}
            <ToggleSwitch on={ledOn} onToggle={toggleLight} disabled={!ledKnown}
              label={ledKnown ? "Diffuser LED" : `Diffuser LED — ${ledPending ? "not reported yet" : "unavailable"}`} />
          </span>
        </div>
      </div>
    </Card>
  );
}
