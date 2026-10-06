import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { PI_DISK_GIB } from "../../cards/system/PiCard.jsx";

const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);
const fmtGiB = (v) => (v == null ? "—" : v >= 1 ? `${v.toFixed(1)} GiB` : `${(v * 1024).toFixed(0)} MiB`);

export function StorageCard({ index = 0 }) {
  const { entity: diskUsed, status: diskStatus } = useEntityStatus("sensor.system_monitor_disk_use");
  const configUsed = useEntity("sensor.system_monitor_disk_use_config");
  const backupSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const totalGiB = PI_DISK_GIB;
  const usedRaw = numOr(diskUsed?.state, null);
  const configRaw = numOr(configUsed?.state, null);
  // Unknown stays unknown. These used to default to 0, so an unavailable disk
  // sensor drew a bar 100% "Free" and a legend of System 0 MiB / Free 220 GiB.
  const usedGiB = usedRaw != null ? Math.min(totalGiB, Math.max(0, usedRaw)) : null;
  const configGiB = usedGiB != null && configRaw != null ? Math.min(usedGiB, Math.max(0, configRaw)) : null;
  const freeGiB = usedGiB != null ? totalGiB - usedGiB : null;
  // Without a config reading the used space can't be split, so it is one
  // "Used" slice rather than a "System" slice quietly holding config too.
  const split = configGiB != null;
  const systemGiB = usedGiB != null ? (split ? usedGiB - configGiB : usedGiB) : null;

  // Backups live in an S3 bucket, not on the SSD — the entity is namespaced by
  // the bucket, not a mount point. They were a fourth slice, which made the bar
  // sum to totalGiB + backups and clipped "Free". (Even if they were local they
  // would already be counted inside system_monitor_disk_use.) Legend only.
  const backupMiB = numOr(backupSize?.state, null);
  const backupGiB = backupMiB != null ? backupMiB / 1024 : null;

  // The drawn slices sum to exactly totalGiB. `.storage-bar` is a flex row with a
  // 2px gap and flex-shrink: 0, so each basis gives back its share of the gaps
  // — otherwise the row overflows the track and the tail segment is cut off.
  const legendSegments = [
    { label: split || usedGiB == null ? "System" : "Used", value: systemGiB, color: "var(--accent)" },
    { label: "Config", value: configGiB, color: "var(--accent-2)" },
    { label: "Free", value: freeGiB, color: "var(--glass-stroke)" },
  ];
  // Only measured slices are drawn; no disk reading at all draws none (the
  // hatched "unknown" track in system-cards.css).
  const segments = usedGiB == null ? [] : legendSegments.filter((s) => s.value != null);
  const gapShare = segments.length ? (2 * (segments.length - 1)) / segments.length : 0;
  // max() keeps an empty segment from producing a negative flex-basis, which
  // would invalidate the whole `flex` shorthand. min-width: 2px still applies.
  const basis = (v) => `max(0px, ${(v / totalGiB) * 100}% - ${gapShare}px)`;

  // The label stays short on purpose: `.storage-legend` is a fixed 1fr 1fr grid, and
  // anything longer than "Backups" wraps to two lines at ≤360px and drags its value
  // onto two lines with it. The hollow dot and the tooltip carry the off-device fact.
  const legend = [
    ...legendSegments,
    { label: "Backups", value: backupGiB, offDevice: true, title: "Backups live in S3, not on the SSD" },
  ];

  return (
    <Card
      index={index}
      eyebrow={`Storage · ${usedRaw != null ? usedGiB.toFixed(1) : "—"} / ${totalGiB} GiB used`}
      title="Disk breakdown"
    >
      <EntityGuard status={diskStatus} entityId="sensor.system_monitor_disk_use">
      <div
        className={`storage-bar${segments.length ? "" : " unknown"}`}
        title={segments.length ? undefined : "Disk use unavailable"}
      >
        {segments.map((s) => (
          <span
            key={s.label}
            style={{ "--p": basis(s.value), background: s.color }}
            title={`${s.label}: ${s.value.toFixed(2)} GiB`}
          />
        ))}
      </div>
      <div className="storage-legend">
        {legend.map((s) => (
          <div key={s.label} className="storage-legend-item" title={s.title}>
            <span
              className="storage-dot"
              style={s.offDevice ? { background: "transparent", border: "1px solid var(--ink-3)" } : { background: s.color }}
            />
            <span className="storage-label">{s.label}</span>
            <span className="storage-val">{fmtGiB(s.value)}</span>
          </div>
        ))}
      </div>
      </EntityGuard>
    </Card>
  );
}
