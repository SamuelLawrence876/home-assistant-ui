/* PrinterCard's headline: what the printer says it is doing, not a guess.
   print_status (ha-bambulab's gcode_state) decides; the remaining-time
   heuristic only runs when it is missing. A paused print used to read
   "Printing" / live, because remaining_time holds its last value while paused,
   and a printer nobody could read used to read "Idle" with targets of "idle". */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const P = "x1c_00m09d522400385";
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

import { PrinterCard } from "../../src/cards/workshop/PrinterCard.jsx";

const s = (state, attributes = {}) => ({ state, attributes });
function set(map) {
  states = {};
  for (const [k, v] of Object.entries(map)) states[k] = typeof v === "string" ? s(v) : v;
}
function renderCard() {
  const { container } = render(<PrinterCard />);
  return {
    title: screen.getByRole("heading", { level: 2 }).textContent,
    pill: container.querySelector(".ws-status-pill").textContent.trim(),
    dot: container.querySelector(".ws-status-pill .dot").style.background,
    targets: [...container.querySelectorAll(".ws-therm .tgt")].map((n) => n.textContent),
    text: container.textContent,
  };
}

const printingBase = {
  [`sensor.${P}_print_progress`]: s("42", { file_name: "bracket.3mf" }),
  [`sensor.${P}_remaining_time`]: "35",
  [`sensor.${P}_speed_profile`]: "standard",
  [`sensor.${P}_nozzle_target_temperature`]: "220",
  [`sensor.${P}_bed_target_temperature`]: "65",
  [`binary_sensor.${P}_online`]: "on",
};

beforeEach(() => { states = {}; });

describe("PrinterCard status", () => {
  it("a paused print reads Paused with a warn dot, not Printing / live", () => {
    set({
      ...printingBase,
      [`sensor.${P}_print_status`]: "pause",
      [`sensor.${P}_current_stage`]: "paused_filament_runout",
    });
    const r = renderCard();
    expect(r.title).toBe("Paused");
    expect(r.pill).toBe("paused");
    expect(r.dot).toBe("var(--warn)");
    expect(r.text).toContain("paused_filament_runout");
    // The running-only rows stay hidden.
    expect(r.text).not.toContain("Speed ·");
    expect(r.text).not.toContain("Part fan");
  });

  it("a running print reads Printing / live", () => {
    set({ ...printingBase, [`sensor.${P}_print_status`]: "running", [`sensor.${P}_current_stage`]: "printing" });
    const r = renderCard();
    expect(r.title).toBe("Printing");
    expect(r.pill).toBe("live");
    expect(r.text).toContain("Speed ·");
    expect(r.targets.slice(0, 2)).toEqual(["→ 220°", "→ 65°"]);
  });

  it("print_status wins over the heuristic: preparing with time left is not Printing", () => {
    set({ ...printingBase, [`sensor.${P}_print_status`]: "prepare", [`sensor.${P}_current_stage`]: "heatbed_preheating" });
    const r = renderCard();
    expect(r.title).toBe("Preparing");
    expect(r.pill).toBe("online");
  });

  it("names the finished state properly", () => {
    set({ ...printingBase, [`sensor.${P}_print_status`]: "finish", [`sensor.${P}_remaining_time`]: "0" });
    expect(renderCard().title).toBe("Finished");
  });

  it("falls back to remaining time + stage only when print_status is missing", () => {
    set({ ...printingBase, [`sensor.${P}_current_stage`]: "printing" });
    expect(renderCard().title).toBe("Printing");
  });

  it("the fallback still knows a paused stage is not printing", () => {
    set({ ...printingBase, [`sensor.${P}_current_stage`]: "paused_user" });
    const r = renderCard();
    expect(r.title).toBe("Paused");
    expect(r.pill).toBe("paused");
  });

  it("a powered-off printer reads Offline, and its unread targets read — not idle", () => {
    set({
      [`sensor.${P}_print_progress`]: "unavailable",
      [`sensor.${P}_print_status`]: "unavailable",
      [`sensor.${P}_remaining_time`]: "unavailable",
      [`sensor.${P}_nozzle_target_temperature`]: "unavailable",
      [`sensor.${P}_bed_target_temperature`]: "unavailable",
      [`binary_sensor.${P}_online`]: "off",
    });
    const r = renderCard();
    expect(r.title).toBe("Offline");
    expect(r.pill).toBe("offline");
    expect(r.targets.slice(0, 2)).toEqual(["—", "—"]);
  });

  it("a cold printer that reports a 0 target still reads idle", () => {
    set({
      ...printingBase,
      [`sensor.${P}_print_status`]: "idle",
      [`sensor.${P}_nozzle_target_temperature`]: "0",
      [`sensor.${P}_bed_target_temperature`]: "0",
    });
    const r = renderCard();
    expect(r.title).toBe("Idle");
    expect(r.targets.slice(0, 2)).toEqual(["idle", "idle"]);
  });

  it("with nothing read (mock mode) it claims nothing: — / —, no NaN", () => {
    const r = renderCard();
    expect(r.title).toBe("—");
    expect(r.pill).toBe("—");
    expect(r.text).not.toMatch(/NaN|Invalid Date|Idle|offline/);
  });
});
