/* AdGuard's protection switch stayed live when HA couldn't reach AdGuard.
   HA skips an unavailable target and reports success, so a tap flipped the
   card to "Protected" / "Live" / green dot while AdGuard was down — and the
   resync never undid it, because the state string stayed "unavailable".
   The real useOptimisticToggle runs here; only the socket layer is faked. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixtures = { entities: {} };
const callService = vi.fn();

const lookup = (id) => fixtures.entities[id] ?? { entity: null, status: "loading" };
vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => lookup(id),
  useEntity: (id) => lookup(id).entity,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));

import { AdGuardSimpleCard, AdGuardCard } from "../../src/cards/system/AdGuardCard.jsx";

const ready = (state) => ({ entity: { state, attributes: {} }, status: "ready" });
const unavailable = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
const sensors = {
  "sensor.adguard_home_dns_queries": ready("1000"),
  "sensor.adguard_home_dns_queries_blocked": ready("120"),
  "sensor.adguard_home_dns_queries_blocked_ratio": ready("12"),
};
const protection = () => screen.getByRole("switch", { name: "AdGuard protection" });

beforeEach(() => {
  callService.mockReset();
  callService.mockResolvedValue(undefined);
});

describe("AdGuardSimpleCard", () => {
  it("says Unavailable and locks the switch when protection can't be reached", async () => {
    fixtures.entities = { ...sensors, "switch.adguard_home_protection": unavailable };
    render(<AdGuardSimpleCard />);
    expect(protection().disabled).toBe(true);
    expect(screen.getAllByText("Unavailable").length).toBe(2); // meta + headline
    expect(screen.queryByText("Disabled")).toBeNull();

    fireEvent.click(protection());
    await act(() => Promise.resolve());
    expect(callService).not.toHaveBeenCalled();
    expect(screen.queryByText("Protected")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("reads Protected and stays operable when the switch is on", () => {
    fixtures.entities = { ...sensors, "switch.adguard_home_protection": ready("on") };
    render(<AdGuardSimpleCard />);
    expect(screen.getByText("Protected")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(protection().disabled).toBe(false);
  });

  it("renders the loading state exactly as before (mock mode)", () => {
    fixtures.entities = {};
    render(<AdGuardSimpleCard />);
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });
});

describe("AdGuardCard (full)", () => {
  it("locks both switches and drops the claims when they can't be reached", () => {
    fixtures.entities = {
      ...sensors,
      "switch.adguard_home_protection": unavailable,
      "switch.adguard_home_filtering": unavailable,
    };
    render(<AdGuardCard />);
    expect(protection().disabled).toBe(true);
    expect(screen.getByRole("switch", { name: "AdGuard filtering" }).disabled).toBe(true);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Disabled")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });
});
