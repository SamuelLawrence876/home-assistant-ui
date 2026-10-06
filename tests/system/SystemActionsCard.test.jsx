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
// The connection and Home Assistant's start time, driven by each test: the
// restart notice clears only once HA is back with a start time that moved.
vi.mock("../../src/ha/socket.js", async () => (await import("./fakeHa.js")).socketMock);

import { SystemActionsCard } from "../../src/cards/system/SystemActionsCard.jsx";
import { ARM_LOCK_MS, ARM_EXPIRE_MS } from "../../src/cards/system/useArmedConfirm.js";
import { NOTICE_CAP_MS, RESTART_GRACE_MS, clearNotices } from "../../src/cards/system/useReconnectNotice.js";
import { ha, setStatus, report, uptime, resetHa, dropMidCall } from "./fakeHa.js";
import { getEntries, clearErrors } from "../../src/lib/errorLog.js";

const T0 = "2026-10-01T08:00:00+00:00";
const T1 = "2026-10-06T12:00:30+00:00";

const tile = (name) => screen.getByText(name).closest("button");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-06T12:00:00Z"));
  callService.mockReset();
  callService.mockResolvedValue(undefined);
  clearNotices();
  resetHa();
  clearErrors();
  ha.entities["sensor.uptime"] = uptime(T0);
});
afterEach(() => {
  clearNotices();
  vi.useRealTimers();
});

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
   actually happening — and, since a reconnect alone proves nothing, checks
   Home Assistant's start time before it lets go. */
describe("SystemActionsCard after a restart has gone out", () => {
  const flush = () => act(async () => {});
  const note = () => screen.getByRole("status");
  async function confirm(name) {
    fireEvent.click(tile(name));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(tile("Confirm?"));
    await flush();
  }

  it("Restart HA expects the disconnect and says it is restarting until HA is back, restarted", async () => {
    render(<SystemActionsCard />);
    expect(note().textContent).toBe("");
    callService.mockImplementationOnce(async () => dropMidCall());
    await confirm("Restart HA");
    expect(callService).toHaveBeenCalledWith("homeassistant", "restart", {}, undefined, { expectDisconnect: true });
    expect(note().textContent).toBe("Restarting… the dashboard will reconnect.");

    act(() => vi.advanceTimersByTime(90_000));
    expect(note().textContent).toBe("Restarting… the dashboard will reconnect.");
    setStatus("ready");
    // Back, but HA hasn't sent its start time again yet.
    expect(note().textContent).toBe("Reconnected — checking Home Assistant restarted…");
    report(uptime(T1));
    expect(note().textContent).toBe("");
    expect(getEntries()).toEqual([]);
  });

  /* B10. The frame never reached HA: the dashboard's network dropped
     mid-send and came straight back. That reconnect used to clear the
     notice exactly as a finished restart would — no toast, no log entry. */
  it("a reconnect to the same Home Assistant says it didn't restart, and logs it", async () => {
    callService.mockImplementationOnce(async () => dropMidCall());
    const { container } = render(<SystemActionsCard />);
    await confirm("Restart HA");
    expect(note().textContent).toBe("Restarting… the dashboard will reconnect.");
    setStatus("ready");
    report(uptime(T0));
    // Same start time, but HA may still be checking its config before it stops.
    expect(note().textContent).toBe("Reconnected — checking Home Assistant restarted…");
    act(() => vi.advanceTimersByTime(RESTART_GRACE_MS));
    expect(note().textContent).toBe("Home Assistant didn't restart — try again.");
    expect(container.querySelector(".sys-action-note").className).toContain("bad");
    expect(getEntries().map((e) => e.message)).toEqual([
      "homeassistant.restart: Home Assistant didn't restart (the command may not have reached it)",
    ]);
  });

  it("Reboot Pi says it is rebooting, and says so if the Pi never went down", async () => {
    render(<SystemActionsCard />);
    await confirm("Reboot Pi");
    expect(note().textContent).toBe("Rebooting… the dashboard will reconnect.");
    act(() => vi.advanceTimersByTime(NOTICE_CAP_MS));
    expect(note().textContent).toBe("The Pi didn't reboot — try again.");
  });

  /* B13. The System view is lazy and unmounts on every tab change. */
  it("keeps the notice across a tab switch while HA is down", async () => {
    const first = render(<SystemActionsCard />);
    await confirm("Reboot Pi");
    setStatus("disconnected");
    first.unmount();
    render(<SystemActionsCard />);
    expect(note().textContent).toBe("Rebooting… the dashboard will reconnect.");
  });

  it("says nothing when the call failed (callService has already toasted it)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    callService.mockRejectedValueOnce(new Error("Not connected"));
    render(<SystemActionsCard />);
    await confirm("Restart HA");
    expect(note().textContent).toBe("");
  });

  it("reloads are ordinary calls: no option, no notice", async () => {
    render(<SystemActionsCard />);
    fireEvent.click(tile("Reload Automations"));
    await flush();
    expect(callService.mock.calls).toEqual([["automation", "reload"]]);
    expect(note().textContent).toBe("");
  });

  /* The pressed tile is the focused one; disabling it dropped focus to the page. */
  it("a running action keeps its tile focusable, and a press meanwhile does nothing", async () => {
    render(<SystemActionsCard />);
    const reload = tile("Reload Scripts");
    reload.focus();
    fireEvent.click(reload);
    await flush();
    expect(reload.disabled).toBe(false);
    expect(reload.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(reload);
    fireEvent.click(tile("Reload Automations"));
    await flush();
    expect(callService.mock.calls).toEqual([["script", "reload"]]);
    act(() => vi.advanceTimersByTime(2000));
    expect(reload.getAttribute("aria-disabled")).toBeNull();
  });
});
