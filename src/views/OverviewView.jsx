/* Overview tab — landing view, eagerly imported by App (no lazy flash on boot).
   RULE (views/): layout composition only — no entity subscriptions, no
   service calls, no state beyond layout. */
import { WeatherSunHero } from "../cards/overview/WeatherSunHero.jsx";
import { PresenceCard } from "../cards/overview/PresenceCard.jsx";
import { NextEventCard } from "../cards/overview/NextEventCard.jsx";
import { RoomClimateStrip } from "../cards/overview/RoomClimateStrip.jsx";
import { ScenesCard } from "../cards/overview/ScenesCard.jsx";
import { PlayStrip } from "../cards/overview/PlayStrip.jsx";
import { MediaCard } from "../cards/media/MediaCard.jsx";
import { QuickLightsCard } from "../cards/lights/QuickLightsCard.jsx";
import { InProgressCard } from "../cards/system/InProgressCard.jsx";

export default function OverviewView({ viewport, sky }) {
  return (
    <div className="grid">
      <div className="col-8">
        <WeatherSunHero index={0} sky={sky} compact={viewport === "phone"} />
      </div>
      <div className="col-4" style={{ display: "grid", gap: 14 }}>
        <PresenceCard index={1} />
        <MediaCard index={2} />
        <NextEventCard index={3} />
      </div>

      <div className="col-12">
        <RoomClimateStrip index={4} />
      </div>

      <div className="col-4">
        <QuickLightsCard index={5} />
      </div>
      <div className="col-5">
        <ScenesCard index={6} />
      </div>
      <div className="col-3">
        <InProgressCard index={7} />
      </div>

      {/* Play strip at the foot — replaces the four stat pills (SamBox360 design) */}
      <div className="col-12"><PlayStrip index={8} /></div>
    </div>
  );
}
