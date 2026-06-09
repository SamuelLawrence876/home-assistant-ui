import { useState } from "react";
import { callService } from "../../ha/client.js";
import { Card } from "../../components/Card.jsx";

/* ----------------------------------------------------------------
   Scenes
   ----------------------------------------------------------------*/
export function ScenesCard({ index = 0 }) {
  const [firing, setFiring] = useState(null);
  // `domain` selects which HA service backs the tile. The three action tiles are
  // scripts (sequences/loops the static scene model can't express — sunrise fade,
  // colour flow); the rest are classic state-snapshot scenes.
  const scenes = [
    { id: "good_morning", nm: "Good Morning", ic: "☀", sub: "5-min sunrise", domain: "script" },
    { id: "leaving", nm: "Leaving", ic: "→", sub: "Purifier · lights off", domain: "script" },
    { id: "work_done", nm: "Work Done!", ic: "✦", sub: "Light flow", domain: "script" },
    { id: "morning", nm: "Morning", ic: "◑", sub: "scene.morning", domain: "scene" },
    { id: "movie", nm: "Movie", ic: "▶", sub: "scene.movie", domain: "scene" },
    { id: "goodnight", nm: "Goodnight", ic: "☾", sub: "scene.goodnight", domain: "scene" },
    { id: "all_off", nm: "All off", ic: "○", sub: "scene.all_off", domain: "scene" },
  ];
  async function run(id) {
    const s = scenes.find((x) => x.id === id);
    const domain = s?.domain || "scene";
    setFiring(id);
    try {
      await callService(domain, "turn_on", { entity_id: `${domain}.${id}` });
    } catch (e) {
      console.warn("[scenes] failed", id, e);
    }
    setTimeout(() => setFiring(null), 1100);
  }
  return (
    <Card index={index} eyebrow={`Scenes · ${scenes.length} tiles`} title="Quick scenes" meta={firing ? `Running · ${firing}` : "Idle"}>
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
