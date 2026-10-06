/* The Updates card. One tap on a Core row's Install used to restart Home
   Assistant, an OS row rebooted the Pi, and "Install all" fired every pending
   update at once — Core and OS included — with no confirm and no backup.
   Now the system rows confirm first and back up where HA supports it; routine
   installs stay one tap and take no backup (a policy change nobody asked for). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const fixtures = { updates: [] };
const callService = vi.fn();

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntitiesByDomain: () => fixtures.updates,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));

import { AddonsCard, installData } from "../../src/cards/system/AddonsCard.jsx";
import { ARM_LOCK_MS } from "../../src/cards/system/useArmedConfirm.js";

// supported_features: INSTALL 1, SPECIFIC_VERSION 2, PROGRESS 4, BACKUP 8, RELEASE_NOTES 16
const update = (entity_id, title, supported_features, extra = {}) => ({
  entity_id,
  state: "on",
  attributes: { title, installed_version: "1.0", latest_version: "1.1", supported_features, ...extra },
});
const CORE = update("update.home_assistant_core_update", "Home Assistant Core", 1 | 2 | 8 | 16);
const OS = update("update.home_assistant_operating_system_update", "Home Assistant Operating System", 1 | 2 | 16);
const TAILSCALE = update("update.tailscale_update", "Tailscale", 1 | 4 | 8 | 16);
const ESPHOME = update("update.esphome_update", "ESPHome", 1 | 16);

const row = (title) => screen.getByText(title).parentElement.parentElement;
const installIn = (title) => within(row(title)).getByRole("button");
const flush = () => act(() => Promise.resolve());

function deferred() {
  let resolve;
  const promise = new Promise((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  callService.mockReset();
  callService.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("installData", () => {
  it("asks for a backup only on a system row that declares the BACKUP feature", () => {
    expect(installData(CORE)).toEqual({ entity_id: CORE.entity_id, backup: true });
    expect(installData(OS)).toEqual({ entity_id: OS.entity_id });
    expect(installData({ entity_id: "update.x", attributes: {} })).toEqual({ entity_id: "update.x" });
  });

  it("never asks for one on a routine install, even where the entity supports it", () => {
    expect(installData(TAILSCALE)).toEqual({ entity_id: TAILSCALE.entity_id });
  });
});

describe("AddonsCard", () => {
  it("one tap on Core arms a confirm and installs nothing", () => {
    fixtures.updates = [CORE];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core"));
    expect(callService).not.toHaveBeenCalled();
    expect(installIn("Home Assistant Core").textContent).toBe("Confirm");
    // Core supports BACKUP, and the confirm says it will take one.
    expect(screen.getByText("Backs up, then restarts Home Assistant — confirm to install")).toBeTruthy();
  });

  it("doesn't promise a backup on a system row that can't take one", () => {
    fixtures.updates = [OS];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Operating System"));
    expect(screen.getByText("Reboots the Pi — confirm to install")).toBeTruthy();
    expect(screen.queryByText(/Backs up/)).toBeNull();
  });

  it("a double-click on OS still installs nothing", () => {
    fixtures.updates = [OS];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Operating System"));
    act(() => vi.advanceTimersByTime(80));
    fireEvent.click(installIn("Home Assistant Operating System"));
    expect(callService).not.toHaveBeenCalled();
  });

  it("a deliberate confirm installs Core with a backup", async () => {
    fixtures.updates = [CORE];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Home Assistant Core"));
    await flush();
    expect(callService).toHaveBeenCalledWith("update", "install", { entity_id: CORE.entity_id, backup: true });
  });

  it("an add-on row installs on one tap", async () => {
    fixtures.updates = [ESPHOME];
    render(<AddonsCard />);
    fireEvent.click(installIn("ESPHome"));
    await flush();
    expect(callService).toHaveBeenCalledWith("update", "install", { entity_id: ESPHOME.entity_id });
  });

  it("installing another row disarms a pending Core confirm", async () => {
    fixtures.updates = [CORE, TAILSCALE];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core")); // armed
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Tailscale"));
    await flush();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");

    // One press after the other row finished must only re-arm, never install.
    fireEvent.click(installIn("Home Assistant Core"));
    await flush();
    expect(callService.mock.calls.map((c) => c[2].entity_id)).toEqual([TAILSCALE.entity_id]);
  });

  it("Install all disarms a pending Core confirm", async () => {
    fixtures.updates = [CORE, TAILSCALE, ESPHOME];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(screen.getByRole("button", { name: "Install the rest" }));
    await flush();
    await flush();
    expect(callService.mock.calls.map((c) => c[2].entity_id)).toEqual([TAILSCALE.entity_id, ESPHOME.entity_id]);
    expect(installIn("Home Assistant Core").disabled).toBe(false);
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
    fireEvent.click(installIn("Home Assistant Core"));
    await flush();
    expect(callService.mock.calls.map((c) => c[2].entity_id)).not.toContain(CORE.entity_id);
  });

  it("Install all leaves Core and OS out, says so, and goes one at a time", async () => {
    fixtures.updates = [CORE, TAILSCALE, OS, ESPHOME];
    const first = deferred();
    callService.mockReturnValueOnce(first.promise);
    render(<AddonsCard />);

    // Short and unwrapping: "Install all but system" was a three-line pill at 360px.
    const all = screen.getByRole("button", { name: "Install the rest" });
    expect(all.style.whiteSpace).toBe("nowrap");
    expect(all.title).toMatch(/Core, OS and Supervisor/);
    fireEvent.click(all);
    await flush();
    // Only the first install is out; the second waits for it. No backup:
    // Tailscale supports one, but a routine install doesn't ask.
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenLastCalledWith("update", "install", { entity_id: TAILSCALE.entity_id });

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    await flush();
    expect(callService).toHaveBeenCalledTimes(2);
    expect(callService).toHaveBeenLastCalledWith("update", "install", { entity_id: ESPHOME.entity_id });

    const ids = callService.mock.calls.map((c) => c[2].entity_id);
    expect(ids).not.toContain(CORE.entity_id);
    expect(ids).not.toContain(OS.entity_id);
  });

  it("calls it plain 'Install all' when nothing is held back", () => {
    fixtures.updates = [TAILSCALE, ESPHOME];
    render(<AddonsCard />);
    expect(screen.getByRole("button", { name: "Install all" })).toBeTruthy();
  });

  it("shows an install already running server-side as busy", () => {
    fixtures.updates = [{ ...TAILSCALE, attributes: { ...TAILSCALE.attributes, in_progress: true } }];
    render(<AddonsCard />);
    const btn = installIn("Tailscale");
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("…");
  });
});
