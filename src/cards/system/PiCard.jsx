import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

const PI_RAM_MIB = 4096;     // Pi 4 model B has 4 GB RAM
export const PI_DISK_GIB = 220;     // 220 GB SSD (df -h /  →  219.4G total)

export function PiCard({ index = 0 }) {
  const { entity: liveCpu, status: piStatus } = useEntityStatus("sensor.system_monitor_processor_use");
  const liveMem = useEntity("sensor.system_monitor_memory_use");
  const liveTemp = useEntity("sensor.system_monitor_processor_temperature");
  const liveDisk = useEntity("sensor.system_monitor_disk_use_config");
  const cpu = Number(liveCpu?.state ?? 0);
  const memMiB = Number(liveMem?.state ?? 0);
  const memPct = (memMiB / PI_RAM_MIB) * 100;
  const temp = Number(liveTemp?.state ?? 0);
  const diskGiB = Number(liveDisk?.state ?? 0);
  const diskPct = (diskGiB / PI_DISK_GIB) * 100;

  // Health summary derived from the worst metric.
  const health =
    temp >= 75 || cpu >= 90 || memPct >= 90 || diskPct >= 90
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
          <div className="bar"><span style={{ "--p": `${cpu}%` }} /></div>
          <span className="v">{cpu}%</span>
        </div>
        <div className="pi-row">
          <span className="k">Memory</span>
          <div className="bar"><span style={{ "--p": `${memPct}%` }} /></div>
          <span className="v">{memMiB.toFixed(0)} MiB</span>
        </div>
        <div className={`pi-row ${temp >= 65 ? "warn" : ""}`}>
          <span className="k">Temp</span>
          <div className="bar"><span style={{ "--p": `${(temp / 80) * 100}%` }} /></div>
          <span className="v">{temp}°C</span>
        </div>
        <div className="pi-row">
          <span className="k">Disk</span>
          <div className="bar"><span style={{ "--p": `${diskPct}%` }} /></div>
          <span className="v">{diskGiB.toFixed(1)} GiB</span>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}

// Returns "today · 15:30", "yesterday · 04:00", "in 2 days · 03:47", etc.
// Falls back to the raw string if it isn't parseable (so mock strings still render).
