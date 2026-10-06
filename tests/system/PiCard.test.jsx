/* M14. Pi health's meta used to say "all healthy" with CPU, memory and temp
   unavailable (the disk reading alone was enough to skip the "no readings"
   guard), and while the socket was down, from the values cached before it
   dropped. "All healthy" is a clean bill: it needs all four readings, live. */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const fx = vi.hoisted(() => ({ status: "ready", states: {} }));
const entity = (id) => (id in fx.states ? { entity_id: id, state: fx.states[id] } : undefined);
vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => ({ entity: entity(id), status: fx.status }),
  useEntity: (id) => entity(id),
}));

import { PiCard } from "../../src/cards/system/PiCard.jsx";

const CPU = "sensor.system_monitor_processor_use";
const MEM = "sensor.system_monitor_memory_use";
const TEMP = "sensor.system_monitor_processor_temperature";
const DISK = "sensor.system_monitor_disk_use_config";

function meta(states, status = "ready") {
  fx.states = states;
  fx.status = status;
  const { container, unmount } = render(<PiCard />);
  const text = container.querySelector(".meta").textContent;
  expect(container.textContent).not.toMatch(/NaN/);
  unmount();
  return text;
}

const healthy = { [CPU]: "12", [MEM]: "900", [TEMP]: "48", [DISK]: "11.4" };

describe("PiCard health", () => {
  it("all four read and fine: all healthy", () => {
    expect(meta(healthy)).toBe("all healthy");
  });

  it("three unavailable and only disk read is not a clean bill", () => {
    const states = { [CPU]: "unavailable", [MEM]: "unavailable", [TEMP]: "unknown", [DISK]: "11.4" };
    expect(meta(states, "unavailable")).toBe("3 readings missing");
  });

  it("one missing reading says so", () => {
    const { [TEMP]: _gone, ...rest } = healthy;
    expect(meta(rest)).toBe("1 reading missing");
  });

  it("a reading over the line is reported even when others are missing", () => {
    expect(meta({ [CPU]: "unavailable", [TEMP]: "80" }, "unavailable")).toBe("degraded");
    expect(meta({ [TEMP]: "70", [DISK]: "11.4" })).toBe("warm");
  });

  it("with the socket down, cached values don't vouch for anything", () => {
    // useEntityStatus says "loading" whenever the connection isn't ready; the
    // entities still hold the last values seen before it dropped.
    expect(meta(healthy, "loading")).toBe("no readings");
  });

  it("nothing read at all: no readings", () => {
    expect(meta({})).toBe("no readings");
  });
});
