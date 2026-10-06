/* VacuumCard: wear bars are a share of each part's own life, and the
   segmented controls say which option is current to a screen reader.
   Roborock lifetimes (python-roborock *_REPLACE_TIME, which HA's
   *_time_left sensors count down from): main brush 300h, side brush 200h,
   filter 150h. On the old single 300h scale a brand-new filter drew half-full
   and amber, and went red at 39% of its life left. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

let states = {};

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntity: (id) => states[id] ?? null,
  useEntityStatus: (id) => {
    const e = states[id];
    if (!e) return { entity: null, status: "loading" };
    return { entity: e, status: e.state === "unavailable" ? "unavailable" : "ready" };
  },
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: () => Promise.resolve(),
  imageUrl: () => null,
}));

import { VacuumCard } from "../../src/cards/workshop/VacuumCard.jsx";

const h = (state) => ({ state, attributes: { unit_of_measurement: "h" } });
const base = () => ({
  "vacuum.roborock_s8": { state: "docked", attributes: {} },
  "select.roborock_s8_mop_intensity": { state: "moderate", attributes: { options: ["mild", "moderate", "intense"] } },
  "select.roborock_s8_mop_mode": { state: "standard", attributes: { options: ["standard", "deep"] } },
  "select.roborock_s8_selected_map": { state: "Upstairs", attributes: { options: ["Upstairs", "Downstairs"] } },
});

function wear(container) {
  return Object.fromEntries(
    [...container.querySelectorAll(".ws-wear-row")].map((row) => {
      const bar = row.querySelector(".bar > span");
      return [row.querySelector(".lbl").textContent, {
        p: bar.style.getPropertyValue("--p"),
        c: bar.style.getPropertyValue("--c"),
        val: row.querySelector(".val").textContent,
      }];
    }),
  );
}

beforeEach(() => { states = {}; });

describe("VacuumCard wear bars", () => {
  it("brand-new parts are all full and green, each on its own scale", () => {
    states = {
      ...base(),
      "sensor.roborock_s8_main_brush_time_left": h("300"),
      "sensor.roborock_s8_side_brush_time_left": h("200"),
      "sensor.roborock_s8_filter_time_left": h("150"),
    };
    const w = wear(render(<VacuumCard />).container);
    for (const lbl of ["Main brush", "Side brush", "Filter"]) {
      expect(w[lbl].p).toBe("100%");
      expect(w[lbl].c).toBe("var(--good)");
    }
  });

  it("a filter at 59h (39% of 150h) is amber, not red", () => {
    states = {
      ...base(),
      "sensor.roborock_s8_main_brush_time_left": h("300"),
      "sensor.roborock_s8_filter_time_left": h("59"),
    };
    const w = wear(render(<VacuumCard />).container);
    expect(parseFloat(w.Filter.p)).toBeCloseTo(39.33, 1);
    expect(w.Filter.c).toBe("var(--warn)");
  });

  it("an unread part is an empty neutral bar and an em dash, not a red one", () => {
    states = {
      ...base(),
      "sensor.roborock_s8_main_brush_time_left": h("300"),
      "sensor.roborock_s8_filter_time_left": h("unavailable"),
    };
    const w = wear(render(<VacuumCard />).container);
    expect(w.Filter.p).toBe("0%");
    expect(w.Filter.c).toBe("var(--ink-4)");
    expect(w.Filter.val).toContain("—");
    expect(w["Side brush"].c).toBe("var(--ink-4)");
  });
});

describe("VacuumCard segmented controls", () => {
  it("each group is labelled and its current option is aria-pressed", () => {
    states = base();
    render(<VacuumCard />);
    const cases = [
      ["Mop intensity", "moderate"],
      ["Mop mode", "standard"],
      ["Map", "Upstairs"],
    ];
    for (const [label, current] of cases) {
      const group = screen.getByRole("group", { name: label });
      const buttons = within(group).getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(1);
      for (const b of buttons) {
        expect(b.getAttribute("aria-pressed")).toBe(String(b.textContent === current));
      }
    }
  });
});
