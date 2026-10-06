/* Mock mode (VITE_HA_URL="") is what the screenshot and console harnesses
   render: no Home Assistant, so the real useEntityStatus never leaves
   "loading". The light cards must render there — skeleton bodies, an em-dash
   rather than an invented state, and no NaN anywhere. This drives the real
   hooks over a socket that never connects, rather than mocking the hooks. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../src/ha/socket.js", () => ({
  getEntity: () => undefined,
  getAllStates: () => [],
  subscribe: () => () => {},
  onConnectionChange: (cb) => { cb("disconnected"); return () => {}; },
  onStatesChanged: () => () => {},
  onSnapshotReady: () => () => {},
  hasSnapshot: () => false,
  getConnectionStatus: () => "disconnected",
  waitForConnection: () => Promise.reject(new Error("not used")),
  sendWsMessage: () => Promise.reject(new Error("not used")),
}));
const callService = vi.fn(() => Promise.resolve());
vi.mock("../../src/ha/client.js", () => ({ callService: (...a) => callService(...a) }));

const { LightCard } = await import("../../src/cards/lights/LightCard.jsx");
const { DeskStripCard } = await import("../../src/cards/lights/DeskStripCard.jsx");

describe("light cards in mock mode", () => {
  it("render skeletons with no invented state and nothing broken on screen", () => {
    const { container } = render(
      <>
        <LightCard index={0} entityId="light.living_room" />
        <LightCard index={1} entityId="light.smartbulb_5c_h" />
        <DeskStripCard index={2} />
        <LightCard index={3} entityId="light.bathroom" />
      </>,
    );
    expect(container.querySelectorAll(".entity-loading")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/NaN|undefined|Invalid Date/);
    // The desk strip used to read a confident "Off" here, with a live switch.
    expect(screen.getByRole("switch", { name: "Desk strip — not reported yet" })).toBeDisabled();
    for (const sw of screen.getAllByRole("switch")) expect(sw).toBeDisabled();
    expect(callService).not.toHaveBeenCalled();
  });
});
