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

import { SystemActionsCard } from "../../src/cards/system/SystemActionsCard.jsx";
import { ARM_LOCK_MS, ARM_EXPIRE_MS } from "../../src/cards/system/useArmedConfirm.js";

const tile = (name) => screen.getByText(name).closest("button");

beforeEach(() => {
  vi.useFakeTimers();
  callService.mockReset();
  callService.mockResolvedValue(undefined);
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

  it("a deliberate second press fires", () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Reboot Pi"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(tile("Confirm?"));
    expect(callService).toHaveBeenCalledWith("hassio", "host_reboot");
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
