import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { StatBox } from "../../components/StatBox.jsx";

export function BambuStatBox({ index = 0 }) {
  const PREFIX = "x1c_00m09d522400385";
  const { entity: liveProg, status } = useEntityStatus(`sensor.${PREFIX}_print_progress`);
  const liveRem = useEntity(`sensor.${PREFIX}_remaining_time`);
  const liveStage = useEntity(`sensor.${PREFIX}_current_stage`);
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId={`sensor.${PREFIX}_print_progress`} /></Card>;
  const prog = Number(liveProg?.state ?? 0);
  const rem = Number(liveRem?.state ?? 0);
  const file = liveProg?.attributes?.file_name || "—";
  const stage = liveStage?.state ?? "—";
  const idle = !rem && (stage === "idle" || stage === "unknown");
  return (
    <StatBox
      index={index}
      eyebrow="Bambu X1C"
      value={idle ? "idle" : prog}
      unit={idle ? null : "%"}
      caption={idle ? stage : `${(file || "").slice(0, 16)} · ${rem}m`}
      pct={idle ? 0 : prog}
      color="var(--accent-2)"
    />
  );
}

export function LevoitStatBox({ index = 0 }) {
  const { entity: liveQ, status } = useEntityStatus("sensor.core_300s_series_air_quality");
  const livePm = useEntity("sensor.core_300s_series_pm2_5");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.core_300s_series_air_quality" /></Card>;
  const q = liveQ?.state ?? "—";
  const pm = Number(livePm?.state ?? 0);
  const pct = Math.max(0, Math.min(100, Math.round(100 - (pm / 35) * 100)));
  return (
    <StatBox
      index={index}
      eyebrow="Levoit · air"
      value={q}
      caption={`PM 2.5 · ${pm} µg`}
      pct={pct}
      color={pm < 12 ? "var(--good)" : pm < 35 ? "var(--accent-2)" : "var(--bad)"}
    />
  );
}

export function VacuumStatBox({ index = 0 }) {
  const { entity: liveBat, status } = useEntityStatus("sensor.roborock_s8_battery");
  const liveStatus = useEntity("sensor.roborock_s8_status");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.roborock_s8_battery" /></Card>;
  const bat = Number(liveBat?.state ?? 0);
  const vStatus = liveStatus?.state ?? "docked";
  return (
    <StatBox
      index={index}
      eyebrow="Gregory · vacuum"
      value={bat}
      unit="%"
      caption={vStatus ? `${vStatus[0].toUpperCase()}${vStatus.slice(1)}` : "Docked"}
      pct={bat}
      color={bat >= 90 ? "var(--good)" : bat >= 30 ? "var(--accent-2)" : "var(--bad)"}
    />
  );
}

export function AdGuardStatBox({ index = 0 }) {
  const { entity: liveRatio, status } = useEntityStatus("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  if (status !== "ready") return <Card index={index} className="statbox"><EntityGuard status={status} entityId="sensor.adguard_home_dns_queries_blocked_ratio" /></Card>;
  const ratio = Number(liveRatio?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const total = Number(liveTotal?.state ?? 0);
  return (
    <StatBox
      index={index}
      eyebrow="AdGuard"
      value={ratio.toFixed(1)}
      unit="%"
      caption={`${blocked.toLocaleString()} / ${total.toLocaleString()}`}
      pct={ratio}
      color="var(--bad)"
    />
  );
}
