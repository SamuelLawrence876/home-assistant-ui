import { NowPlayingHero } from "../cards/media/NowPlayingHero.jsx";
import { SpotifyConnectCard } from "../cards/media/SpotifyConnectCard.jsx";
import { SpotifySearchCard } from "../cards/media/SpotifySearchCard.jsx";
import { SpotifyPlaylistsCard } from "../cards/media/SpotifyPlaylistsCard.jsx";
import { SpotifyQueueCard } from "../cards/media/SpotifyQueueCard.jsx";
import { SamBoxCard } from "../cards/overview/SamBoxStrip.jsx";

export default function MediaView() {
  return (
    <div className="grid" style={{ alignItems: "start" }}>
      <div className="col-8"><NowPlayingHero index={0} /></div>
      <div className="col-4"><SamBoxCard index={1} /></div>
      <div className="col-4"><SpotifyConnectCard index={1} /></div>
      <div className="col-4"><SpotifySearchCard index={2} /></div>
      <div className="col-4"><SpotifyPlaylistsCard index={3} /></div>
      <div className="col-4"><SpotifyQueueCard index={4} /></div>
    </div>
  );
}
