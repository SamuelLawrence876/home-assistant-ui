/* Shared derivation for the Govee H5075 room-climate cards.
   Single source of truth for the stale-sensor fallback, 24h history
   building, trend, comfort bands and verdict copy — consumed by both
   cards/climate/RoomClimateCard (full) and cards/overview/RoomClimateStrip. */
import { useEntityStatus, combineStatuses, useStatistics } from "../ha/useEntity.js";

const TEMP_ID = "sensor.h5075_4fb6_temperature";
const HUM_ID = "sensor.h5075_4fb6_humidity";
export const CLIMATE_STAT_IDS = [TEMP_ID, HUM_ID];

export function useClimateDerived() {
  const { entity: liveTemp, status: tempStatus } = useEntityStatus(TEMP_ID);
  const { entity: liveHum, status: humStatus } = useEntityStatus(HUM_ID);
  const { data: statsData } = useStatistics(CLIMATE_STAT_IDS, 24);
  const status = combineStatuses(tempStatus, humStatus);

  const tempStats = statsData?.[TEMP_ID];
  const humStats = statsData?.[HUM_ID];
  const rawTemp = tempStats?.mean || [];
  const rawHum = humStats?.mean || [];
  const stale = status === "unavailable";
  const lastStatTemp = rawTemp.length > 0 ? rawTemp[rawTemp.length - 1] : null;
  const lastStatHum = rawHum.length > 0 ? rawHum[rawHum.length - 1] : null;

  /* Render the EntityGuard placeholder while this is true. */
  const pending = status === "loading" || status === "not_found" ||
    (stale && lastStatTemp == null);

  const temp = stale ? lastStatTemp : Number(liveTemp?.state ?? 0);
  const humidity = stale ? (lastStatHum ?? 0) : Number(liveHum?.state ?? 0);

  const tempHist = rawTemp.length > 0 ? (stale ? [...rawTemp.slice(-24)] : [...rawTemp.slice(-23), temp]) : [temp];
  const humHist = rawHum.length > 0 ? (stale ? [...rawHum.slice(-24)] : [...rawHum.slice(-23), humidity]) : [humidity];

  // True min/max from recorder (not from hourly means) for accurate HIGH/LOW labels
  const trueMinArr = tempStats?.min || [];
  const trueMaxArr = tempStats?.max || [];
  const tempMin = trueMinArr.length > 0 ? Math.min(...trueMinArr, temp) : Math.min(...tempHist);
  const tempMax = trueMaxArr.length > 0 ? Math.max(...trueMaxArr, temp) : Math.max(...tempHist);

  // Trend over last 3h (index 20 vs 23)
  const prev = tempHist[tempHist.length - 4];
  const delta = temp - prev;
  const trend = delta > 0.2 ? "up" : delta < -0.2 ? "down" : "flat";
  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : "→";

  // Comfort verdict
  const tempBand = temp < 18 ? "cold" : temp < 19 ? "cool" : temp <= 22 ? "comfortable" : temp <= 25 ? "warm" : "hot";
  const humBand = humidity < 30 ? "dry" : humidity <= 55 ? "ideal" : humidity <= 65 ? "damp" : "humid";
  const allGood = tempBand === "comfortable" && humBand === "ideal";
  const verdict = allGood ? "Comfortable" : tempBand !== "comfortable" ? `Room is ${tempBand}` : `Air is ${humBand}`;
  const verdictNote =
    allGood ? "Sleep-friendly range. Holding steady."
    : tempBand === "cold"   ? "Below typical sleeping range. Consider the heater."
    : tempBand === "cool"   ? "Slightly cool — fine if you like it crisp."
    : tempBand === "warm"   ? "A touch warm. Crack a window or run the fan."
    : tempBand === "hot"    ? "Too warm for sleep. Run the fan."
    : humBand === "dry"     ? "Dry air — humidifier helps."
    : humBand === "damp"    ? "A little damp. Ventilate."
    : "Humid — open a window or run the purifier.";

  const lastUp = liveTemp?.last_updated
    ? new Date(liveTemp.last_updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return {
    status, pending, stale, liveTemp,
    temp, humidity, tempHist, humHist, tempMin, tempMax,
    delta, trend, trendIcon, tempBand, humBand,
    allGood, verdict, verdictNote, lastUp,
  };
}
