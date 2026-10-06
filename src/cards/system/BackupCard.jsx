import { useState, useEffect } from "react";
import { formatRelativeIso, formatMiB } from "../../lib/format.js";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

// How long "Backup failed" stays on the button before it offers a retry.
export const FAILED_MS = 6000;

export function BackupCard({ index = 0 }) {
  const { entity: liveLast, status: backupStatus } = useEntityStatus("sensor.backup_last_successful_automatic_backup");
  const liveNext = useEntity("sensor.backup_next_scheduled_automatic_backup");
  const liveState = useEntity("sensor.backup_backup_manager_state");
  const liveSize = useEntity("sensor.bucket_sam_ha_backups_total_size_of_backups");

  const lastDisplay = formatRelativeIso(liveLast?.state);
  const nextDisplay = formatRelativeIso(liveNext?.state);
  // No sensor is "we don't know", not "idle".
  const managerState = liveState?.state ?? null;
  const sizeDisplay = liveSize ? formatMiB(liveSize.state) : "—";
  const liveRunning =
    managerState != null && managerState !== "idle" && managerState !== "unknown" && managerState !== "unavailable";

  /* There used to be a progress bar here: a random setInterval that counted
     to 100% in ~3.5s whatever the backup did — through a rejected call, or
     while the real backup still had minutes to go. Nothing measures a
     percentage, so nothing shows one. The button says what we actually know:
     the request is out ("Starting…"), the manager's real state once it moves,
     or that the call failed. backup.create_automatic resolves only when the
     backup has finished; the "Last" row moving is the proof of success. */
  const [phase, setPhase] = useState(null); // null | "starting" | "failed"

  useEffect(() => {
    // The manager's own state has taken over from our guess.
    if (liveRunning && phase === "starting") setPhase(null);
  }, [liveRunning, phase]);

  useEffect(() => {
    if (phase !== "failed") return undefined;
    const id = setTimeout(() => setPhase(null), FAILED_MS);
    return () => clearTimeout(id);
  }, [phase]);

  function runBackup() {
    if (phase === "starting" || liveRunning) return;
    setPhase("starting");
    callService("backup", "create_automatic", {})
      .then(() => setPhase(null))
      .catch(() => setPhase("failed"));
  }

  const buttonBusy = phase === "starting" || liveRunning;
  const buttonLabel = liveRunning
    ? `Backup ${managerState}`
    : phase === "starting"
      ? "Starting…"
      : phase === "failed"
        ? "Backup failed · retry"
        : "Backup now";

  return (
    <Card
      index={index}
      eyebrow="Backup · automatic + manual"
      title="Backups"
      headRight={
        <button
          className={`btn ${buttonBusy || phase === "failed" ? "" : "primary"}`}
          onClick={runBackup}
          disabled={buttonBusy}
          style={{ opacity: buttonBusy ? 0.7 : 1 }}
        >
          {buttonLabel}
        </button>
      }
    >
      <EntityGuard status={backupStatus} entityId="sensor.backup_last_successful_automatic_backup">
      <div className="kv">
        <span className="k">Last</span>
        <span className="v">{lastDisplay}</span>
        <span className="k">Next</span>
        <span className="v">{nextDisplay}</span>
        <span className="k">Status</span>
        <span className="v">{managerState ?? "—"}</span>
        <span className="k">Total stored</span>
        <span className="v">{sizeDisplay}</span>
      </div>
      </EntityGuard>
    </Card>
  );
}
