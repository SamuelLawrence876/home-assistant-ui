/* VacuumCard against a vacuum Home Assistant can't act on — the 2026-10
   round-3 review finding M11.

   HA skips a service call aimed at a missing or unavailable entity and still
   reports success. The card used to gate its actions on state === "unavailable"
   only, so a missing vacuum, or one reading "unknown", kept Start/Full/Locate
   live; Start then resolved and the card claimed CLEANING · ACTIVE for good,
   because no state change was ever coming to correct it.

   The fake here behaves like useEntityStatus over a live socket: no entity is
   "not_found", "unavailable"/"unknown" is "unavailable", anything else
   "ready". It is reactive, so a test can move the vacuum under the card. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ha = { states: {}, calls: [], listeners: new Set() };
function setState(id, entity) {
  if (entity) ha.states[id] = entity; else delete ha.states[id];
  ha.listeners.forEach((l) => l());
}

vi.mock("../../src/ha/useEntity.js", async () => {
  const React = await import("react");
  const useEntity = (id) => {
    const [, tick] = React.useReducer((n) => n + 1, 0);
    React.useEffect(() => {
      ha.listeners.add(tick);
      return () => { ha.listeners.delete(tick); };
    }, []);
    return ha.states[id] ?? null;
  };
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
  callService: async (domain, service, data) => { ha.calls.push(`${domain}.${service}`); return null; },
  imageUrl: () => null,
}));

import { VacuumCard } from "../../src/cards/workshop/VacuumCard.jsx";
import { SETTLE_MS } from "../../src/hooks/useOptimistic.js";

const VAC = "vacuum.roborock_s8";
const FULL = "button.roborock_s8_full_cleaning";
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => {}); };
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); await flush(); };
const btn = (name) => screen.getByRole("button", { name });
const statusText = (container) => container.querySelector(".ws-vac-stat .v.small").textContent;
const dot = (container) => container.querySelector(".ws-status-pill .dot").style.background;

beforeEach(() => {
  vi.useFakeTimers();
  ha.calls = [];
  ha.listeners.clear();
  ha.states = {
    [VAC]: { state: "docked", attributes: {} },
    [FULL]: { state: "2026-10-03T09:00:00+00:00", attributes: {} },
    "sensor.roborock_s8_status": { state: "charging", attributes: {} },
    "sensor.roborock_s8_battery": { state: "100", attributes: {} },
    "switch.roborock_s8_do_not_disturb": { state: "off", attributes: {} },
  };
});
afterEach(() => vi.useRealTimers());

describe("M11: a vacuum HA can't act on offers no commands", () => {
  it("a missing vacuum keeps Start, Full, Locate and DND disabled, and no green dot", () => {
    delete ha.states[VAC];
    const { container } = render(<VacuumCard />);
    for (const name of ["Start", "Full", "Locate"]) expect(btn(name)).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Do not disturb" })).toBeDisabled();
    expect(dot(container)).not.toBe("var(--good)");
  });

  it("a vacuum reading 'unknown' is treated the same way", () => {
    ha.states[VAC] = { state: "unknown", attributes: {} };
    render(<VacuumCard />);
    for (const name of ["Start", "Full", "Locate"]) expect(btn(name)).toBeDisabled();
  });

  it("a ready vacuum still offers Start and Full", () => {
    const { container } = render(<VacuumCard />);
    expect(btn("Start")).not.toBeDisabled();
    expect(btn("Full")).not.toBeDisabled();
    expect(dot(container)).toBe("var(--good)");
  });

  it("Full is disabled when its own button entity is gone — but a never-pressed ('unknown') button is fine", () => {
    delete ha.states[FULL];
    const { unmount } = render(<VacuumCard />);
    expect(btn("Full")).toBeDisabled();
    expect(btn("Start")).not.toBeDisabled();
    unmount();
    ha.states[FULL] = { state: "unknown", attributes: {} };
    render(<VacuumCard />);
    expect(btn("Full")).not.toBeDisabled();
  });
});

describe("M11: nothing claims a clean HA never confirmed", () => {
  it("a Start that HA accepted but the vacuum never acted on goes back to what HA says", async () => {
    const { container } = render(<VacuumCard />);
    fireEvent.click(btn("Start"));
    await flush();
    expect(ha.calls).toEqual(["vacuum.start"]);
    expect(statusText(container)).toBe("ACTIVE"); // optimistic, for now
    await advance(SETTLE_MS + 100);
    expect(statusText(container)).toBe("CHARGING");
    expect(screen.queryByText("Pause")).toBeNull();
    expect(btn("Start")).toBeInTheDocument();
  });

  it("a Start the vacuum DID act on stays cleaning past the settle window", async () => {
    const { container } = render(<VacuumCard />);
    fireEvent.click(btn("Start"));
    await flush();
    act(() => setState(VAC, { state: "cleaning", attributes: {} }));
    await advance(SETTLE_MS + 100);
    expect(statusText(container)).toBe("ACTIVE");
    expect(btn("Pause")).toBeInTheDocument();
  });

  it("a cleaning vacuum that disappears from HA stops reading ACTIVE", async () => {
    ha.states[VAC] = { state: "cleaning", attributes: {} };
    const { container } = render(<VacuumCard />);
    expect(statusText(container)).toBe("ACTIVE");
    act(() => setState(VAC, null));
    await flush();
    expect(statusText(container)).not.toBe("ACTIVE");
    expect(container.querySelector(".ws-status-pill").textContent).not.toMatch(/cleaning/i);
    expect(btn("Start")).toBeDisabled();
  });
});

describe("M11: a disabled vacuum control looks disabled", () => {
  it("workshop.css dims disabled action and segmented buttons (scoped, not a global .btn rule)", () => {
    const css = readFileSync(resolve(__dirname, "../../src/styles/workshop.css"), "utf8");
    const rule = css.match(/\.ws-vac-actbtns \.btn:disabled[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toContain(".ws-control-row .seg button:disabled");
    expect(rule[1]).toMatch(/opacity:\s*0\.\d+/);
    expect(rule[1]).toMatch(/cursor:\s*not-allowed/);
    expect(css).not.toMatch(/^\.btn:disabled/m);
  });
});
