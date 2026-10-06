import { useState, useEffect, useMemo, useRef } from "react";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { useRangeCommit } from "../../hooks/useRangeCommit.js";
import { rgbStr, kelvinToRgb } from "../../cards/lights/colorUtils.js";
import { PresetSwatches } from "./presets.jsx";
import { parseGoveeProps } from "./goveeUtils.js";

/* ----------------------------------------------------------------
   Desk strip — Govee H6159 (cloud API via rest_command)
   State synced from sensor.desk_strip_state (REST polling).

   Until that sensor has reported (still connecting, sensor missing, the
   Govee poll failed) the card has no strip state to show — and a
   confident "Off" beside a live switch is the dead-plug-looks-off
   conflation SamBoxStrip was rewritten to remove. So: em-dash or
   "Unavailable", every control disabled, nothing sent. Likewise when the
   sensor is fine but Govee says the strip itself is offline (unplugged,
   off Wi-Fi): its powerState is then only the last thing it said, and a
   command goes nowhere — "Offline", same treatment.
   ----------------------------------------------------------------*/
const ENTITY = "sensor.desk_strip_state";

const GOVEE_GAP = 2000;
// After sending a command, ask HA to re-poll the Govee cloud so the card can
// correct itself if the strip didn't take the value we optimistically showed.
const VERIFY_DELAY = 3000;
// Upper bound on how long the card ignores incoming sensor pushes after the
// user touches something (the poll is slow, so stale values arrive mid-drag).
// scheduleVerify releases the freeze early — this is only the safety net.
const RESYNC_FREEZE = 8000;
// Colour and colour temperature drive the same physical property, so they
// supersede each other; brightness and power are independent.
const CMD_KIND = { color: "color", color_temp: "color", brightness: "brightness", turn: "turn" };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const GOVEE_PRESETS = [
  { id: "warm", label: "Warm 2200K", rgb: [255, 170, 110], kelvin: 2200 },
  { id: "amber", label: "Amber 2700K", rgb: [255, 198, 130], kelvin: 2700 },
  { id: "neutral", label: "Neutral 4000K", rgb: [255, 235, 200], kelvin: 4000 },
  { id: "cool", label: "Cool 5500K", rgb: [220, 235, 255], kelvin: 5500 },
  { id: "red", label: "Red", rgb: [255, 0, 0] },
  { id: "orange", label: "Orange", rgb: [255, 100, 0] },
  { id: "green", label: "Forest", rgb: [0, 255, 50] },
  { id: "blue", label: "Blue", rgb: [0, 50, 255] },
  { id: "purple", label: "Purple", rgb: [150, 0, 255] },
  { id: "pink", label: "Pink", rgb: [255, 0, 150] },
];

