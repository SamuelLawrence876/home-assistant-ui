/* Restart HA and Reboot Pi ask first. The confirm used to be defeated by the
   gesture it exists to stop — click 1 armed, click 2 (same button, same
   place) fired — and an armed tile never disarmed, so one tap hours later
   on a wall tablet restarted Home Assistant. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const callService = vi.fn();
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));
// The connection status, driven by each test: the restart notice clears once
// the dashboard has dropped and come back.
const conn = vi.hoisted(() => ({ status: "ready", listeners: new Set() }));
vi.mock("../../src/ha/useEntity.js", async () => {
  const { useState, useEffect } = await import("react");
  return {
    useConnectionStatus: () => {
      const [s, set] = useState(conn.status);
      useEffect(() => {
        conn.listeners.add(set);
        return () => conn.listeners.delete(set);
      }, []);
      return s;
    },
  };
});

import { SystemActionsCard } from "../../src/cards/system/SystemActionsCard.jsx";
import { ARM_LOCK_MS, ARM_EXPIRE_MS } from "../../src/cards/system/useArmedConfirm.js";
import { NOTICE_CAP_MS } from "../../src/cards/system/useReconnectNotice.js";

const setStatus = (s) => {
  conn.status = s;
  act(() => conn.listeners.forEach((set) => set(s)));
};

const tile = (name) => screen.getByText(name).closest("button");

beforeEach(() => {
  vi.useFakeTimers();
  callService.mockReset();
  callService.mockResolvedValue(undefined);
  conn.status = "ready";
});
afterEach(() => vi.useRealTimers());

describe("SystemActionsCard confirm", () => {
  it("a double-click arms but does not fire", () => {
    render(<SystemActionsCard />);
    const btn = tile("Reboot Pi");
    fireEvent.click(btn);
    act(() => vi.advanceTimersByTime(80)); // a fast double-click
    fireEvent.click(btn);
    expect(callService).not.toHaveBeenCalled();
    expect(btn.textContent).toMatch(/Confirm\?/);
  });

  it("a triple-click spread past the lock does not fire either", () => {
    render(<SystemActionsCard />);
    const btn = tile("Reboot Pi");
    fireEvent.click(btn);
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS / 2));
    fireEvent.click(btn);
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS - 100)); // past the lock from arming, not from the last press
    fireEvent.click(btn);
    expect(callService).not.toHaveBeenCalled();
  });

  it("a held Enter key (auto-repeat) does not fire", () => {
    render(<SystemActionsCard />);
    const btn = tile("Restart HA");
    fireEvent.click(btn);
    for (let t = 0; t < 2000; t += 33) {
      act(() => vi.advanceTimersByTime(33));
      fireEvent.click(btn); // each auto-repeat activates the button again
    }
    expect(callService).not.toHaveBeenCalled();
  });

  it("a deliberate second press fires", () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Reboot Pi"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(tile("Confirm?"));
    expect(callService).toHaveBeenCalledWith("hassio", "host_reboot", {}, undefined, { expectDisconnect: true });
  });

  it("an armed confirm disarms itself, so a much later tap only re-arms", () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Restart HA"));
    expect(screen.getByText("Confirm?")).toBeTruthy();
    act(() => vi.advanceTimersByTime(ARM_EXPIRE_MS));
    expect(screen.queryByText("Confirm?")).toBeNull();

    act(() => vi.advanceTimersByTime(6 * 3600_000));
    fireEvent.click(tile("Restart HA"));
    expect(callService).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm?")).toBeTruthy();
  });

  it("Cancel disarms", () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Restart HA"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Confirm?")).toBeNull();
  });

  it("reloads need no confirm, and pressing one disarms an armed restart", () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Restart HA"));
    fireEvent.click(tile("Reload Scripts"));
    expect(callService).toHaveBeenCalledWith("script", "reload");
    expect(screen.queryByText("Confirm?")).toBeNull();
  });
});

/* Restart HA and Reboot Pi end with Home Assistant dropping the WebSocket
   before it answers. The call used to be logged and toasted as a failure;
   now it expects the disconnect (client.js) and the card says what is
   actually happening, until the dashboard is back. */
describe("SystemActionsCard after a restart has gone out", () => {
  const flush = () => act(async () => {});
  const note = () => screen.getByRole("status");
  async function confirm(name) {
    fireEvent.click(tile(name));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(tile("Confirm?"));
    await flush();
  }

  it("Restart HA expects the disconnect and says it is restarting until HA is back", async () => {
    render(<SystemActionsCard />);
    expect(note().textContent).toBe("");
    callService.mockResolvedValueOnce({ connectionLost: true });
    await confirm("Restart HA");
    expect(callService).toHaveBeenCalledWith("homeassistant", "restart", {}, undefined, { expectDisconnect: true });
    expect(note().textContent).toBe("Restarting… the dashboard will reconnect.");

    setStatus("disconnected");
    act(() => vi.advanceTimersByTime(90_000));
    expect(note().textContent).toBe("Restarting… the dashboard will reconnect.");
    setStatus("ready");
    expect(note().textContent).toBe("");
  });

  it("Reboot Pi says it is rebooting", async () => {
    render(<SystemActionsCard />);
    await confirm("Reboot Pi");
    expect(note().textContent).toBe("Rebooting… the dashboard will reconnect.");
  });

  it("says nothing when the call failed (callService has already toasted it)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    callService.mockRejectedValueOnce(new Error("Not connected"));
    render(<SystemActionsCard />);
    await confirm("Restart HA");
    expect(note().textContent).toBe("");
  });

  it("does not leave 'Restarting…' up for good if the connection never drops", async () => {
    render(<SystemActionsCard />);
    await confirm("Restart HA");
    expect(note().textContent).not.toBe("");
    act(() => vi.advanceTimersByTime(NOTICE_CAP_MS));
    expect(note().textContent).toBe("");
  });

  it("reloads are ordinary calls: no option, no notice", async () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Reload Automations"));
    await flush();
    expect(callService.mock.calls).toEqual([["automation", "reload"]]);
    expect(note().textContent).toBe("");
  });
});
