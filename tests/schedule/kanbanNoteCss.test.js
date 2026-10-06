/* The Kanban column note's error tone, and the Retry pill that takes its
   colour — round 3b review finding B17.

   One red, oklch(0.65 0.2 25), served both skies. It is 4.87:1 on a night
   column but 3.39:1 on a day one, under WCAG AA's 4.5:1 for the note's 10px
   text — and Retry, a control, is drawn in it. jsdom can't compute colours, so
   the rules are read as text and the contrast worked out here, against the
   backgrounds the review measured in a browser. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../src/styles/schedule.css"), "utf8");

function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (x) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return lin.map((x) => Math.round(enc(x) * 255));
}
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (y1, y2) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

/* The colour a rule sets, as luminance. `selector` must start a line, so a
   rule nested in an @media block (indented) isn't mistaken for this one. */
function ruleLuminance(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`^${esc} \\{[^}]*color: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, "m"));
  if (!m) return null;
  return luminance(oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3])));
}

/* Day: the column the review measured, about rgb(248,250,249), and a darker
   one for margin (the sky behind the glass moves through the day). Night: the
   review measured the 0.65 red at 4.87:1, which puts the column's luminance
   at about 0.0106. */
const DAY_BG = luminance([248, 250, 249]);
const DAY_BG_DARKER = luminance([235, 238, 240]);
const NIGHT_BG = 0.0106;

describe("Kanban note error tone", () => {
  it("meets 4.5:1 on a day column, Retry's label included", () => {
    const day = ruleLuminance(".kanban-col-note.error");
    expect(day).not.toBeNull();
    expect(contrast(day, DAY_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(day, DAY_BG_DARKER)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a lighter red at night that still meets 4.5:1 there", () => {
    const night = ruleLuminance("body.mode-night .kanban-col-note.error");
    expect(night).not.toBeNull();
    expect(contrast(night, NIGHT_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("Retry inherits the note's colour rather than setting its own", () => {
    expect(css).toMatch(/^\.kanban-retry \{[^}]*color: inherit;/m);
  });
});
