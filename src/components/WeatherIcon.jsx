/* ----------------------------------------------------------------
   Weather icon
   ----------------------------------------------------------------*/
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

  const Drops = ({ cx, cy, count = 3 }) => (
    <g fill={sunColor} stroke="none">
      {[...Array(count)].map((_, i) => (
        <ellipse key={i} cx={cx - 12 + i * 12} cy={cy + i * 2} rx={2} ry={4.5} opacity={0.85} />
      ))}
    </g>
  );

  const Snow = ({ cx, cy }) => (
    <g stroke={sunColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
      {[-12, 0, 12].map((dx, i) => (
        <g key={i} transform={`translate(${cx + dx} ${cy + 4 + (i % 2) * 2})`}>
          <line x1={-4} y1={0} x2={4} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={-3} y1={-3} x2={3} y2={3} />
          <line x1={3} y1={-3} x2={-3} y2={3} />
        </g>
      ))}
    </g>
  );

  const Wind = () => (
    <g stroke={cloudColor} strokeWidth={3} strokeLinecap="round" fill="none">
      <path d="M 18 40 Q 50 36, 60 40 Q 72 44, 80 40" />
      <path d="M 24 56 Q 56 52, 66 56 Q 78 60, 86 56" />
      <path d="M 20 72 Q 48 68, 58 72" />
    </g>
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-label={condition}>
      {condition === "sunny" && <Sun cx={50} cy={50} r={22} />}
      {condition === "partlycloudy" && (
        <>
          <Sun cx={36} cy={36} r={16} />
          <Cloud cx={62} cy={62} scale={1.15} opacity={0.95} />
        </>
      )}
      {condition === "cloudy" && (
        <>
          <Cloud cx={36} cy={40} scale={1.05} opacity={0.6} />
          <Cloud cx={56} cy={58} scale={1.2} />
        </>
      )}
      {condition === "rainy" && (
        <>
          <Cloud cx={50} cy={36} scale={1.2} />
          <Drops cx={50} cy={68} count={3} />
        </>
      )}
      {condition === "snowy" && (
        <>
          <Cloud cx={50} cy={36} scale={1.2} />
          <Snow cx={50} cy={68} />
        </>
      )}
      {condition === "windy" && <Wind />}
      {!["sunny", "partlycloudy", "cloudy", "rainy", "snowy", "windy"].includes(condition) && (
        <Sun cx={50} cy={50} r={20} />
      )}
    </svg>
  );
}
