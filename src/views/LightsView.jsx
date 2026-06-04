import { GH_DATA } from "../data.js";
import { Card } from "../components/Card.jsx";
import { LightCard } from "../cards/lights/LightCard.jsx";
import { DeskStripCard } from "../cards/lights/DeskStripCard.jsx";

export default function LightsView() {
  return (
    <div className="grid">
      <div className="col-6"><LightCard index={0} entityId="light.living_room" /></div>
      <div className="col-6"><LightCard index={1} entityId="light.smartbulb_5c_h" /></div>
      <div className="col-6"><DeskStripCard index={2} /></div>
      <div className="col-6"><LightCard index={3} entityId="light.bathroom" /></div>
      {/* <div className="col-6"><PixooCard index={3} /></div> */}

      <div className="col-12">
        <Card index={4} eyebrow="Future · 4 flood lights" title="Flood lights · coming soon" meta="placeholder">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {["light.flood_1", "light.flood_2", "light.flood_3", "light.flood_4"].map((id) => {
              const l = GH_DATA.lights[id];
              return (
                <div
                  key={id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "color-mix(in oklch, var(--glass-bg-2), transparent 40%)",
                    border: "1px dashed var(--rule)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                    }}
                  >
                    {id}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>{l.attributes.friendly_name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>
                    not yet added
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
