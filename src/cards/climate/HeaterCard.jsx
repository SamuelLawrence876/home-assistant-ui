import { useState, useEffect, useRef } from "react";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { numOr } from "../../lib/format.js";

/* ----------------------------------------------------------------
   Heater — Govee H713B.

   The heater is reached only through two fire-and-forget cloud scripts,
   script.turn_on_govee_heater / script.turn_off_govee_heater. The one
   read-back is sensor.govee_heater_power, polled from Govee's cloud, so the
   power shown here is whatever that sensor last said. When it can't say —
   'error' (Govee answered without a usable state), unavailable, not created,
   or the link sensor reporting the heater offline — power is unknown and
   reads "—", never "Off". This card used to hold power in local state that
   started at false, so every mount said "Off" / "Unplugged" whatever the
   heater was doing.

   A press is shown as sent-and-waiting, not as the new state: the sensor's
   next report ends the wait, whatever it says, and PRESS_WINDOW_MS caps it
   if the report never comes. A press for the state the sensor already
   reads ends when the script call returns — HA doesn't bump last_updated
   when a poll re-reads the same state, so otherwise "Turning off…" sat
   over an off heater for the whole window. Both buttons are offered
   whatever the reading says, because a possibly-stale reading is no
   reason to block either command — but not while Govee reports the heater
   offline: that is not a stale reading, and the command can't reach it.

   There is deliberately no target-temperature control.
   input_number.govee_heater_temperature exists, but nothing sends it to the
   heater (script.set_govee_heater_temperature uses a command the H713B does
   not support and has never run), so a stepper here was a thermostat that
   did nothing. Re-add one when a script actually delivers the value.
   ----------------------------------------------------------------*/
const HEATER = {
  power: "sensor.govee_heater_power",
  link: "sensor.govee_heater_link",
  maxRuntime: "timer.govee_heater_max_runtime",
};
const PRESS_WINDOW_MS = 2 * 60_000;

// HH:MM from an ISO timestamp HA supplied, or null — never "Invalid Date".
const clockOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
};

export function HeaterCard({ index = 0 }) {
  const { entity: livePower, status: powerStatus } = useEntityStatus(HEATER.power);
  const { entity: liveLink, status: linkStatus } = useEntityStatus(HEATER.link);
  const liveTimer = useEntity(HEATER.maxRuntime);
  const roomTempEntity = useEntity("sensor.h5075_4fb6_temperature");
  const roomHumidity = useEntity("sensor.h5075_4fb6_humidity");

  const roomTemp = numOr(roomTempEntity?.state, null);
  const humidity = numOr(roomHumidity?.state, null);

  const offline = linkStatus === "ready" && liveLink.state === "offline";
  const reported = powerStatus === "ready" ? livePower.state : null;
  // An offline heater's last reading can't be refreshed, so it isn't shown as current.
  const power = !offline && (reported === "on" || reported === "off") ? reported : null;
  const autoOff = liveTimer?.state === "active";
  const autoOffAt = autoOff ? clockOf(liveTimer.attributes?.finishes_at) : null;

  const [press, setPress] = useState(null); // "on" | "off" while a script call awaits the sensor
  // Any fresh report ends the wait, whatever it says.
  useEffect(() => { setPress(null); }, [livePower?.state, livePower?.last_updated]);
  useEffect(() => {
    if (!press) return undefined;
    const t = setTimeout(() => setPress(null), PRESS_WINDOW_MS);
    return () => clearTimeout(t);
  }, [press]);

  // The reading when a script call returns, not when it was sent.
  const powerRef = useRef(power);
  powerRef.current = power;

  function send(want) {
    setPress(want);
    // Only this press's wait is ended: a newer press for the other state keeps its own.
    const endIf = (done) => setPress((p) => (p === want && done() ? null : p));
    callService("script", want === "on" ? "turn_on_govee_heater" : "turn_off_govee_heater", {})
      // Already reads what was asked for: there is no report left to wait for.
      .then(() => endIf(() => powerRef.current === want))
      // The error log already records the failure (client.js); the card just stops waiting.
      .catch(() => endIf(() => true));
  }

  const meta = powerStatus === "loading" ? "—"
    : offline ? "Offline"
    : press ? (press === "on" ? "Turning on…" : "Turning off…")
    : power === "on" ? "On" : power === "off" ? "Off" : "Power unknown";
  const note = offline ? "Govee reports the heater offline"
    : press ? `${press === "on" ? "Turn on" : "Turn off"} sent · waiting for the heater to report`
    : reported === "error" ? "Govee answered without a power state"
    : null;
  // The timer outlives an off made at the device or in the Govee app, so an
  // auto-off time is only shown while the heater reads on.
  const act = offline ? "Offline"
    : power == null ? "Unknown"
    : power === "off" ? "Standby"
    : autoOff ? (autoOffAt ? `Auto-off ${autoOffAt}` : "Auto-off armed")
    : "Running";

  return (
    <Card index={index} eyebrow="Climate · Govee heater" title="Heater" meta={meta}>
      <EntityGuard status={powerStatus} entityId={HEATER.power}>
      <div className="heater-body">
        <div className="heater-controls-col">
          <div className="eyebrow" style={{ fontSize: 9 }}>Room</div>
          <div className="heater-room-val">
            {roomTemp != null ? <>{roomTemp}<span className="u">°</span></> : "—"}
          </div>
          <div className="meta" style={{ marginTop: 8 }}>
            {roomTemp != null ? `${humidity ?? "—"}% humidity` : "Room sensor offline"}
          </div>
          {note && <div className="meta" style={{ marginTop: 4 }}>{note}</div>}
          <div className="heater-controls">
            <button className="btn primary" disabled={offline} onClick={() => send("on")}>Turn on</button>
            <button className="btn" disabled={offline} onClick={() => send("off")}>Turn off</button>
          </div>
        </div>
        <div className="heater-dial" style={{ "--ang": `${power === "on" ? 270 : 0}deg` }}>
          <div className="heater-dial-inner">
            <div>
              <div className="set">Power</div>
              <div className="val">{power === "on" ? "On" : power === "off" ? "Off" : "—"}</div>
              <div className="act">{act}</div>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
