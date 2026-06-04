import { useState } from "react";
import { formatRelativeIso, formatMiB } from "../../lib/format.js";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

export function BackupCard({ index = 0 }) {
  const { entity: liveLast, status: backupStatus } = useEntityStatus("sensor.backup_last_successful_automatic_backup");
  const liveNext = useEntity("sensor.backup_next_scheduled_automatic_backup");
  const liveState = useEntity("sensor.backup_backup_manager_state");
  const liveSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const lastDisplay = formatRelativeIso(liveLast?.state);
  const nextDisplay = formatRelativeIso(liveNext?.state);
  const managerState = liveState?.state || "idle";
  const sizeDisplay = liveSize ? formatMiB(liveSize.state) : "—";
  const liveRunning = managerState !== "idle" && managerState !== "unknown" && managerState !== "unavailable";

  // Local optimistic progress bar — the real backup runs server-side via
  // backup.create_automatic; we don't wait for it. The manager_state sensor
  // reflects actual progress and is shown in the "Status" row.
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);

  function runBackup() {
    if (running || liveRunning) return;
    callService("backup", "create_automatic", {}).catch(() => {});
    setRunning(true);
    setPct(0);
    let p = 0;
    const id = setInterval(() => {
      p += 4 + Math.random() * 6;
      if (p >= 100) {
        p = 100;
        clearInterval(id);
        setPct(100);
        setTimeout(() => {
          setRunning(false);
          setPct(0);
        }, 600);
      } else {
        setPct(p);
      }
    }, 220);
  }

  const buttonRunning = running || liveRunning;
  const buttonLabel = liveRunning
    ? `Backup ${managerState}`
    : running
      ? `Backing up · ${Math.round(pct)}%`
      : "Backup now";

  return (
    <Card
      index={index}
      eyebrow="Backup · automatic + manual"
      title="Backups"
      headRight={
        <button
          className={`btn ${buttonRunning ? "" : "primary"}`}
          onClick={runBackup}
          disabled={buttonRunning}
          style={{ opacity: buttonRunning ? 0.7 : 1 }}
        >
          {buttonLabel}
        </button>
      }
    >
      <EntityGuard status={backupStatus} entityId="sensor.backup_last_successful_automatic_backup">
      {running && (
        <div className="progress" style={{ marginBottom: 12 }}>
          <span style={{ "--p": `${pct}%` }} />
        </div>
      )}
      <div className="kv">
        <span className="k">Last</span>
        <span className="v">{lastDisplay}</span>
        <span className="k">Next</span>
        <span className="v">{nextDisplay}</span>
        <span className="k">Status</span>
        <span className="v">{managerState}</span>
        <span className="k">Total stored</span>
        <span className="v">{sizeDisplay}</span>
      </div>
      </EntityGuard>
    </Card>
  );
}
