import { Card } from "../../components/Card.jsx";
import { rgbStr } from "../../cards/lights/colorUtils.js";
import { useOptimisticToggle } from "../../hooks/useOptimistic.js";

/* ----------------------------------------------------------------
   Quick toggles (Overview)
   ----------------------------------------------------------------*/
function QuickToggle({ entityId }) {
  const { entity: e, status, on, toggle: doToggle } = useOptimisticToggle(entityId, "light");
  const unavailable = status === "unavailable" || status === "not_found";
  const initRgb = e?.attributes?.rgb_color || [255, 198, 130];
  if (status === "loading") return <div className="entity-loading" style={{ borderRadius: 14, minHeight: 52 }} />;
  function toggle() {
    if (unavailable) return;
    doToggle();
  }
  return (
    <button
      onClick={toggle}
      disabled={unavailable}
      style={{
        background: "var(--glass-bg-2)",
        border: "1px solid var(--glass-stroke)",
        borderRadius: 14,
        padding: "12px 14px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "center",
        gap: 12,
        fontFamily: "inherit",
        color: "var(--ink)",
        textAlign: "left",
        transition: "background 0.3s ease, transform 0.2s ease",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: on
            ? `radial-gradient(circle at 35% 35%, white, ${rgbStr(initRgb)} 60%, ${rgbStr([
                Math.max(0, initRgb[0] - 60),
                Math.max(0, initRgb[1] - 60),
                Math.max(0, initRgb[2] - 60),
              ])} 100%)`
            : "color-mix(in oklch, var(--ink), transparent 88%)",
          boxShadow: on ? `0 0 14px ${rgbStr(initRgb)}55` : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{e?.attributes?.friendly_name || entityId.split(".")[1]}</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginTop: 2,
          }}
        >
          {unavailable ? "Unavailable" : on ? "On" : "Off"}
        </div>
      </div>
      <div className={`toggle ${on && !unavailable ? "on" : ""}`} style={{ transform: "scale(0.8)", transformOrigin: "right center", opacity: unavailable ? 0.4 : 1 }} />
    </button>
  );
}

export function QuickLightsCard({ index = 0 }) {
  return (
    <Card index={index} eyebrow="Quick · favorite lights" title="Lights at hand">
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        <QuickToggle entityId="light.smartbulb_5c_h" />
        <QuickToggle entityId="light.living_room" />
        <QuickToggle entityId="light.desk_strip" />
      </div>
    </Card>
  );
}
