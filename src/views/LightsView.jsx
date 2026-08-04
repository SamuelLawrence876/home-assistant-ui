import { Card } from "../components/Card.jsx";
import { LightCard } from "../cards/lights/LightCard.jsx";
import { DeskStripCard } from "../cards/lights/DeskStripCard.jsx";

/* Hardware that doesn't exist yet — these ids have no HA entity, so there is
   nothing to subscribe to. Held as plain labels rather than read out of
   data.js: views/ must not import the mock (CLAUDE.md), and reaching into
   GH_DATA.lights[id].attributes meant a trimmed mock would crash this tab. */
const FLOOD_PLACEHOLDERS = [
  { id: "light.flood_1", name: "Flood · front porch" },
  { id: "light.flood_2", name: "Flood · driveway" },
  { id: "light.flood_3", name: "Flood · back yard" },
  { id: "light.flood_4", name: "Flood · side gate" },
];

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
          {/* auto-fit, not repeat(4, …): a grid item's min-width is its content,
              and the mono entity id can't wrap, so four fixed columns refuse to
              shrink below ~478px and push the whole page sideways on a phone.
              With four items auto-fit still collapses to exactly four columns
              once the card is wide enough. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {FLOOD_PLACEHOLDERS.map(({ id, name }) => {
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
                      // --ink-4 measures 2.3–2.9:1 on this tile in every lean,
                      // well under AA for 9px text; --ink-3 clears it and the
                      // size + tracking still separate this from the name.
                      color: "var(--ink-3)",
                    }}
                  >
                    {id}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>{name}</div>
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
