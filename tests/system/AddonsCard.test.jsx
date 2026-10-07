/* The Updates card. One tap on a Core row's Install used to restart Home
   Assistant, an OS row rebooted the Pi, and "Install all" fired every pending
   update at once — Core and OS included — with no confirm and no backup.
   Now the system rows confirm first and back up where HA supports it; routine
   installs stay one tap and take no backup (a policy change nobody asked for). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const callService = vi.fn();

// The connection, the update entities and Home Assistant's start time all
// come from one fake, so the card and the restart notice see the same house.
vi.mock("../../src/ha/socket.js", async () => (await import("./fakeHa.js")).socketMock);
vi.mock("../../src/ha/useEntity.js", async () => {
  const fake = await import("./fakeHa.js");
  const { useEffect, useState } = await import("react");
  /* Whether HA has sent its set on this connection: connected, and not in
     the window after a reconnect before its first batch (`ha.resending`,
     which reconnectBeforeBatch() below opens and firstBatch() shuts). */
  function useSnapshotReady() {
    const read = () => fake.ha.status === "ready" && !fake.ha.resending;
    const [ready, setReady] = useState(read);
    useEffect(() => {
      const sync = () => setReady(read());
      fake.ha.statusListeners.add(sync);
      fake.ha.statesListeners.add(sync);
      return () => {
        fake.ha.statusListeners.delete(sync);
        fake.ha.statesListeners.delete(sync);
      };
    }, []);
    return ready;
  }
  return { useEntitiesByDomain: fake.useEntitiesByDomain, useConnectionStatus: fake.useConnectionStatus, useSnapshotReady };
});
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));

import { AddonsCard, installData } from "../../src/cards/system/AddonsCard.jsx";
import { ARM_LOCK_MS } from "../../src/cards/system/useArmedConfirm.js";
import { RESTART_GRACE_MS, REPORT_CAP_MS, clearNotices } from "../../src/cards/system/useReconnectNotice.js";
import { ha, setStatus, report, snapshot, uptime, resetHa, dropMidCall } from "./fakeHa.js";
import { getEntries, clearErrors } from "../../src/lib/errorLog.js";

const T0 = "2026-10-01T08:00:00+00:00";
const T1 = "2026-10-06T12:00:30+00:00";

/* What HA reports for the update domain, before the card renders. */
const fixtures = {
  set updates(list) {
    for (const id of Object.keys(ha.entities)) if (id.startsWith("update.")) delete ha.entities[id];
    for (const u of list) ha.entities[u.entity_id] = u;
  },
};

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
  vi.setSystemTime(Date.parse("2026-10-06T12:00:00Z"));
  callService.mockReset();
  callService.mockResolvedValue(undefined);
  clearNotices();
  resetHa();
  ha.resending = false;
  clearErrors();
  ha.entities["sensor.uptime"] = uptime(T0);
});
afterEach(() => {
  clearNotices();
  vi.useRealTimers();
});

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
    expect(installIn("Home Assistant Core").getAttribute("aria-disabled")).toBeNull();
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
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.textContent).toBe("…");
    // B14: "…" is not a name.
    expect(btn.getAttribute("aria-label")).toBe("Installing Tailscale");
    fireEvent.click(btn);
    expect(callService).not.toHaveBeenCalled();
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
    ha.status = "disconnected";
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("Can't tell yet");
    expect(container.textContent).not.toMatch(/✓ current/);
  });
});

/* B11. With the socket down the heading said "Can't tell yet" while the body
   still said "All 7 tracked components are at the latest version." — or
   listed cached rows with live Install buttons. The body is what HA last
   reported, and says so. */
