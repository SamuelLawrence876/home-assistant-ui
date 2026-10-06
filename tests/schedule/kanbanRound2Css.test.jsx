/* Kanban card actions — CSS that jsdom can't lay out, pinned as text.

   - Desktop: the summary always keeps clear of ⇄ and ×. The reserve used to
     exist only on touch screens, so a mouse hover drew both buttons over a
     long title.
   - Touch: Move and Delete were 20px targets 2px apart, always visible, so a
     slightly-off tap on Move hit Delete. They are 24px (WCAG 2.5.8) with a
     12px gap and non-overlapping hit pads — and the block has to come AFTER
     the base rules it resizes, which it ties on specificity, or it silently
     does nothing. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../src/styles/schedule.css"), "utf8");
const touchStart = css.indexOf("@media (hover: none)");
const touch = css.slice(touchStart, css.indexOf("\n}\n", touchStart));
const px = (text, re) => Number(text.match(re)?.[1]);

describe("Kanban card actions", () => {
  it("reserves room for the actions on every card, not only on touch screens", () => {
    // Top level: not inside any @media block.
    expect(css).toMatch(/^\.kanban-card \.summary \{ padding-right: 36px; \}$/m);
  });

  it("gives touch targets 24px, a 12px gap, and pads that don't overlap", () => {
    expect(touch).toMatch(/\.kanban-card-act \{[^}]*width: 24px; height: 24px;/);
    const gap = px(touch, /\.kanban-card-actions \{[^}]*gap: (\d+)px/);
    const padX = px(touch, /\.kanban-card-act::after \{[^}]*inset: -\d+px -(\d+)px/);
    expect(gap).toBe(12);
    expect(2 * padX).toBeLessThanOrEqual(gap);
    // The summary clears the pads: 4px inset + two 24px buttons + gap + pad, less 12px card padding.
    expect(px(touch, /\.kanban-card \.summary \{ padding-right: (\d+)px/)).toBeGreaterThanOrEqual(4 + 24 + gap + 24 + padX - 12);
  });

  it("comes after the base rules it overrides", () => {
    for (const base of [".kanban-card-act {", ".kanban-move {", ".kanban-move-opt {", ".kanban-undo-btn {"]) {
      expect(css.indexOf(base)).toBeGreaterThan(-1);
      expect(css.indexOf(base)).toBeLessThan(touchStart);
    }
  });
});
