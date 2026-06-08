import { RoomClimateCard } from "../cards/climate/RoomClimateCard.jsx";
import { DiffuserCard } from "../cards/climate/DiffuserCard.jsx";
import { AirPurifierCard } from "../cards/climate/AirPurifierCard.jsx";
import { HeaterCard } from "../cards/climate/HeaterCard.jsx";
import { FanCard } from "../cards/climate/FanCard.jsx";
import { WeatherSunHero } from "../cards/overview/WeatherSunHero.jsx";

export default function ClimateView({ sky }) {
  return (
    <div className="grid">
      <div className="col-12"><RoomClimateCard index={0} /></div>
      <div className="col-7"><DiffuserCard index={1} /></div>
      <div className="col-5"><HeaterCard index={2} /></div>
      <div className="col-12"><AirPurifierCard index={3} /></div>
      <div className="col-12"><FanCard index={4} /></div>
      <div className="col-12"><WeatherSunHero index={5} sky={sky} /></div>
    </div>
  );
}
