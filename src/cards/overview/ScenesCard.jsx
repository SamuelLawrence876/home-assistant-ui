import { useState } from "react";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Scenes
   ----------------------------------------------------------------*/
export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  const scenes = [
    { id: "morning", nm: "Morning", ic: "◑", sub: "scene.morning" },
    { id: "movie", nm: "Movie", ic: "▶", sub: "scene.movie" },
    { id: "goodnight", nm: "Goodnight", ic: "☾", sub: "scene.goodnight" },
    { id: "all_off", nm: "All off", ic: "○", sub: "scene.all_off" },
  ];
  async function run(id) {
    setFiring(id);
    try {
      await callService("scene", "turn_on", { entity_id: `scene.${id}` });
    } catch (e) {
      console.warn("[scenes] failed", id, e);
    }
    setTimeout(() => setFiring(null), 1100);
  }
  return (
    <Card index={index} eyebrow="Scenes · 4 scripts" title="Quick scenes" meta={firing ? `Running · ${firing}` : "Idle"}>
      <div className="scenes-grid">
        {scenes.map((s) => (
          <button key={s.id} className={`scene ${s.id} ${firing === s.id ? "firing" : ""}`} onClick={() => run(s.id)}>
            <div className="scene-ic">{s.ic}</div>
            <div>
              <div className="scene-nm">{s.nm}</div>
              <div className="scene-sub">{s.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
