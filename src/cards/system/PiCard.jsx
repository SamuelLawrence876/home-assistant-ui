import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

const PI_RAM_MIB = 4096;     // Pi 4 model B has 4 GB RAM
export const PI_DISK_GIB = 220;     // 220 GB SSD (df -h /  →  219.4G total)

const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);
const pct = (v) => (v != null ? `${v}%` : "0%");   // never "--p: NaN%"

export function PiCard({ index = 0 }) {
  const { entity: liveCpu, status: piStatus } = useEntityStatus("sensor.system_monitor_processor_use");
  const liveMem = useEntity("sensor.system_monitor_memory_use");
  const liveTemp = useEntity("sensor.system_monitor_processor_temperature");
  const liveDisk = useEntity("sensor.system_monitor_disk_use_config");
  const cpu = numOr(liveCpu?.state, null);
  const memMiB = numOr(liveMem?.state, null);
  const memPct = memMiB != null ? (memMiB / PI_RAM_MIB) * 100 : null;
  const temp = numOr(liveTemp?.state, null);
  const diskGiB = numOr(liveDisk?.state, null);
  const diskPct = diskGiB != null ? (diskGiB / PI_DISK_GIB) * 100 : null;

  // Health summary derived from the worst metric. Don't claim "all healthy"
  // when every system_monitor sensor is missing — that reads as a clean bill.
  const health =
    [cpu, memPct, temp, diskPct].every((v) => v == null)
      ? "no readings"
      : temp >= 75 || cpu >= 90 || memPct >= 90 || diskPct >= 90
        ? "degraded"
        : temp >= 65 || cpu >= 70 || memPct >= 75 || diskPct >= 80
          ? "warm"
          : "all healthy";

  return (
    <Card index={index} eyebrow="System · raspberry_pi" title="Pi health" meta={health}>
      <EntityGuard status={piStatus} entityId="sensor.system_monitor_processor_use">
      <div className="pi-rows">
        <div className="pi-row">
          <span className="k">CPU</span>
          <div className="bar"><span style={{ "--p": pct(cpu) }} /></div>
          <span className="v">{cpu != null ? `${cpu}%` : "—"}</span>
        </div>
        <div className="pi-row">
          <span className="k">Memory</span>
          <div className="bar"><span style={{ "--p": pct(memPct) }} /></div>
          <span className="v">{memMiB != null ? `${memMiB.toFixed(0)} MiB` : "—"}</span>
        </div>
        <div className={`pi-row ${temp >= 65 ? "warn" : ""}`}>
          <span className="k">Temp</span>
          <div className="bar"><span style={{ "--p": pct(temp != null ? (temp / 80) * 100 : null) }} /></div>
          <span className="v">{temp != null ? `${temp}°C` : "—"}</span>
        </div>
        <div className="pi-row">
          <span className="k">Disk</span>
          <div className="bar"><span style={{ "--p": pct(diskPct) }} /></div>
          <span className="v">{diskGiB != null ? `${diskGiB.toFixed(1)} GiB` : "—"}</span>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}

// Returns "today · 15:30", "yesterday · 04:00", "in 2 days · 03:47", etc.
// Falls back to the raw string if it isn't parseable (so mock strings still render).
