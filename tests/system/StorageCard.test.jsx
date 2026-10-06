/* An unavailable disk sensor used to become "0 GiB used": a bar drawn 100%
   Free and a legend of System 0 MiB / Config 0 MiB / Free 220.0 GiB, under
   only a corner badge. EntityGuard renders children when unavailable, so the
   numbers themselves have to be honest. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fixtures = { entities: {} };
const lookup = (id) => fixtures.entities[id] ?? { entity: null, status: "loading" };
vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => lookup(id),
  useEntity: (id) => lookup(id).entity,
}));

import { StorageCard } from "../../src/cards/system/StorageCard.jsx";

const ready = (state) => ({ entity: { state, attributes: {} }, status: "ready" });
const unavailable = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
const legendValue = (label) =>
  screen.getByText(label).closest(".storage-legend-item").querySelector(".storage-val").textContent;

describe("StorageCard", () => {
  it("dashes every slice and draws no measured bar when the disk sensor is unavailable", () => {
    fixtures.entities = {
      "sensor.system_monitor_disk_use": unavailable,
      "sensor.system_monitor_disk_use_config": ready("2.5"),
    };
    const { container } = render(<StorageCard />);
    expect(legendValue("System")).toBe("—");
    expect(legendValue("Config")).toBe("—");
    expect(legendValue("Free")).toBe("—");
    expect(screen.queryByText(/220\.0 GiB/)).toBeNull();
    const bar = container.querySelector(".storage-bar");
    expect(bar.classList.contains("unknown")).toBe(true);
    expect(bar.children).toHaveLength(0);
  });

  it("doesn't split used space it can't split when only the config sensor is out", () => {
    fixtures.entities = {
      "sensor.system_monitor_disk_use": ready("40"),
      "sensor.system_monitor_disk_use_config": unavailable,
    };
    const { container } = render(<StorageCard />);
    expect(legendValue("Used")).toBe("40.0 GiB");
    expect(legendValue("Config")).toBe("—");
    expect(legendValue("Free")).toBe("180.0 GiB");
    expect(screen.queryByText("System")).toBeNull();
    expect(container.querySelectorAll(".storage-bar > span")).toHaveLength(2);
  });

  it("splits System / Config / Free when both read", () => {
    fixtures.entities = {
      "sensor.system_monitor_disk_use": ready("40"),
      "sensor.system_monitor_disk_use_config": ready("10"),
    };
    const { container } = render(<StorageCard />);
    expect(legendValue("System")).toBe("30.0 GiB");
    expect(legendValue("Config")).toBe("10.0 GiB");
    expect(legendValue("Free")).toBe("180.0 GiB");
    expect(container.querySelectorAll(".storage-bar > span")).toHaveLength(3);
  });
});
