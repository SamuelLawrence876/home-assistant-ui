import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { PI_DISK_GIB } from "../../cards/system/PiCard.jsx";

export function StorageCard({ index = 0 }) {
  const { entity: diskUsed, status: diskStatus } = useEntityStatus("sensor.system_monitor_disk_use");
  const configUsed = useEntity("sensor.system_monitor_disk_use_config");
  const backupSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const totalGiB = PI_DISK_GIB;
  const usedGiB = Number(diskUsed?.state ?? 0);
  const freeGiB = totalGiB - usedGiB;
  const configGiB = Number(configUsed?.state ?? 0);
  const backupGiB = Number(backupSize?.state ?? 0) / 1024;
  const systemGiB = Math.max(0, usedGiB - configGiB);

  const segments = [
    { label: "System", value: systemGiB, color: "var(--accent)" },
    { label: "Config", value: configGiB, color: "var(--accent-2)" },
    { label: "Backups", value: backupGiB, color: "var(--ink-2)" },
    { label: "Free", value: freeGiB, color: "var(--glass-stroke)" },
  ];

  return (
    <Card index={index} eyebrow={`Storage · ${usedGiB.toFixed(1)} / ${totalGiB} GiB used`} title="Disk breakdown">
      <EntityGuard status={diskStatus} entityId="sensor.system_monitor_disk_use">
      <div className="storage-bar">
        {segments.map((s) => (
          <span
            key={s.label}
            style={{ "--p": `${(s.value / totalGiB) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value.toFixed(2)} GiB`}
          />
        ))}
      </div>
      <div className="storage-legend">
        {segments.map((s) => (
          <div key={s.label} className="storage-legend-item">
            <span className="storage-dot" style={{ background: s.color }} />
            <span className="storage-label">{s.label}</span>
            <span className="storage-val">
              {s.value >= 1 ? `${s.value.toFixed(1)} GiB` : `${(s.value * 1024).toFixed(0)} MiB`}
            </span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}