describe("AddonsCard while the socket is down", () => {
  const off = (u) => ({ ...u, state: "off" });

  it("words cached 'current' as last reported, never as now", () => {
    ha.status = "disconnected";
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    const { container } = render(<AddonsCard />);
    expect(screen.getByText("Not connected — showing what Home Assistant last reported.")).toBeTruthy();
    expect(screen.getByText("All 2 tracked components were at the latest version.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/are at the latest version/);
  });

  it("goes back to the present once connected again", () => {
    ha.status = "disconnected";
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    render(<AddonsCard />);
    setStatus("ready");
    expect(screen.queryByText(/Not connected/)).toBeNull();
    expect(screen.getByText("All 2 tracked components are at the latest version.")).toBeTruthy();
  });

  it("keeps cached rows but offers no Install on them, nor Install the rest", () => {
    ha.status = "disconnected";
    fixtures.updates = [CORE, TAILSCALE, ESPHOME];
    render(<AddonsCard />);
    expect(screen.getByText("Not connected — showing what Home Assistant last reported.")).toBeTruthy();
    for (const title of ["Home Assistant Core", "Tailscale", "ESPHome"]) {
      expect(installIn(title).getAttribute("aria-disabled")).toBe("true");
      expect(installIn(title).title).toBe("Not connected to Home Assistant");
      fireEvent.click(installIn(title));
    }
    const rest = screen.getByRole("button", { name: "Install the rest" });
    expect(rest.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(rest);
    expect(callService).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("a drop while a row's button is focused leaves it focused", () => {
    fixtures.updates = [TAILSCALE];
    render(<AddonsCard />);
    installIn("Tailscale").focus();
    setStatus("disconnected");
    expect(document.activeElement).toBe(installIn("Tailscale"));
    expect(installIn("Tailscale").disabled).toBe(false);
  });
});

/* D2 (round 4d). Back on a new connection, before HA's first batch, the
   cache is still the pre-drop set. The card took "ready" for "now": it read
   "All up to date ✓ current — All 7 tracked components are at the latest
   version" from it (with live Install buttons on cached rows) while every
   other card on the tab was a skeleton, then flipped to "1 update available". */
describe("AddonsCard between a reconnect and HA's first batch", () => {
  const off = (u) => ({ ...u, state: "off" });
  const head = (container) => container.querySelector("h2").textContent;
  function reconnectBeforeBatch() {
    setStatus("disconnected");
    ha.resending = true;
    setStatus("ready");
  }
  function firstBatch(...entities) {
    ha.resending = false;
    snapshot(...entities);
  }

  it("doesn't call the pre-drop states current, nor say it isn't connected", () => {
    fixtures.updates = [off(CORE), off(TAILSCALE)];
    const { container } = render(<AddonsCard />);
    expect(head(container)).toBe("All up to date");

    reconnectBeforeBatch();
    expect(head(container)).toBe("Can't tell yet");
    expect(container.querySelector(".meta")).toBeNull();
    expect(container.textContent).not.toMatch(/✓ current|All up to date|are at the latest version|Not connected/);
    expect(screen.getByText("Reconnected, waiting for Home Assistant — showing what Home Assistant last reported.")).toBeTruthy();
    expect(screen.getByText("All 2 tracked components were at the latest version.")).toBeTruthy();

    firstBatch(CORE, off(TAILSCALE)); // Core's update arrived while the page was away
    expect(head(container)).toBe("1 update available");
    expect(screen.queryByText(/Reconnected, waiting/)).toBeNull();
  });

  it("offers no Install on the cached rows meanwhile, and keeps focus where it was", () => {
    fixtures.updates = [TAILSCALE, ESPHOME];
    render(<AddonsCard />);
    installIn("Tailscale").focus();

    reconnectBeforeBatch();
    for (const title of ["Tailscale", "ESPHome"]) {
      expect(installIn(title).getAttribute("aria-disabled")).toBe("true");
      expect(installIn(title).title).toBe("Waiting for Home Assistant to send its updates");
      fireEvent.click(installIn(title));
    }
    const all = screen.getByRole("button", { name: "Install all" });
    expect(all.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(all);
    expect(callService).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(installIn("Tailscale"));

    firstBatch(TAILSCALE, ESPHOME);
    expect(installIn("Tailscale").getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByText(/Reconnected, waiting/)).toBeNull();
  });
});

/* I30. A Core / OS install ends with HA dropping the WebSocket before it
   answers. The call expects that (client.js), and the row says what is
   happening until HA is back — with a start time that moved, because a
   reconnect alone proves nothing (B10). */
describe("AddonsCard after a system install has gone out", () => {
  async function confirm(title) {
    fireEvent.click(installIn(title));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn(title));
    await flush();
    await flush();
  }

  it("Core: says it is restarting, holds the row, and lets go once HA is back, restarted", async () => {
    fixtures.updates = [CORE];
    callService.mockImplementationOnce(async () => dropMidCall());
    render(<AddonsCard />);
    await confirm("Home Assistant Core");
    expect(screen.getByText("Restarting Home Assistant… the dashboard will reconnect")).toBeTruthy();
    expect(installIn("Home Assistant Core").getAttribute("aria-disabled")).toBe("true");

    setStatus("ready");
    // The cache, before HA sends its start time again: nothing decided yet.
    expect(screen.getByText("Reconnected — checking Home Assistant restarted…")).toBeTruthy();
    expect(installIn("Home Assistant Core").getAttribute("aria-disabled")).toBe("true");
    report(uptime(T1), CORE);
    // Back, restarted, and the update still says "on" (it failed): the row is a row again.
    expect(screen.queryByText(/Restarting Home Assistant/)).toBeNull();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
    expect(getEntries()).toEqual([]);
  });

  it("Core: a reconnect to the same Home Assistant says it didn't restart, and logs it", async () => {
    fixtures.updates = [CORE];
    callService.mockImplementationOnce(async () => dropMidCall());
    render(<AddonsCard />);
    await confirm("Home Assistant Core");
    setStatus("ready");
    report(uptime(T0), CORE);
    act(() => vi.advanceTimersByTime(RESTART_GRACE_MS));
    expect(screen.getByText("Home Assistant didn't restart — try again")).toBeTruthy();
    // ...and it can be tried again.
    expect(installIn("Home Assistant Core").getAttribute("aria-disabled")).toBeNull();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
    expect(getEntries()[0]).toMatchObject({
      message: "update.install: Home Assistant didn't restart (the command may not have reached it)",
    });
  });

  /* B14. The row's sentence reaches a screen reader, the busy button has a
     name, and the pressed button keeps keyboard focus. */
  it("announces the row's sentence, names the busy button and keeps focus on it", async () => {
    fixtures.updates = [CORE];
    callService.mockImplementationOnce(async () => dropMidCall());
    render(<AddonsCard />);
    expect(screen.getByRole("status").textContent).toBe("");
    installIn("Home Assistant Core").focus();
    await confirm("Home Assistant Core");
    expect(screen.getByRole("status").textContent).toBe(
      "Home Assistant Core: Restarting Home Assistant… the dashboard will reconnect",
    );
    const btn = installIn("Home Assistant Core");
    expect(btn.getAttribute("aria-label")).toBe("Installing Home Assistant Core");
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  /* B13. The System view unmounts on every tab change. */
  it("keeps the row's notice across a tab switch while HA is down", async () => {
    fixtures.updates = [OS];
    const first = render(<AddonsCard />);
    await confirm("Home Assistant Operating System");
    setStatus("disconnected");
    first.unmount();
    render(<AddonsCard />);
    expect(screen.getByText("Rebooting the Pi… the dashboard will reconnect")).toBeTruthy();
  });

  it("OS expects the disconnect and says the Pi is rebooting", async () => {
    fixtures.updates = [OS];
    render(<AddonsCard />);
    await confirm("Home Assistant Operating System");
    expect(callService).toHaveBeenCalledWith("update", "install", { entity_id: OS.entity_id }, undefined, {
      expectDisconnect: true,
    });
    expect(screen.getByText("Rebooting the Pi… the dashboard will reconnect")).toBeTruthy();
  });

  it("a failed system install says nothing extra (callService has toasted it)", async () => {
    fixtures.updates = [CORE];
    callService.mockRejectedValueOnce(new Error("Not connected"));
    render(<AddonsCard />);
    await confirm("Home Assistant Core");
    expect(screen.queryByText(/Restarting/)).toBeNull();
    expect(installIn("Home Assistant Core").textContent).toBe("Install");
  });
});

/* B12. The Supervisor restarts only itself: the dashboard never drops, so a
   notice only a drop could clear sat on "Restarting the Supervisor…" with a
   dead button for ten minutes, whatever HA reported meanwhile. */
describe("AddonsCard: the Supervisor row", () => {
  const SUP = update("update.home_assistant_supervisor_update", "Home Assistant Supervisor", 1 | 16, {
    installed_version: "2026.09.3",
    latest_version: "2026.10.0",
  });
  const SENT = "Update sent — waiting for the Supervisor to report back";
  async function confirmSup() {
    fireEvent.click(installIn("Home Assistant Supervisor"));
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(installIn("Home Assistant Supervisor"));
    await flush();
    await flush();
  }

  it("is an ordinary call: a dropped connection there is a failure, not 'sent'", async () => {
    fixtures.updates = [SUP];
    render(<AddonsCard />);
    await confirmSup();
    expect(callService.mock.calls).toEqual([["update", "install", { entity_id: SUP.entity_id }]]);
  });

  it("waits for HA to report the entity again, then shows what it says", async () => {
    fixtures.updates = [{ ...SUP, last_updated: "2026-10-06T11:59:00+00:00" }];
    render(<AddonsCard />);
    await confirmSup();
    expect(screen.getByText(SENT)).toBeTruthy();
    expect(screen.queryByText(/Restarting/)).toBeNull();
    expect(installIn("Home Assistant Supervisor").getAttribute("aria-disabled")).toBe("true");

    // Reported again: still "on", in_progress false (rolled back, or a newer version).
    report({ ...SUP, last_updated: "2026-10-06T12:01:00+00:00", attributes: { ...SUP.attributes, in_progress: false } });
    expect(screen.queryByText(SENT)).toBeNull();
    expect(installIn("Home Assistant Supervisor").textContent).toBe("Install");
    expect(installIn("Home Assistant Supervisor").getAttribute("aria-disabled")).toBeNull();
  });

  it("lets go after a short cap if HA never reports", async () => {
    fixtures.updates = [SUP];
    render(<AddonsCard />);
    await confirmSup();
    act(() => vi.advanceTimersByTime(REPORT_CAP_MS));
    expect(screen.queryByText(SENT)).toBeNull();
    expect(installIn("Home Assistant Supervisor").textContent).toBe("Install");
  });
});