export function DeskStripCard({ index = 0 }) {
  const { entity: live, status } = useEntityStatus(ENTITY);
  const hw = useMemo(() => parseGoveeProps(live?.attributes), [live?.attributes?.properties]);
  // Only an explicit `online: false` counts; a payload without the field is
  // read as before.
  const offline = status === "ready" && hw.online === false;
  const known = status === "ready" && !offline;

  const [on, setOn] = useState(false);
  // null = the strip hasn't reported it and nobody has set it here, so the
  // readout is an em-dash (and no swatch is pressed) rather than a made-up
  // 100% / 2700K / Amber.
  const [bright, setB] = useState(null);
  const [rgb, setRgb] = useState(null);
  const [kelvin, setKelvin] = useState(null);
  const userActedAt = useRef(0);
  const lastCmdTime = useRef(0);
  const cmdQueue = useRef(Promise.resolve());
  // One counter per command kind, not one global counter: "latest wins" should
  // only apply within a kind, otherwise a brightness drag started a moment
  // after a colour tap cancels the colour command that is still waiting out
  // the rate limit — and the card goes on showing a colour never sent.
  const cmdEpoch = useRef({});
  const verifyTimer = useRef(null);
  // Commands handed to the queue but not finished with. The queue is serial and
  // rate-limited, so an earlier command's verify timer can come due while a
  // later one is still waiting out the gap or in flight.
  const inFlight = useRef(0);
  // Bumped when the verify refresh comes back. Without it the effect below
  // re-runs only when a reported value *changes*, so a refresh that returned
  // what the strip already had (the command didn't take) — or a poll that
  // landed inside the freeze and was skipped — never corrected the optimistic
  // value, and the card went on showing a brightness the strip wasn't at.
  const [resyncTick, setResyncTick] = useState(0);
  useEffect(() => () => clearTimeout(verifyTimer.current), []);

  useEffect(() => {
    if (!known) return;
    if (Date.now() - userActedAt.current < RESYNC_FREEZE) return;
    setOn(hw.power ? hw.power === "on" : live.state === "on");
    if (hw.brightness != null) setB(hw.brightness);
    if (hw.color) setRgb(hw.color);
    if (hw.kelvin != null) {
      setKelvin(hw.kelvin);
      if (!hw.color) setRgb(kelvinToRgb(hw.kelvin));
    }
  }, [known, live?.state, hw.power, hw.brightness, hw.color?.join(","), hw.kelvin, resyncTick]);

  function scheduleVerify() {
    clearTimeout(verifyTimer.current);
    verifyTimer.current = setTimeout(() => {
      // Another command is still queued or in flight. Lifting the freeze now
      // would let a poll taken before it landed write the pre-command value
      // back into the slider; that command's own finally reschedules us.
      if (inFlight.current > 0) return;
      // Lift the resync freeze first, or the refresh we are about to ask for
      // lands inside it and gets thrown away — leaving the card stuck on the
      // optimistic value until the next slow poll.
      userActedAt.current = 0;
      // Then re-apply whatever HA holds once the refresh is back, changed or
      // not — "unchanged" is exactly the case where the card is wrong.
      callService("homeassistant", "update_entity", { entity_id: ENTITY })
        .catch(() => {})
        .finally(() => setResyncTick((t) => t + 1));
    }, VERIFY_DELAY);
  }

  function govee(cmd, data) {
    userActedAt.current = Date.now();
    const kind = CMD_KIND[cmd] || cmd;
    const epoch = (cmdEpoch.current[kind] = (cmdEpoch.current[kind] || 0) + 1);
    inFlight.current += 1;
    const p = cmdQueue.current.then(async () => {
      try {
        if (cmdEpoch.current[kind] !== epoch) return;
        const wait = GOVEE_GAP - (Date.now() - lastCmdTime.current);
        if (wait > 0) await delay(wait);
        if (cmdEpoch.current[kind] !== epoch) return;
        lastCmdTime.current = Date.now();
        try {
          await callService("rest_command", `govee_desk_strip_${cmd}`, data);
        } finally {
          // Verify on failure too — that is exactly when the card is wrong.
          scheduleVerify();
        }
      } finally {
        inFlight.current -= 1;
      }
    });
    cmdQueue.current = p.catch(() => {});
    return p;
  }

  function toggle() {
    if (!known) return;
    const next = !on;
    setOn(next);
    govee("turn", { value: next ? "on" : "off" }).catch(() => setOn(!next));
  }

  function commitBrightness(v) {
    if (!known) return;
    setB(v);
    if (!on) return;
    govee("brightness", { value: v }).catch(() => {});
  }

  function pickColor(p) {
    if (!known) return;
    const wasOff = !on;
    if (wasOff) setOn(true);
    if (p.kelvin) {
      setKelvin(p.kelvin);
      setRgb(kelvinToRgb(p.kelvin));
      const send = () => govee("color_temp", { value: p.kelvin });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    } else {
      setRgb(p.rgb);
      const send = () => govee("color", { r: p.rgb[0], g: p.rgb[1], b: p.rgb[2] });
      wasOff ? govee("turn", { value: "on" }).then(send).catch(() => {}) : send().catch(() => {});
    }
  }

  function commitKelvin(v) {
    if (!known) return;
    setKelvin(v);
    setRgb(kelvinToRgb(v));
    if (!on) return;
    govee("color_temp", { value: v }).catch(() => {});
  }
  // Both sliders send through useRangeCommit: the native change event, which
  // pointer release, a keyboard step and an assistive-tech adjust all fire.
  const brightRef = useRangeCommit(commitBrightness);
  const kelvinRef = useRangeCommit(commitKelvin);

  // What the strip is doing, as far as anyone knows. Local `on` survives a
  // dropout, but nothing on screen may claim it while the sensor is down.
  const lit = known && on;
  const pending = status === "loading";
  const shownBright = known ? bright : null;
  const shownKelvin = known ? kelvin : null;
  // Orb paint for a lit strip that reported no colour. Decoration only —
  // never handed to the swatches as the strip's colour.
  const paint = rgb || [255, 198, 130];
  const why = pending ? "not reported yet" : offline ? "offline" : "unavailable";
  const meta = !known
    ? pending ? "—" : offline ? "Offline" : "Unavailable"
    : on ? (bright != null ? `On · ${bright}%` : "On") : "Off";

  const glow = lit
    ? `0 0 24px ${rgbStr(paint)}33, 0 0 80px ${rgbStr(paint)}1f`
    : "none";

  return (
    <Card
      index={index}
      eyebrow="Light · Govee H6159"
      title="Desk strip"
      meta={meta}
      headRight={
        <ToggleSwitch
          on={lit}
          onToggle={toggle}
          disabled={!known}
          // role="switch" has no "unknown", so the real state goes in the name.
          label={known ? "Desk strip" : `Desk strip — ${why}`}
        />
      }
    >
      <EntityGuard status={status} entityId={ENTITY}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 1fr",
          gap: 18,
          alignItems: "center",
          marginTop: 4,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: lit
              ? `radial-gradient(circle at 32% 32%, white 0%, ${rgbStr(paint)} 55%, ${rgbStr([
                  Math.max(0, paint[0] - 60),
                  Math.max(0, paint[1] - 60),
                  Math.max(0, paint[2] - 60),
                ])} 100%)`
              : "color-mix(in oklch, var(--ink), transparent 88%)",
            boxShadow: glow,
            transition: "background 0.3s ease, box-shadow 0.4s ease",
            border: "1px solid var(--glass-stroke)",
          }}
        />
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>Brightness</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {shownBright != null ? `${shownBright}%` : "—"}
            </span>
          </div>
          <input
            ref={brightRef}
            type="range"
            min="0"
            max="100"
            step="1"
            value={shownBright ?? 0}
            disabled={!lit}
            onChange={(ev) => setB(Number(ev.target.value))}
            aria-label="Desk strip brightness"
            // A range input always holds some number; when the strip hasn't
            // reported one, say so rather than announce the parked thumb.
            aria-valuetext={shownBright != null ? `${shownBright}%` : "unknown"}
            className="gh-slider"
            style={{ width: "100%", accentColor: lit ? rgbStr(paint) : "var(--ink-4)" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>Color temperature</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
            {shownKelvin != null ? `${shownKelvin}K` : "—"}
          </span>
        </div>
        <input
          ref={kelvinRef}
          type="range"
          min={2000}
          max={9000}
          step="100"
          value={shownKelvin ?? 2000}
          disabled={!lit}
          onChange={(ev) => { setKelvin(Number(ev.target.value)); setRgb(kelvinToRgb(Number(ev.target.value))); }}
          aria-label="Desk strip color temperature"
          aria-valuetext={shownKelvin != null ? `${shownKelvin}K` : "unknown"}
          className="gh-slider"
          style={{
            width: "100%",
            background: lit
              ? `linear-gradient(to right, rgb(255,147,41), rgb(255,198,130), rgb(255,235,200), rgb(220,235,255))`
              : "var(--glass-bg-2)",
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Color · curated</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <PresetSwatches presets={GOVEE_PRESETS} rgb={known ? rgb : null} onPick={pickColor} targetName="Desk strip" disabled={!known} />
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
