/* ----------------------------------------------------------------
   Weather icon — one glyph per Home Assistant weather condition.

   HA has fifteen (homeassistant/components/weather/const.py). This used to
   draw six and a full sun for everything else, so a clear night (met.no's
   current condition on any cloudless night), a downpour, a thunderstorm and
   an *unavailable* weather entity all showed a sun. Anything it doesn't
   recognise now draws a neutral dash: an unknown value is never a
   plausible-looking default.
   ----------------------------------------------------------------*/
export const WEATHER_LABELS = Object.freeze({
  "clear-night": "Clear night",
  cloudy: "Cloudy",
  exceptional: "Exceptional",
  fog: "Fog",
  hail: "Hail",
  lightning: "Lightning",
  "lightning-rainy": "Thunderstorm",
  partlycloudy: "Partly cloudy",
  pouring: "Heavy rain",
  rainy: "Rain",
  snowy: "Snow",
  "snowy-rainy": "Sleet",
  sunny: "Sunny",
  windy: "Windy",
  "windy-variant": "Windy, cloudy",
});

/* Human label for a condition, or null if it isn't one. hasOwn, so an HA
   state can never land on an Object.prototype key. */
export function weatherLabel(condition) {
  return typeof condition === "string" && Object.hasOwn(WEATHER_LABELS, condition)
    ? WEATHER_LABELS[condition]
    : null;
}

