import { useEntity, useEntityStatus } from "../../ha/useEntity.js";
import { Card } from "../../components/Card.jsx";
import { EntityGuard } from "../../components/EntityGuard.jsx";
import { ToggleSwitch } from "../../components/ToggleSwitch.jsx";
import { useOptimisticToggle } from "../../hooks/useOptimistic.js";

const numOr = (v, d) => (v != null && v !== "unavailable" && v !== "unknown" && !Number.isNaN(+v) ? +v : d);
const count = (n) => (n != null ? n.toLocaleString() : "—");

/* A switch HA can't reach. HA skips an unavailable target and still reports
   success, so a live toggle here used to flip to "Protected" over an AdGuard
   that was down. Loading is left alone: it is what mock mode and the
   screenshot harness render. */
const isDown = (status) => status === "unavailable" || status === "not_found";

/* ----------------------------------------------------------------
   AdGuard — full card (with ring + filtering toggle)
   ----------------------------------------------------------------*/
export function AdGuardCard({ index = 0 }) {
  const { entity: liveRatio, status: adgStatus } = useEntityStatus("sensor.adguard_home_dns_queries_blocked_ratio");
  const liveTotal = useEntity("sensor.adguard_home_dns_queries");
  const liveBlocked = useEntity("sensor.adguard_home_dns_queries_blocked");
  const { on: prot, status: protStatus, toggle: toggleProt } = useOptimisticToggle("switch.adguard_home_protection");
  const { on: filt, status: filtStatus, toggle: toggleFilt } = useOptimisticToggle("switch.adguard_home_filtering");
  const protDown = isDown(protStatus);
  const filtDown = isDown(filtStatus);
  const ratio = numOr(liveRatio?.state, null);
  const total = numOr(liveTotal?.state, null);
  const blocked = numOr(liveBlocked?.state, null);

  const C = 2 * Math.PI * 90;
  const offset = ratio != null ? C * (1 - ratio / 100) : C;

  return (
    <Card
      index={index}
      eyebrow="Network · AdGuard Home"
      title="Filtering"
      meta={protDown ? "Unavailable" : prot ? "Protected" : "Disabled"}
      headRight={
        <ToggleSwitch on={prot && !protDown} onToggle={toggleProt} disabled={protDown} label="AdGuard protection" />
      }
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
                {ratio != null ? ratio.toFixed(1) : "—"}
                <span style={{ fontSize: "0.45em", color: "var(--bad)" }}>%</span>
              </div>
              <div className="sub">last 24h</div>
            </div>
          </div>
        </div>
        <div className="adg-info">
          <div className="h">
            <b>{count(blocked)}</b> of {count(total)} queries blocked today.
          </div>
          <div className="adg-cap">
            <div>
              <div className="k">Queries</div>
              <div className="v">{count(total)}</div>
            </div>
            <div>
              <div className="k">Filtering</div>
              <div className="v good" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {filtDown ? "—" : filt ? "Active" : "Off"}
                {/* Was scale(0.85) — dropped, a 36x20 switch is under the
                    24x24 minimum target size and the row has room for both. */}
                <ToggleSwitch on={filt && !filtDown} onToggle={toggleFilt} disabled={filtDown} label="AdGuard filtering" />
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
  const { on: prot, status: protStatus, toggle: toggleProt } = useOptimisticToggle("switch.adguard_home_protection");
  const protDown = isDown(protStatus);
  const live = prot && !protDown;
  const total = numOr(liveTotal?.state, null);
  const blocked = numOr(liveBlocked?.state, null);
  const ratio = numOr(liveRatio?.state, null);

  return (
    <Card index={index} eyebrow="Network · AdGuard" title="AdGuard" meta={protDown ? "Unavailable" : live ? "Live" : "Off"}>
      <EntityGuard status={adgStatus} entityId="sensor.adguard_home_dns_queries">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: live ? "var(--good)" : "var(--ink-4)",
              boxShadow: live ? "0 0 0 4px rgba(50, 160, 100, 0.18)" : "none",
              transition: "background 0.3s, box-shadow 0.3s",
            }}
          />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em" }}>
              {protDown ? "Unavailable" : live ? "Protected" : "Disabled"}
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
              {ratio != null ? ratio.toFixed(1) : "—"}% blocked · {count(blocked)} / {count(total)}
            </div>
          </div>
        </div>
        <ToggleSwitch on={live} onToggle={toggleProt} disabled={protDown} label="AdGuard protection" />
      </div>
      </EntityGuard>
    </Card>
  );
}
