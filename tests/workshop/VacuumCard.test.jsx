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

/* Round 4c (R4C-7): each consumable is read in its own unit_of_measurement,
   through durationToMinutes — not the main brush's unit for all three, and
   not "a number over 10000 must be seconds". The unit is whatever HA
   registered that entity with, so it can differ between the three. */
describe("VacuumCard wear bars, each in its own unit", () => {
  const u = (state, unit) => ({ state, attributes: unit ? { unit_of_measurement: unit } : {} });
  const withParts = (main, side, filter) => {
    states = {
      ...base(),
      "sensor.roborock_s8_main_brush_time_left": main,
      "sensor.roborock_s8_side_brush_time_left": side,
      "sensor.roborock_s8_filter_time_left": filter,
    };
    return wear(render(<VacuumCard />).container);
  };

  it("a filter in minutes is read as minutes: 4500 min is 75h, half of 150h, not 4500h", () => {
    const w = withParts(h("300"), h("200"), u("4500", "min"));
    expect(w.Filter.val).toBe("75h left");
    expect(w.Filter.p).toBe("50%");
    expect(w.Filter.c).toBe("var(--warn)");
  });

  it("a filter in days is read as days: 3 d is 72h, not 3h and red", () => {
    const w = withParts(h("300"), h("200"), u("3", "d"));
    expect(w.Filter.val).toBe("72h left");
    expect(w.Filter.c).toBe("var(--warn)");
  });

  it("uses each sensor's own unit, not the main brush's", () => {
    const w = withParts(u("1080000", "s"), u("12000", "min"), h("150"));
    expect(w["Main brush"].val).toBe("300h left");
    expect(w["Side brush"].val).toBe("200h left");
    expect(w.Filter.val).toBe("150h left");
    for (const lbl of ["Main brush", "Side brush", "Filter"]) {
      expect(w[lbl].p).toBe("100%");
      expect(w[lbl].c).toBe("var(--good)");
    }
  });

  it("a small seconds reading is still seconds, not hours", () => {
    const w = withParts(h("300"), u("7200", "s"), h("150"));
    expect(w["Side brush"].val).toBe("2h left");
    expect(w["Side brush"].c).toBe("var(--bad)");
  });

  it("a unit it doesn't know, or none, is the grey unread bar — not a guess", () => {
    const w = withParts(u("300", "fortnight"), u("200"), u("20000"));
    for (const lbl of ["Main brush", "Side brush", "Filter"]) {
      expect(w[lbl].p).toBe("0%");
      expect(w[lbl].c).toBe("var(--ink-4)");
      expect(w[lbl].val).toContain("—");
    }
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

/* Round 4: the Time readout assumed minutes, but this Pi's Roborock entities
   were registered before HA 2025.11 and report cleaning_time in seconds — a
   20-minute clean read "1200 min". The unit now comes from the entity. */
describe("VacuumCard cleaning time", () => {
  const timeCell = (time) => {
    states = {
      ...base(),
      "vacuum.roborock_s8": { state: "cleaning", attributes: {} },
      "sensor.roborock_s8_cleaning_time": time,
    };
    const { container } = render(<VacuumCard />);
    const cell = [...container.querySelectorAll(".ws-therm")].find((n) => n.querySelector(".k").textContent === "Time");
    return cell.querySelector(".v").textContent;
  };
  const t = (state, unit) => ({ state, attributes: unit ? { unit_of_measurement: unit } : {} });

  it("reads a seconds sensor as seconds: 1200 s is 20 min, not 1200", () => {
    expect(timeCell(t("1200", "s"))).toBe("20min");
  });

  it("rounds a part-minute rather than printing a fraction", () => {
    expect(timeCell(t("1250", "s"))).toBe("21min");
  });

  it("passes a minutes sensor through", () => {
    expect(timeCell(t("35", "min"))).toBe("35min");
  });

  it("converts an hours sensor", () => {
    expect(timeCell(t("1.5", "h"))).toBe("90min");
  });

  it("says — for a unit it doesn't know, rather than guessing", () => {
    expect(timeCell(t("1200", "fortnight"))).toBe("—min");
  });

  it("says — with no unit at all", () => {
    expect(timeCell(t("1200"))).toBe("—min");
  });

  it("says — for an unavailable sensor", () => {
    expect(timeCell(t("unavailable", "s"))).toBe("—min");
  });
});
