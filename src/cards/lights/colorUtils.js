export function rgbStr(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function kelvinToRgb(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; } else { r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(t - 60, -0.1332047592))); }
  if (t <= 66) { g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(t) - 161.1195681661)); } else { g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(t - 60, -0.0755148492))); }
  if (t >= 66) { b = 255; } else if (t <= 19) { b = 0; } else { b = Math.min(255, Math.max(0, 138.5177312231 * Math.log(t - 10) - 305.0447927307)); }
  return [Math.round(r), Math.round(g), Math.round(b)];
}
