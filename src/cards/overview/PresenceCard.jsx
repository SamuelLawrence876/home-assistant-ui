import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Presence
   ----------------------------------------------------------------*/
export function PresenceCard({ index = 0 }) {
  const { entity: p, status: pStatus } = useEntityStatus("person.samuel_lawrence");
  const home = p?.state === "home";
  return (
    <Card index={index} eyebrow="Presence · person.samuel_lawrence">
      <EntityGuard status={pStatus} entityId="person.samuel_lawrence">
      <div className="presence-row">
        <div className="presence-avatar">S</div>
        <div className="presence-info">
          <div className="nm">{p?.attributes?.friendly_name || "Samuel"}</div>
          <div className="where">
            {home ? "Home" : p?.state === "not_home" ? "Away" : p?.state}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`presence-badge ${home ? "home" : "away"}`}>
            {home ? "Home" : "Away"}
          </span>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
