/* Vacuum "Full" — round-3b review finding B9 (2026-10-06).

   With button.roborock_s8_full_cleaning missing or unavailable, Full is
   disabled, and the only reason given was a title on that disabled button. A
   disabled button can't take focus and touch shows no tooltip, so on a phone
   Full just looked dead. The reason is now on screen, and tied to the button
   with aria-describedby. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ha = { states: {} };

vi.mock("../../src/ha/useEntity.js", () => {
  const useEntity = (id) => ha.states[id] ?? null;
  return {
    useEntity,
    useEntityStatus: (id) => {
      const e = useEntity(id);
      const status = !e ? "not_found" : e.state === "unavailable" || e.state === "unknown" ? "unavailable" : "ready";
      return { entity: e, status };
    },
  };
});
vi.mock("../../src/ha/client.js", () => ({
  callService: async () => null,
  imageUrl: () => null,
}));

const { VacuumCard } = await import("../../src/cards/workshop/VacuumCard.jsx");

const VAC = "vacuum.roborock_s8";
const FULL = "button.roborock_s8_full_cleaning";
const HINT = "Full clean isn't available in Home Assistant";
const btn = (name) => screen.getByRole("button", { name });

beforeEach(() => {
  ha.states = {
    [VAC]: { state: "docked", attributes: {} },
    [FULL]: { state: "2026-10-03T09:00:00+00:00", attributes: {} },
    "sensor.roborock_s8_status": { state: "charging", attributes: {} },
    "sensor.roborock_s8_battery": { state: "100", attributes: {} },
  };
});

describe("B9 — why Full is unavailable can be found without hovering", () => {
  it("a missing full-clean button: the reason is on screen and describes the disabled Full", () => {
    delete ha.states[FULL];
    render(<VacuumCard />);
    expect(screen.getByText(HINT)).toBeVisible();
    expect(btn("Full")).toBeDisabled();
    expect(btn("Full")).toHaveAccessibleDescription(HINT);
    // Start and Locate don't need the full-clean button.
    expect(btn("Start")).not.toBeDisabled();
    expect(btn("Locate")).not.toBeDisabled();
  });

  it("an unavailable full-clean button: the same", () => {
    ha.states[FULL] = { state: "unavailable", attributes: {} };
    render(<VacuumCard />);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(btn("Full")).toHaveAccessibleDescription(HINT);
  });

  it("a working full-clean button (never pressed reads 'unknown') shows no hint", () => {
    ha.states[FULL] = { state: "unknown", attributes: {} };
    render(<VacuumCard />);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(btn("Full")).not.toHaveAttribute("aria-describedby");
  });

  it("a vacuum that is itself missing: no Full hint — the card's warning badge is the reason", () => {
    delete ha.states[VAC];
    delete ha.states[FULL];
    render(<VacuumCard />);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByRole("img", { name: /not found/ })).toBeInTheDocument();
  });

  it("while cleaning, Full isn't on screen, so neither is its hint", () => {
    ha.states[VAC] = { state: "cleaning", attributes: {} };
    delete ha.states[FULL];
    render(<VacuumCard />);
    expect(screen.queryByRole("button", { name: "Full" })).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("workshop.css lays the hint out as its own visible line, not a hidden one", () => {
    const css = readFileSync(resolve(__dirname, "../../src/styles/workshop.css"), "utf8");
    const rule = css.match(/^\.ws-vac-hint\s*\{([^}]*)\}/m);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/flex-basis:\s*100%/);
    expect(rule[1]).not.toMatch(/display:\s*none|clip|position:\s*absolute/);
  });
});
