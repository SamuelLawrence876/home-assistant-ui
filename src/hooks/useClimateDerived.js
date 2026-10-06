/* Shared derivation for the Govee H5075 room-climate cards.
   Single source of truth for the stale-sensor fallback, 24h history
   building, trend, comfort bands and verdict copy — consumed by both
   cards/climate/RoomClimateCard (full) and cards/overview/RoomClimateStrip.

   Every reading that can be unknown is null, never a stand-in: tempMin /
   tempMax with no recorder history, humidity with no reading or history.
   Consumers render an em dash. */
import { useEntityStatus, useStatistics } from "../ha/useEntity.js";
import { numOr } from "../lib/format.js";

const TEMP_ID = "sensor.h5075_4fb6_temperature";
const HUM_ID = "sensor.h5075_4fb6_humidity";
export const CLIMATE_STAT_IDS = [TEMP_ID, HUM_ID];

// One decimal, matching what the H5075 itself reports. Hourly means come
// back as e.g. 52.18333333333333, which used to reach the ring unrounded.
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function useClimateDerived() {
  const { entity: liveTemp, status: tempStatus } = useEntityStatus(TEMP_ID);
  const { entity: liveHum, status: humStatus } = useEntityStatus(HUM_ID);
  const { data: statsData, loading: historyLoading } = useStatistics(CLIMATE_STAT_IDS, 24);

  const tempStats = statsData?.[TEMP_ID];
  const humStats = statsData?.[HUM_ID];
  const rawTemp = tempStats?.mean || [];
  const rawHum = humStats?.mean || [];
  const lastStatTemp = rawTemp.length > 0 ? rawTemp[rawTemp.length - 1] : null;
  const lastStatHum = rawHum.length > 0 ? rawHum[rawHum.length - 1] : null;

  /* Each reading is gated on its own sensor. This used to be one combined
     status, so a humidity dropout alone threw away a live temperature and
     showed the last hourly mean instead — "Sensor offline · last known 20.9°,
     Comfortable" in a room the live sensor said was 23.4° and warm. A sensor
     HA reports unavailable falls back to its last recorder mean; one that is
     missing outright is unknown (null). */
  const tempStale = tempStatus === "unavailable";
  const humStale = humStatus === "unavailable";
  const temp = tempStale ? lastStatTemp : numOr(liveTemp?.state, null);
  const humidity = humStale ? round1(lastStatHum) : numOr(liveHum?.state, null);

  /* Render the EntityGuard placeholder while this is true. Temperature is the
     card's headline (and the guard names its entity), so it alone decides; a
     missing or offline humidity sensor is an em dash, not a blank card. A
     "ready" sensor whose state isn't a number is reported to the guard as
     unavailable, so the placeholder says so instead of rendering an empty card.
     (Both sensors share one connection, so "loading" is never one-sided.) */
  const pending = tempStatus === "loading" || tempStatus === "not_found" || temp == null;
  const guardStatus = tempStatus === "ready" && temp == null ? "unavailable" : tempStatus;

  // What is on screen as last-known rather than live, and the line that says
  // which sensor that is. `stale` drives the badge, `staleNote` the meta.
  const stale = tempStale || (humStale && humidity != null);
  const staleNote = tempStale && humStale ? "Sensor offline · last known"
    : tempStale ? "Temperature offline · last known"
    : humStale ? (humidity != null ? "Humidity offline · last known" : "Humidity offline")
    : null;

  const tempHist = rawTemp.length > 0
    ? (tempStale ? [...rawTemp.slice(-24)] : [...rawTemp.slice(-23), temp])
    : temp == null ? [] : [temp];
  const humHist = rawHum.length > 0
    ? (humStale || humidity == null ? [...rawHum.slice(-24)] : [...rawHum.slice(-23), humidity])
    : humidity == null ? [] : [humidity];

  // True min/max from recorder (not from hourly means) for accurate HIGH/LOW
  // labels, falling back to the hourly means. With no recorder history at all
  // there is no 24h range to report — the live reading alone is not one.
  // (Math.min coerces null to 0, so a missing `temp` is left out, not passed.)
  const trueMinArr = tempStats?.min || [];
  const trueMaxArr = tempStats?.max || [];
  const nowPt = temp == null ? [] : [temp];
  const tempMin = trueMinArr.length > 0 ? Math.min(...trueMinArr, ...nowPt)
    : rawTemp.length > 0 ? Math.min(...tempHist) : null;
  const tempMax = trueMaxArr.length > 0 ? Math.max(...trueMaxArr, ...nowPt)
    : rawTemp.length > 0 ? Math.max(...tempHist) : null;

  // Trend over last 3h (index 20 vs 23). Recorder statistics arrive on an async
  // WS round-trip and can be missing for good (sensor excluded from recorder,
  // purged, or younger than an hour), so there may be no point 4 back. `delta`
  // is null in that case — never NaN. Consumers render an em dash.
  const prev = tempHist.length >= 4 ? tempHist[tempHist.length - 4] : null;
  const delta = prev == null || temp == null ? null : temp - prev;
  const trend = delta == null ? "flat" : delta > 0.2 ? "up" : delta < -0.2 ? "down" : "flat";
  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : "→";

  // Comfort verdict. humBand is null when humidity is unknown — the verdict
  // then speaks to temperature only rather than calling unknown air "dry".
  // (temp is only null while `pending`, but null < 18 is true in JS, so it is
  // guarded rather than left to read as "cold".)
  const tempBand = temp == null ? null
    : temp < 18 ? "cold" : temp < 19 ? "cool" : temp <= 22 ? "comfortable" : temp <= 25 ? "warm" : "hot";
  const humBand = humidity == null ? null
    : humidity < 30 ? "dry" : humidity <= 55 ? "ideal" : humidity <= 65 ? "damp" : "humid";
  const allGood = tempBand === "comfortable" && humBand === "ideal";
  const verdict = allGood ? "Comfortable"
    : tempBand == null ? "—"
    : tempBand !== "comfortable" ? `Room is ${tempBand}`
    : humBand == null ? "Room is comfortable"
    : `Air is ${humBand}`;
  const verdictNote =
    allGood ? "Sleep-friendly range. Holding steady."
    : tempBand == null      ? ""
    : tempBand === "cold"  ? "Below typical sleeping range. Consider the heater."
    : tempBand === "cool"   ? "Slightly cool — fine if you like it crisp."
    : tempBand === "warm"   ? "A touch warm. Crack a window or run the fan."
    : tempBand === "hot"    ? "Too warm for sleep. Run the fan."
    : humBand == null       ? "Humidity reading unavailable."
    : humBand === "dry"     ? "Dry air — humidifier helps."
    : humBand === "damp"    ? "A little damp. Ventilate."
    : "Humid — open a window or run the purifier.";

  const lastUp = liveTemp?.last_updated
    ? new Date(liveTemp.last_updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return {
    status: guardStatus, pending, stale, staleNote, liveTemp, historyLoading,
    temp, humidity, tempHist, humHist, tempMin, tempMax,
    delta, trend, trendIcon, tempBand, humBand,
    allGood, verdict, verdictNote, lastUp,
  };
}
