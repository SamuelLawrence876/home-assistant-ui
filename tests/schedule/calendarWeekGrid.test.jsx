/* The week grid's now-line.

   The columns are drawn (endHour + 1 - startHour) rows tall, so the grid
   shows the 22:00-23:00 row — but the line used to require now <= endHour,
   which hid it for the last visible hour of every evening. `now` is the
   fractional hour useNow() hands the card. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WeekGrid } from "../../src/cards/schedule/WeekGrid.jsx";

beforeEach(() => {
  // jsdom has no ResizeObserver; the grid only uses it to re-read --col-h.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const renderAt = (now) =>
  render(
    <WeekGrid
      weekStart={new Date(2026, 7, 3)}
      todayDow={1}
      events={[]}
      calendars={{}}
      startHour={8}
      endHour={22}
      slotsPerHour={2}
      now={now}
      clickable={false}
      notice={null}
    />,
  );

const nowLine = (container) => container.querySelector(".weekcal-now");

describe("WeekGrid now-line", () => {
  it("is drawn mid-afternoon", () => {
    expect(nowLine(renderAt(15.25).container)).not.toBe(null);
  });

  it("is drawn during the last row the grid shows, 22:00-23:00", () => {
    const { container } = renderAt(22.5);
    const line = nowLine(container);
    expect(line).not.toBe(null);
    // Inside the column, not hanging past it: 14.5h * 2 slots * 26px.
    const col = container.querySelectorAll(".weekcal-col")[1];
    expect(parseFloat(line.style.top)).toBe(754);
    expect(parseFloat(line.style.top)).toBeLessThan(parseFloat(col.style.height));
  });

  it("is drawn from the very first minute of the grid", () => {
    expect(nowLine(renderAt(8).container)).not.toBe(null);
  });

  it("is gone once the grid's last row has ended, and before it starts", () => {
    expect(nowLine(renderAt(23).container)).toBe(null);
    expect(nowLine(renderAt(23.75).container)).toBe(null);
    expect(nowLine(renderAt(7.9).container)).toBe(null);
  });

  it("only sits in today's column", () => {
    const { container } = renderAt(12);
    expect(container.querySelectorAll(".weekcal-now")).toHaveLength(1);
    expect(container.querySelectorAll(".weekcal-col")[1].querySelector(".weekcal-now")).not.toBe(null);
  });
});

/* jsdom does no layout, so this pins the CSS that keeps the seven day columns
   equal rather than measuring them. On a 390px phone one all-day "Weekend
   away" pill (white-space: nowrap) used to widen its column to the length of
   the title: the grid grew to 555px, other days shrank to 22px slivers and the
   whole page panned sideways, clipping the New event dialog. A grid item's
   default min-width is its content; these rules take that away. */
describe("WeekGrid columns can't be widened by an event title", () => {
  const css = readFileSync(resolve(__dirname, "../../src/styles/schedule.css"), "utf8");
  const phone = readFileSync(resolve(__dirname, "../../src/styles/phone.css"), "utf8");
  // The declarations of every top-level rule whose selector list includes
  // `selector`. Comments are stripped first, and a selector starts in column 0.
  const rulesFor = (text, selector) => [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^([^\s{}@][^{}]*)\{([^}]*)\}/gm)]
    .filter(([, sel]) => sel.split(",").map((s) => s.trim()).includes(selector))
    .map(([, , body]) => body)
    .join(";");

  it("gives the day headers and the off-grid cells a zero minimum width", () => {
    for (const sel of [".weekcal-head .dow", ".weekcal-offgrid-row .cell"]) {
      expect(rulesFor(css, sel)).toMatch(/min-width:\s*0\s*(;|$)/);
    }
  });

  it("sizes the day tracks minmax(0, 1fr) on desktop", () => {
    expect(rulesFor(css, ".weekcal")).toMatch(/grid-template-columns:\s*48px repeat\(7, minmax\(0, 1fr\)\)/);
  });

  it("still holds where phone.css swaps the template for a plain 1fr", () => {
    // If phone.css ever drops its override this test has nothing to guard and
    // can go; until then, the min-width rules above are what protect the phone.
    const phoneTemplate = rulesFor(phone, "body.viewport-phone .weekcal");
    if (/repeat\(7, 1fr\)/.test(phoneTemplate)) {
      expect(rulesFor(css, ".weekcal-offgrid-row .cell")).toMatch(/min-width:\s*0/);
    }
  });
});
