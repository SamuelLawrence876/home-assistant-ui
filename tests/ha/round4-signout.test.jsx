/* Round 4 lifecycle#1, the drawer's half. Sign out gives Home Assistant up to
   a few seconds to revoke the session before it reloads. The button used to
   show nothing in that time, and its confirm step reset to "Sign out of Home
   Assistant" after 5 s as if nothing had happened. Now it says so, takes no
   second press, and keeps keyboard focus (aria-disabled, never disabled). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("../../src/ha/socket.js", () => ({
  getHaUrl: () => "https://ha.example.invalid",
  signOut,
}));

import { TweaksDrawer } from "../../src/TweaksDrawer.jsx";

const noop = () => {};
const drawer = () =>
  render(
    <TweaksDrawer
      lean="frosted"
      modePref="auto"
      clockOverride={false}
      clock={12}
      onLeanChange={noop}
      onModeChange={noop}
      onClockOverrideChange={noop}
      onClockChange={noop}
    />,
  );

beforeEach(() => {
  vi.useFakeTimers();
  signOut.mockReset();
  signOut.mockReturnValue(new Promise(() => {})); // HA still thinking about the revoke
});
afterEach(() => vi.useRealTimers());

describe("Sign out while it runs", () => {
  it("says 'Signing out…', ignores further presses and keeps focus", () => {
    drawer();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const button = screen.getByRole("button", { name: "Sign out of Home Assistant" });
    button.focus();

    fireEvent.click(button);
    expect(button).toHaveTextContent("Tap again to confirm sign out");
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("Signing out…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    // The confirm step's 5-second reset doesn't undo it.
    act(() => vi.advanceTimersByTime(6000));
    expect(button).toHaveTextContent("Signing out…");
  });

  it("before confirming, nothing is busy", () => {
    drawer();
    const button = screen.getByRole("button", { name: "Sign out of Home Assistant", hidden: true });
    expect(button).not.toHaveAttribute("aria-disabled");
  });
});
