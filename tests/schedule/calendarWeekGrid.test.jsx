/* The week grid's now-line.

   The columns are drawn (endHour + 1 - startHour) rows tall, so the grid
   shows the 22:00-23:00 row — but the line used to require now <= endHour,
   which hid it for the last visible hour of every evening. `now` is the
   fractional hour useNow() hands the card. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
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
