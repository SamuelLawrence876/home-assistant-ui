import { useState, useEffect } from "react";
import { GH_DATA } from "../../data.js";
import { useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Fan
   ----------------------------------------------------------------*/
export function FanCard({ index = 0 }) {
  const { entity: live, status: fanStatus } = useEntityStatus("fan.ceiling");
  const unavailable = fanStatus === "unavailable" || fanStatus === "not_found";
  // Mock fallback — missing entity still renders as a normal-looking card,
  // EntityGuard's corner badge flags the problem.
  const e = live || GH_DATA.fans["fan.ceiling"];
  const [on, setOn] = useState(e?.state === "on");
  const [pct, setPct] = useState(e?.attributes?.percentage || 0);
  const presets = e?.attributes?.preset_modes || ["sleep", "low", "medium", "high"];
  const [preset, setPreset] = useState(e?.attributes?.preset_mode);
  useEffect(() => {
    if (!live) return;
    setOn(live.state === "on");
    if (live.attributes?.percentage != null) setPct(live.attributes.percentage);
    if (live.attributes?.preset_mode) setPreset(live.attributes.preset_mode);
  }, [live?.state, live?.attributes?.percentage, live?.attributes?.preset_mode]);

  function toggleFan() {
    if (unavailable) return;
    const next = !on;
    setOn(next);
    callService("fan", next ? "turn_on" : "turn_off", { entity_id: "fan.ceiling" }).catch(() => setOn(on));
  }
  function pick(p) {
    if (unavailable) return;
    setPreset(p);
    setOn(true);
    setPct(p === "sleep" ? 25 : p === "low" ? 40 : p === "medium" ? 65 : 100);
    callService("fan", "set_preset_mode", { entity_id: "fan.ceiling", preset_mode: p }).catch(() => {});
  }

  return (
    <Card
      index={index}
      eyebrow="Fan · fan.ceiling"
      title="Ceiling fan"
      meta={on ? `${preset || "manual"} · ${pct}%` : "Off"}
      headRight={<div className={`toggle ${on ? "on" : ""}`} onClick={toggleFan} role="switch" />}
    >
      <EntityGuard status={fanStatus} entityId="fan.ceiling">
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 4 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--glass-bg-2)",
            border: "1px solid var(--glass-stroke)",
            display: "grid",
            placeItems: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              position: "relative",
              animation: on ? `fanspin ${Math.max(0.4, 3 - pct / 40)}s linear infinite` : "none",
            }}
          >
            {[0, 60, 120].map((d) => (
              <div
                key={d}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 3,
                  height: 28,
                  background: "var(--ink-2)",
                  borderRadius: 3,
                  transformOrigin: "center bottom",
                  transform: `translate(-50%, -100%) rotate(${d}deg)`,
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 8,
                height: 8,
                background: "var(--ink)",
                borderRadius: "50%",
                transform: "translate(-50%, -50%)",
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>Speed</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p} className={`preset ${preset === p ? "on" : ""}`} onClick={() => pick(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