export function WeatherIcon({ condition, size = 88, sunColor = "var(--accent-2)", cloudColor = "var(--ink-2)" }) {
  const vb = 100;
  const stroke = 2;

  const Sun = ({ cx, cy, r = 16, withRays = true, opacity = 1 }) => (
    <g opacity={opacity}>
      {withRays && (
        <g stroke={sunColor} strokeWidth={stroke} strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={cx + Math.cos(rad) * (r + 5)}
                y1={cy + Math.sin(rad) * (r + 5)}
                x2={cx + Math.cos(rad) * (r + 11)}
                y2={cy + Math.sin(rad) * (r + 11)}
              />
            );
          })}
        </g>
      )}
      <circle cx={cx} cy={cy} r={r} fill={sunColor} />
    </g>
  );

  // A crescent: the long way round a r=24 disc, back along a shallower arc.
  const Moon = () => (
    <path d="M 68 29.2 A 24 24 0 1 0 68 70.8 A 22 22 0 0 1 68 29.2 Z" fill={sunColor} />
  );

  const Cloud = ({ cx, cy, scale = 1, fill = cloudColor, opacity = 1 }) => (
    <g
      opacity={opacity}
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}
      fill={fill}
    >
      <ellipse cx={cx - 14} cy={cy + 4} rx={11} ry={10} />
      <ellipse cx={cx} cy={cy - 4} rx={14} ry={13} />
      <ellipse cx={cx + 15} cy={cy + 2} rx={10} ry={10} />
      <rect x={cx - 22} y={cy + 2} width={42} height={12} rx={6} />
    </g>
  );

  // Centred on cx. At the default count and spacing this is the original
  // three drops at cx-12 / cx / cx+12.
  const Drops = ({ cx, cy, count = 3, spacing = 12 }) => (
    <g fill={sunColor} stroke="none">
      {[...Array(count)].map((_, i) => (
        <ellipse
          key={i}
          cx={cx - ((count - 1) * spacing) / 2 + i * spacing}
          cy={cy + i * 2}
          rx={2}
          ry={4.5}
          opacity={0.85}
        />
      ))}
    </g>
  );

  const Snow = ({ cx, cy, offsets = [-12, 0, 12] }) => (
    <g stroke={sunColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
      {offsets.map((dx, i) => (
        <g key={i} transform={`translate(${cx + dx} ${cy + 4 + (i % 2) * 2})`}>
          <line x1={-4} y1={0} x2={4} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={-3} y1={-3} x2={3} y2={3} />
          <line x1={3} y1={-3} x2={-3} y2={3} />
        </g>
      ))}
    </g>
  );

  const Bolt = () => (
    <path d="M 55 52 L 43 71 L 51 71 L 45 88 L 61 65 L 53 65 L 59 52 Z" fill={sunColor} />
  );

  const Hail = () => (
    <g fill={sunColor} opacity={0.85}>
      <circle cx={38} cy={68} r={3.5} />
      <circle cx={51} cy={75} r={3.5} />
      <circle cx={63} cy={67} r={3.5} />
    </g>
  );

  const Fog = () => (
    <g stroke={cloudColor} strokeWidth={3} strokeLinecap="round" opacity={0.75}>
      <line x1={24} y1={60} x2={76} y2={60} />
      <line x1={18} y1={70} x2={70} y2={70} />
      <line x1={30} y1={80} x2={82} y2={80} />
    </g>
  );

  const Wind = () => (
    <g stroke={cloudColor} strokeWidth={3} strokeLinecap="round" fill="none">
      <path d="M 18 40 Q 50 36, 60 40 Q 72 44, 80 40" />
      <path d="M 24 56 Q 56 52, 66 56 Q 78 60, 86 56" />
      <path d="M 20 72 Q 48 68, 58 72" />
    </g>
  );

  // A real condition, just not a forecastable one — a warning sign, not a guess.
  const Exceptional = () => (
    <g stroke={sunColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M 50 22 L 80 76 L 20 76 Z" />
      <line x1={50} y1={42} x2={50} y2={58} />
      <circle cx={50} cy={67} r={1.5} fill={sunColor} />
    </g>
  );

  // Unknown, unavailable, or a condition HA added after this was written.
  const Unknown = () => (
    <line x1={36} y1={50} x2={64} y2={50} stroke={cloudColor} strokeWidth={4} strokeLinecap="round" opacity={0.6} />
  );

  const RainCloud = () => <Cloud cx={50} cy={36} scale={1.2} />;

  const glyph = () => {
    switch (weatherLabel(condition) ? condition : null) {
      case "sunny":
        return <Sun cx={50} cy={50} r={22} />;
      case "clear-night":
        return <Moon />;
      case "partlycloudy":
        return (
          <>
            <Sun cx={36} cy={36} r={16} />
            <Cloud cx={62} cy={62} scale={1.15} opacity={0.95} />
          </>
        );
      case "cloudy":
        return (
          <>
            <Cloud cx={36} cy={40} scale={1.05} opacity={0.6} />
            <Cloud cx={56} cy={58} scale={1.2} />
          </>
        );
      case "fog":
        return (
          <>
            <Cloud cx={50} cy={34} scale={1.1} opacity={0.6} />
            <Fog />
          </>
        );
      case "rainy":
        return (
          <>
            <RainCloud />
            <Drops cx={50} cy={68} count={3} />
          </>
        );
      case "pouring":
        return (
          <>
            <RainCloud />
            <Drops cx={50} cy={66} count={5} spacing={10} />
          </>
        );
      case "lightning":
        return (
          <>
            <RainCloud />
            <Bolt />
          </>
        );
      case "lightning-rainy":
        return (
          <>
            <RainCloud />
            <Bolt />
            <Drops cx={50} cy={68} count={2} spacing={30} />
          </>
        );
      case "hail":
        return (
          <>
            <RainCloud />
            <Hail />
          </>
        );
      case "snowy":
        return (
          <>
            <RainCloud />
            <Snow cx={50} cy={68} />
          </>
        );
      case "snowy-rainy":
        return (
          <>
            <RainCloud />
            <Drops cx={50} cy={66} count={2} spacing={24} />
            <Snow cx={50} cy={66} offsets={[0]} />
          </>
        );
      case "windy":
      case "windy-variant":
        return <Wind />;
      case "exceptional":
        return <Exceptional />;
      default:
        return <Unknown />;
    }
  };

  // role="img" — an <svg> carrying only aria-label isn't reliably exposed.
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      role="img"
      aria-label={weatherLabel(condition) || "Conditions unknown"}
    >
      {glyph()}
    </svg>
  );
}
