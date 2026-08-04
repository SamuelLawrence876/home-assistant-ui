import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Uptime
   ----------------------------------------------------------------*/
export function UptimeCard({ index = 0 }) {
  const { entity: live, status: uptimeStatus } = useEntityStatus("sensor.uptime");
  // "unavailable"/"unknown" parse to an Invalid Date, which turns every
  // figure below into NaN — treat it as no reading instead.
  const started = new Date(live?.state ?? "");
  const valid = !Number.isNaN(started.getTime());
  const diffMs = valid ? Date.now() - started.getTime() : 0;
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));

  return (
    <Card index={index} eyebrow="Uptime · sensor.uptime" title="Up since">
      <EntityGuard status={uptimeStatus} entityId="sensor.uptime">
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 44,
          fontWeight: 300,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontFeatureSettings: "'tnum'",
        }}
      >
        {valid ? (
          <>
            {days}
            <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>d</span>{" "}
            {hours}
            <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>h</span>{" "}
            {minutes}
            <span style={{ fontSize: 18, color: "var(--ink-3)", fontWeight: 400, marginLeft: 4 }}>m</span>
          </>
        ) : "—"}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          marginTop: 8,
          letterSpacing: "0.04em",
        }}
      >
        {valid
          ? `Since ${started.toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "sensor.uptime has no reading"}
      </div>
      </EntityGuard>
    </Card>
  );
}
