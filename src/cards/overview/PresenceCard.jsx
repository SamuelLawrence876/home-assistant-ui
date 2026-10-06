import { useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   Presence

   "We don't know where he is" and "he is out" are different facts. A
   person.* entity reads "unknown" when no tracker has reported yet (and
   "unavailable" when the entity itself is down); both come back from
   useEntityStatus as not-ready, and EntityGuard still renders the body
   behind its warning badge — so the badge has to say Unknown, not fall
   through to Away. A named zone ("Work") is a real answer and stays Away.
   ----------------------------------------------------------------*/
export function PresenceCard({ index = 0 }) {
  const { entity: p, status: pStatus } = useEntityStatus("person.samuel_lawrence");
  const known = pStatus === "ready";
  const home = known && p.state === "home";
  const where = !known ? "—" : home ? "Home" : p.state === "not_home" ? "Away" : p.state;
  const badge = !known ? "unknown" : home ? "home" : "away";
  return (
    <Card index={index} eyebrow="Presence · person.samuel_lawrence">
      <EntityGuard status={pStatus} entityId="person.samuel_lawrence">
      <div className="presence-row">
        <div className="presence-avatar">S</div>
        <div className="presence-info">
          <div className="nm">{p?.attributes?.friendly_name || "Samuel"}</div>
          <div className="where">{where}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`presence-badge ${badge}`}>
            {!known ? "Unknown" : home ? "Home" : "Away"}
          </span>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}
