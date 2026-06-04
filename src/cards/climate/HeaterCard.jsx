import { useState, useEffect } from "react";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Heater — Govee
   ----------------------------------------------------------------*/
export function HeaterCard({ index = 0 }) {
  const { entity: liveTarget, status: heaterStatus } = useEntityStatus("input_number.govee_heater_temperature");
  const roomTempEntity = useEntity("sensor.h5075_4fb6_temperature");
  const roomHumidity = useEntity("sensor.h5075_4fb6_humidity");

  const roomTempRaw = roomTempEntity?.state;
  const humRaw = roomHumidity?.state;
  const roomTempValid = roomTempRaw && roomTempRaw !== "unavailable" && roomTempRaw !== "unknown";
  const roomTemp = roomTempValid ? Number(roomTempRaw) : null;
  const humidity = humRaw && humRaw !== "unavailable" && humRaw !== "unknown" ? Number(humRaw) : null;

  const [target, setTarget] = useState(Number(liveTarget?.state ?? 20));
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (liveTarget) setTarget(Number(liveTarget.state));
  }, [liveTarget?.state]);

  function commitTemp(v) {
    setTarget(v);
    callService("input_number", "set_value", { entity_id: "input_number.govee_heater_temperature", value: v }).catch(() => {});
  }
  function toggleHeater() {
    const next = !on;
    setOn(next);
    callService("script", next ? "turn_on_govee_heater" : "turn_off_govee_heater", {}).catch(() => setOn(on));
  }
  const angle = Math.max(0, Math.min(270, ((target - 12) / 18) * 270));

  return (
    <Card
      index={index}
      eyebrow="Climate · Govee heater"
      title="Heater"
      meta={on ? `On · target ${target}°` : `Off · target ${target}°`}
    >
      <EntityGuard status={heaterStatus} entityId="input_number.govee_heater_temperature">
      <div className="heater-body">
        <div className="heater-controls-col">
          <div className="eyebrow" style={{ fontSize: 9 }}>Setpoint</div>
          <div className="heater-stepper">
            <button className="heater-step" onClick={() => commitTemp(Math.max(12, target - 1))}>−</button>
            <div className="heater-target-val">
              {target}<span className="u">°</span>
            </div>
            <button className="heater-step" onClick={() => commitTemp(Math.min(30, target + 1))}>+</button>
          </div>
          <div className="meta" style={{ marginTop: 8 }}>
            {roomTemp != null ? `Room is ${roomTemp}° · ${humidity ?? "—"}% humidity` : "Room sensor offline"}
          </div>
          <button
            className={`btn ${on ? "accent" : "primary"}`}
            onClick={toggleHeater}
            style={{ marginTop: 14, alignSelf: "flex-start" }}
          >
            {on ? "Turn off" : "Turn on"}
          </button>
        </div>
        <div className="heater-dial" style={{ "--ang": `${angle}deg` }}>
          <div className="heater-dial-inner">
            <div>
              <div className="set">Target</div>
              <div className="val">{target}°</div>
              <div className="act">{on ? "Heating" : "Unplugged"}</div>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
