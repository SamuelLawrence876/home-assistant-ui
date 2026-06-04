import { useState, useEffect } from "react";
import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";

/* ----------------------------------------------------------------
   AdGuard — full card (with ring + filtering toggle)
   ----------------------------------------------------------------*/
export function AdGuardCard({ index = 0 }) {
  const { entity: liveRatio, status: adgStatus } = useEntityStatus("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveProt = useEntity("switch.adguard_home_protection");
  const liveFilt = useEntity("switch.adguard_home_filtering");
  const ratio = Number(liveRatio?.state ?? 0);
  const total = Number(liveTotal?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const [prot, setProt] = useState(liveProt?.state === "on");
  const [filt, setFilt] = useState(liveFilt?.state === "on");
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  useEffect(() => { if (liveFilt) setFilt(liveFilt.state === "on"); }, [liveFilt?.state]);

  const C = 2 * Math.PI * 90;
  const offset = C * (1 - ratio / 100);

  return (
    <Card
      index={index}
      eyebrow="Network · AdGuard Home"
      title="Filtering"
      meta={prot ? "Protected" : "Disabled"}
      headRight={<div className={`toggle ${prot ? "on" : ""}`} onClick={() => {
        const next = !prot; setProt(next);
        callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
      }} role="switch" />}
    >
      <EntityGuard status={adgStatus} entityId="sensor.adguard_home_dns_queries_blocked_ratio">
      <div className="adg-body">
        <div className="purifier-ring">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" className="bg" />
            <circle
              cx="100"
              cy="100"
              r="90"
              className="fg"
              strokeDasharray={C}
              strokeDashoffset={offset}
              style={{ stroke: "var(--bad)" }}
            />
          </svg>
          <div className="purifier-num">
            <div>
              <div className="label">Blocked</div>
              <div className="big">
                {ratio.toFixed(1)}
                <span style={{ fontSize: "0.45em", color: "var(--bad)" }}>%</span>
              </div>
              <div className="sub">last 24h</div>
            </div>
          </div>
        </div>
        <div className="adg-info">
          <div className="h">
            <b>{blocked.toLocaleString()}</b> of {total.toLocaleString()} queries blocked today.
          </div>
          <div className="adg-cap">
            <div>
              <div className="k">Queries</div>
              <div className="v">{total.toLocaleString()}</div>
            </div>
            <div>
              <div className="k">Filtering</div>
              <div className="v good" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {filt ? "Active" : "Off"}
                <div
                  className={`toggle ${filt ? "on" : ""}`}
                  style={{ transform: "scale(0.85)" }}
                  onClick={() => {
                    const next = !filt; setFilt(next);
                    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_filtering" }).catch(() => setFilt(filt));
                  }}
                  role="switch"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      </EntityGuard>
    </Card>
  );
}

export function BlockedDomainsCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Top blocked domains · 24h" title="Loudest offenders">
      <div className="entity-warning">
        <span className="entity-warning-icon">{"⚠️"}</span>
        <span className="entity-warning-text">Needs AdGuard Home API integration</span>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------
   System — Pi health
   ----------------------------------------------------------------*/
// Pi 4 hardware constants used to render % bars. HA's system_monitor
// integration exposes used (GiB) but not %, so we compute from these.

/* ----------------------------------------------------------------
   Simple AdGuard
   ----------------------------------------------------------------*/
export function AdGuardSimpleCard({ index = 0 }) {
  const { entity: liveTotal, status: adgStatus } = useEntityStatus("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const liveRatio = useEntity("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveProt = useEntity("switch.adguard_home_protection");
  const total = Number(liveTotal?.state ?? 0);
  const blocked = Number(liveBlocked?.state ?? 0);
  const ratio = Number(liveRatio?.state ?? 0);
  const [prot, setProt] = useState(liveProt?.state === "on");
  useEffect(() => { if (liveProt) setProt(liveProt.state === "on"); }, [liveProt?.state]);
  function toggleProt() {
    const next = !prot;
    setProt(next);
    callService("switch", next ? "turn_on" : "turn_off", { entity_id: "switch.adguard_home_protection" }).catch(() => setProt(prot));
  }

  return (
    <Card index={index} eyebrow="Network · AdGuard" title="AdGuard" meta={prot ? "Live" : "Off"}>
      <EntityGuard status={adgStatus} entityId="sensor.adguard_home_dns_queries">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: prot ? "var(--good)" : "var(--ink-4)",
              boxShadow: prot ? "0 0 0 4px rgba(50, 160, 100, 0.18)" : "none",
              transition: "background 0.3s, box-shadow 0.3s",
            }}
          />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em" }}>
              {prot ? "Protected" : "Disabled"}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginTop: 2,
              }}
            >
              {ratio.toFixed(1)}% blocked · {blocked.toLocaleString()} / {total.toLocaleString()}
            </div>
          </div>
        </div>
        <div className={`toggle ${prot ? "on" : ""}`} onClick={toggleProt} role="switch" />
      </div>
      </EntityGuard>
    </Card>
  );
}
