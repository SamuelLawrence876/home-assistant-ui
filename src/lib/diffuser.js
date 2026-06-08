/* Diffuser LED palette + colour helpers — shared by the Climate DiffuserCard
   and the Overview DiffuserMini. Pure, no JSX, no entity access. */

export const DIFFUSER_COLORS = [
  { name: "Warm white", rgb: [255, 214, 170] },
  { name: "Amber",      rgb: [255, 176, 92] },
  { name: "Blush",      rgb: [255, 150, 170] },
  { name: "Violet",     rgb: [170, 140, 255] },
  { name: "Ocean",      rgb: [96, 170, 255] },
  { name: "Teal",       rgb: [88, 210, 198] },
  { name: "Forest",     rgb: [120, 200, 140] },
];

export const rgbCss = (a) => `rgb(${a[0]}, ${a[1]}, ${a[2]})`;

/* Nearest named swatch for an arbitrary rgb triplet. */
export function nearestColorName(rgb) {
  let best = DIFFUSER_COLORS[0];
  let bd = Infinity;
  for (const c of DIFFUSER_COLORS) {
    const d = (c.rgb[0] - rgb[0]) ** 2 + (c.rgb[1] - rgb[1]) ** 2 + (c.rgb[2] - rgb[2]) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best.name;
}
