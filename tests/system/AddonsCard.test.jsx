/* The Updates card. One tap on a Core row's Install used to restart Home
   Assistant, an OS row rebooted the Pi, and "Install all" fired every pending
   update at once — Core and OS included — with no confirm and no backup.
   Now the system rows confirm first and back up where HA supports it; routine
   installs stay one tap and take no backup (a policy change nobody asked for). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const fixtures = { updates: [] };
const callService = vi.fn();
const conn = vi.hoisted(() => ({ status: "ready", listeners: new Set() }));

vi.mock("../../src/ha/useEntity.js", async () => {
  const { useState, useEffect } = await import("react");
  return {
    useEntitiesByDomain: () => fixtures.updates,
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
  conn.status = "ready";
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
    expect(callService).toHaveBeenCalledWith("update", "install", { entity_id: CORE.entity_id, backup: true }, undefined, {
      expectDisconnect: true,
    });
  });

  it("an add-on row installs on one tap", async () => {
    fixtures.updates = [ESPHOME];
    render(<AddonsCard />);
    fireEvent.click(installIn("ESPHome"));
    await flush();
    // A routine install is an ordinary call: a dropped connection is a failure.
    expect(callService.mock.calls).toEqual([["update", "install", { entity_id: ESPHOME.entity_id }]]);
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

/* M13. An update entity says "on" or "off"; unavailable or unknown is a
   component nobody could check. It used to fall through to "current", so with
   the Supervisor down the card read "All up to date ✓ current". */
describe("AddonsCard when update status can't be read", () => {
  const off = (u) => ({ ...u, state: "off" });
  const as = (u, state) => ({ ...u, state });
  const head = (container) => container.querySelector("h2").textContent;

  it("every entity unavailable or unknown: says it can't tell and names them", () => {
    fixtures.updates = [as(CORE, "unavailable"), as(TAILSCALE, "unknown"), as(ESPHOME, "unavailable")];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("3 can't be checked");
    expect(container.textContent).not.toMatch(/up to date|current|latest version/i);
    expect(screen.getByText("Can't be checked: Home Assistant Core, Tailscale, ESPHome")).toBeTruthy();
    // No install control for a component whose state nobody knows.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("one unavailable among current ones is named, not folded into 'current'", () => {
    fixtures.updates = [as(CORE, "unavailable"), off(TAILSCALE), off(ESPHOME)];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("1 can't be checked");
    expect(screen.getByText("Can't be checked: Home Assistant Core")).toBeTruthy();
    expect(screen.getByText("The other 2 are at the latest version.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/✓ current|All up to date/);
  });

  it("an unreadable one is still named when others have updates waiting", () => {
    fixtures.updates = [as(CORE, "unavailable"), TAILSCALE];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("1 update available");
    expect(screen.getByText("Can't be checked: Home Assistant Core")).toBeTruthy();
  });

  it("no update entities at all is not 'all up to date' either", () => {
    fixtures.updates = [];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("Can't tell yet");
    expect(container.textContent).not.toMatch(/✓ current|All up to date/);
    expect(screen.getByText("Waiting for update entities…")).toBeTruthy();
  });

  it("still says 'All up to date ✓ current' when every one answered 'off'", () => {
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("All up to date");
    expect(screen.getByText("✓ current")).toBeTruthy();
    expect(screen.getByText("All 2 tracked components are at the latest version.")).toBeTruthy();
  });

  it("doesn't call cached states 'current' while the socket is down", () => {
    conn.status = "disconnected";
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("Can't tell yet");
    expect(container.textContent).not.toMatch(/✓ current/);
  });
});

/* I30. A Core / OS install ends with HA dropping the WebSocket before it
   answers. The call expects that (client.js), and the row says what is
   happening until the dashboard is back instead of offering Install again. */
describe("AddonsCard after a system install has gone out", () => {
  const setStatus = (s) => {
    conn.status = s;
    act(() => conn.listeners.forEach((set) => set(s)));
  };

  it("Core: says it is restarting, holds the row, and lets go once HA is back", async () => {
    fixtures.updates = [CORE];
    callService.mockResolvedValueOnce({ connectionLost: true });
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Home Assistant Core"));
    await flush();
    await flush();
    expect(screen.getByText("Restarting Home Assistant… the dashboard will reconnect")).toBeTruthy();
    expect(installIn("Home Assistant Core").disabled).toBe(true);

    setStatus("disconnected");
    expect(screen.getByText("Restarting Home Assistant… the dashboard will reconnect")).toBeTruthy();
    setStatus("ready");
    // Back, and the update still says "on" (it failed): the row is a row again.
    expect(screen.queryByText(/Restarting Home Assistant/)).toBeNull();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
  });

  it("OS expects the disconnect and says the Pi is rebooting", async () => {
    fixtures.updates = [OS];
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Operating System"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Home Assistant Operating System"));
    await flush();
    await flush();
    expect(callService).toHaveBeenCalledWith("update", "install", { entity_id: OS.entity_id }, undefined, {
      expectDisconnect: true,
    });
    expect(screen.getByText("Rebooting the Pi… the dashboard will reconnect")).toBeTruthy();
  });

  it("a failed system install says nothing extra (callService has toasted it)", async () => {
    fixtures.updates = [CORE];
    callService.mockRejectedValueOnce(new Error("Not connected"));
    render(<AddonsCard />);
    fireEvent.click(installIn("Home Assistant Core"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Home Assistant Core"));
    await flush();
    await flush();
    expect(screen.queryByText(/Restarting/)).toBeNull();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
  });
});
